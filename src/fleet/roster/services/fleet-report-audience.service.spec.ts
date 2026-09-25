import { BadRequestException } from '@nestjs/common';

import { DataSource, Repository } from 'typeorm';

import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetReportAudienceChangeEntity } from '../entities/fleet-report-audience-change.entity';
import { FleetReportAudienceEntity } from '../entities/fleet-report-audience.entity';
import { FleetReport } from '../enums/fleet-report.enum';
import { FleetReportAudienceService } from './fleet-report-audience.service';

const FLEET_ID = 'fleet-1';
const UPDATED_AT = new Date('2026-09-25T12:00:00Z');

describe('FleetReportAudienceService', () => {
  let audiences: { findOne: jest.Mock; find: jest.Mock };
  let changes: { find: jest.Mock };
  let manager: {
    query: jest.Mock;
    findOne: jest.Mock;
    upsert: jest.Mock;
    insert: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let service: FleetReportAudienceService;

  beforeEach(() => {
    audiences = {
      findOne: jest.fn(() => Promise.resolve(null)),
      find: jest.fn(() =>
        Promise.resolve([
          {
            fleetId: FLEET_ID,
            report: FleetReport.GROWTH,
            audience: FleetAudience.PUBLIC,
            updatedAt: UPDATED_AT,
          },
        ]),
      ),
    };
    changes = {
      find: jest.fn(() =>
        Promise.resolve([
          {
            id: 'change-1',
            report: FleetReport.GROWTH,
            audienceBefore: FleetAudience.PRIVATE,
            audienceAfter: FleetAudience.PUBLIC,
            actor: { profile: { username: 'MidNiteShadow' } },
            changedAt: UPDATED_AT,
          },
          {
            id: 'change-0',
            report: FleetReport.RANKS,
            audienceBefore: FleetAudience.PRIVATE,
            audienceAfter: FleetAudience.FLEET_MEMBERS,
            actor: null,
            changedAt: UPDATED_AT,
          },
        ]),
      ),
    };
    manager = {
      query: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn(() => Promise.resolve(null)),
      upsert: jest.fn(() => Promise.resolve({})),
      insert: jest.fn(() => Promise.resolve({})),
    };
    dataSource = {
      transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
      ),
    };
    service = new FleetReportAudienceService(
      audiences as unknown as Repository<FleetReportAudienceEntity>,
      changes as unknown as Repository<FleetReportAudienceChangeEntity>,
      dataSource as unknown as DataSource,
    );
  });

  describe('audienceOf', () => {
    it('reads a report nobody has chosen for as private', async () => {
      await expect(
        service.audienceOf(FLEET_ID, FleetReport.TENURE),
      ).resolves.toBe(FleetAudience.PRIVATE);
      expect(audiences.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { fleetId: FLEET_ID, report: FleetReport.TENURE },
        }),
      );
    });

    it('reads the audience chosen', async () => {
      audiences.findOne.mockResolvedValue({
        audience: FleetAudience.COMMUNITY,
      });

      await expect(
        service.audienceOf(FLEET_ID, FleetReport.TENURE),
      ).resolves.toBe(FleetAudience.COMMUNITY);
    });
  });

  describe('audiences', () => {
    it('lists every report, private unless chosen, and every change', async () => {
      await expect(service.audiences(FLEET_ID)).resolves.toEqual({
        reports: [
          {
            report: FleetReport.GROWTH,
            audience: FleetAudience.PUBLIC,
            updatedAt: UPDATED_AT,
          },
          {
            report: FleetReport.TENURE,
            audience: FleetAudience.PRIVATE,
            updatedAt: null,
          },
          {
            report: FleetReport.RANKS,
            audience: FleetAudience.PRIVATE,
            updatedAt: null,
          },
          {
            report: FleetReport.ACTIVITY,
            audience: FleetAudience.PRIVATE,
            updatedAt: null,
          },
          {
            report: FleetReport.CONTRIBUTION,
            audience: FleetAudience.PRIVATE,
            updatedAt: null,
          },
        ],
        changes: [
          {
            id: 'change-1',
            report: FleetReport.GROWTH,
            audienceBefore: FleetAudience.PRIVATE,
            audienceAfter: FleetAudience.PUBLIC,
            actorName: 'MidNiteShadow',
            changedAt: UPDATED_AT,
          },
          expect.objectContaining({ id: 'change-0', actorName: null }),
        ],
      });
      expect(changes.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { fleetId: FLEET_ID },
          order: { changedAt: 'DESC', id: 'DESC' },
        }),
      );
    });
  });

  describe('set', () => {
    it('changes a report from private under its lock, recording the move', async () => {
      await service.set(
        FLEET_ID,
        FleetReport.RANKS,
        FleetAudience.COMMUNITY,
        'owner-1',
      );

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`fleet-report-audience:${FLEET_ID}:RANKS`],
      );
      expect(manager.upsert).toHaveBeenCalledWith(
        FleetReportAudienceEntity,
        expect.objectContaining({
          fleetId: FLEET_ID,
          report: FleetReport.RANKS,
          audience: FleetAudience.COMMUNITY,
        }),
        ['fleetId', 'report'],
      );
      expect(manager.insert).toHaveBeenCalledWith(
        FleetReportAudienceChangeEntity,
        {
          fleetId: FLEET_ID,
          report: FleetReport.RANKS,
          audienceBefore: FleetAudience.PRIVATE,
          audienceAfter: FleetAudience.COMMUNITY,
          actorUserId: 'owner-1',
        },
      );
    });

    it('records the audience it really moved from', async () => {
      manager.findOne.mockResolvedValue({ audience: FleetAudience.PUBLIC });

      await service.set(
        FLEET_ID,
        FleetReport.GROWTH,
        FleetAudience.PRIVATE,
        'owner-1',
      );

      expect(manager.insert).toHaveBeenCalledWith(
        FleetReportAudienceChangeEntity,
        expect.objectContaining({
          audienceBefore: FleetAudience.PUBLIC,
          audienceAfter: FleetAudience.PRIVATE,
        }),
      );
    });

    it('gives back every audience as after it', async () => {
      await expect(
        service.set(
          FLEET_ID,
          FleetReport.RANKS,
          FleetAudience.COMMUNITY,
          'owner-1',
        ),
      ).resolves.toMatchObject({ reports: expect.any(Array) as unknown });
    });

    it('refuses a change to the audience it already has', async () => {
      await expect(
        service.set(
          FLEET_ID,
          FleetReport.RANKS,
          FleetAudience.PRIVATE,
          'owner-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.upsert).not.toHaveBeenCalled();
      expect(manager.insert).not.toHaveBeenCalled();
    });
  });
});
