import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { DataSource } from 'typeorm';

import { FactionEntity } from 'src/sto/character/entities/faction.entity';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetRecruitmentState } from '../../enums/fleet-recruitment-state.enum';
import { UpdateRecruitmentSettingsDto } from '../dto/recruitment-settings.dto';
import { FleetRecruitmentSettingsEntity } from '../entities/fleet-recruitment-settings.entity';
import { ApplicationQuestionKind } from '../enums/application-question-kind.enum';
import { RecruitmentSettingsService } from './recruitment-settings.service';

const FLEET = {
  id: 'fleet-1',
  communityId: 'community-1',
  recruitmentState: FleetRecruitmentState.CLOSED,
} as StoFleetEntity;

const FEDERATION = '11111111-1111-4111-8111-111111111111';

/** Version 2, asking one question. */
const SAVED = {
  id: 'settings-2',
  fleetId: 'fleet-1',
  version: 2,
  recruitmentState: FleetRecruitmentState.APPLICATION,
  requirementsText: 'Be kind',
  minimumLevel: 50,
  factionIds: [FEDERATION],
  questions: [
    {
      id: 'q-why',
      kind: ApplicationQuestionKind.SHORT_TEXT,
      prompt: 'Why?',
      required: true,
      options: [],
    },
  ],
  createdAt: new Date('2026-09-26T10:00:00Z'),
} as unknown as FleetRecruitmentSettingsEntity;

/**
 * Builds a save request, the same as version 2 unless changed.
 *
 * @param changes - Fields to override.
 * @returns The request.
 */
function request(
  changes: Partial<UpdateRecruitmentSettingsDto> = {},
): UpdateRecruitmentSettingsDto {
  return {
    expectedVersion: 2,
    recruitmentState: FleetRecruitmentState.APPLICATION,
    requirementsText: 'Be kind',
    minimumLevel: 50,
    factionIds: [FEDERATION],
    questions: [
      {
        id: 'q-why',
        kind: ApplicationQuestionKind.SHORT_TEXT,
        prompt: 'Why?',
        required: true,
        options: [],
      },
    ],
    ...changes,
  };
}

describe('RecruitmentSettingsService', () => {
  let latest: FleetRecruitmentSettingsEntity | null;
  let lockedFleet: StoFleetEntity | null;
  let factionCount: number;
  let manager: {
    findOne: jest.Mock;
    find: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    increment: jest.Mock;
  };
  let service: RecruitmentSettingsService;

  beforeEach(() => {
    latest = SAVED;
    lockedFleet = { ...FLEET, recruitmentState: SAVED.recruitmentState };
    factionCount = 1;
    manager = {
      findOne: jest.fn((entity: unknown) =>
        Promise.resolve(entity === StoFleetEntity ? lockedFleet : latest),
      ),
      find: jest.fn(() =>
        Promise.resolve([{ id: FEDERATION, name: 'Starfleet (2409)' }]),
      ),
      count: jest.fn(() => Promise.resolve(factionCount)),
      create: jest.fn((_entity: unknown, data: object) => data),
      save: jest.fn((_entity: unknown, data: object) =>
        Promise.resolve({ id: 'settings-3', ...data }),
      ),
      update: jest.fn(() => Promise.resolve({})),
      increment: jest.fn(() => Promise.resolve({})),
    };
    const dataSource = {
      manager,
      transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
      ),
    };
    service = new RecruitmentSettingsService(
      dataSource as unknown as DataSource,
    );
  });

  describe('current', () => {
    it('reads the latest version', async () => {
      const current = await service.current(FLEET);

      expect(current).toEqual(
        expect.objectContaining({
          settings: SAVED,
          version: 2,
          recruitmentState: FleetRecruitmentState.APPLICATION,
          minimumLevel: 50,
        }),
      );
      expect(manager.findOne).toHaveBeenCalledWith(
        FleetRecruitmentSettingsEntity,
        { where: { fleetId: 'fleet-1' }, order: { version: 'DESC' } },
      );
    });

    it('recruits as registered, asking nothing, before any version', async () => {
      latest = null;

      await expect(service.current(FLEET)).resolves.toEqual({
        settings: null,
        version: 0,
        recruitmentState: FleetRecruitmentState.CLOSED,
        requirementsText: null,
        minimumLevel: null,
        factionIds: [],
        questions: [],
      });
    });
  });

  describe('describe', () => {
    it('names the factions and says when the version was saved', async () => {
      const described = await service.describe(FLEET);

      expect(described).toEqual({
        version: 2,
        recruitmentState: FleetRecruitmentState.APPLICATION,
        requirementsText: 'Be kind',
        minimumLevel: 50,
        factions: [{ id: FEDERATION, name: 'Starfleet (2409)' }],
        questions: SAVED.questions,
        savedAt: SAVED.createdAt,
      });
      expect(manager.find).toHaveBeenCalledWith(
        FactionEntity,
        expect.objectContaining({ order: { name: 'ASC' } }),
      );
    });

    it('reads no factions when none are allowed, and no save time before any', async () => {
      latest = null;

      const described = await service.describe(FLEET);

      expect(described.factions).toEqual([]);
      expect(described.savedAt).toBeNull();
      expect(manager.find).not.toHaveBeenCalled();
    });
  });

  describe('save', () => {
    it('saves the next version and keeps the Fleet’s state in step', async () => {
      const saved = await service.save(
        'community-1',
        'fleet-1',
        request({
          recruitmentState: FleetRecruitmentState.OPEN,
          requirementsText: '  Be kind  ',
        }),
        'officer-1',
      );

      expect(saved).toEqual(
        expect.objectContaining({
          version: 3,
          recruitmentState: FleetRecruitmentState.OPEN,
          requirementsText: 'Be kind',
          createdByUserId: 'officer-1',
        }),
      );
      expect(manager.update).toHaveBeenCalledWith(
        StoFleetEntity,
        { id: 'fleet-1' },
        { recruitmentState: FleetRecruitmentState.OPEN },
      );
      expect(manager.increment).toHaveBeenCalledWith(
        StoFleetEntity,
        { id: 'fleet-1' },
        'revision',
        1,
      );
    });

    it('locks the Fleet it reads the version under', async () => {
      await service.save(
        'community-1',
        'fleet-1',
        request({ minimumLevel: 60 }),
        'u',
      );

      expect(manager.findOne).toHaveBeenCalledWith(StoFleetEntity, {
        where: { id: 'fleet-1', communityId: 'community-1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('leaves the Fleet alone when its state does not change', async () => {
      await service.save(
        'community-1',
        'fleet-1',
        request({ minimumLevel: 60 }),
        'u',
      );

      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.increment).not.toHaveBeenCalled();
    });

    it('saves nothing when nothing changed', async () => {
      await expect(
        service.save('community-1', 'fleet-1', request(), 'u'),
      ).resolves.toBe(SAVED);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('saves version 1 over a Fleet that has none, even unchanged', async () => {
      latest = null;
      lockedFleet = { ...FLEET };

      const saved = await service.save(
        'community-1',
        'fleet-1',
        request({
          expectedVersion: 0,
          recruitmentState: FleetRecruitmentState.CLOSED,
          requirementsText: null,
          minimumLevel: undefined,
          factionIds: [],
          questions: [],
        }),
        'u',
      );

      expect(saved).toEqual(
        expect.objectContaining({ version: 1, minimumLevel: null }),
      );
      expect(manager.count).not.toHaveBeenCalled();
    });

    it('refuses a save over a newer version', async () => {
      await expect(
        service.save(
          'community-1',
          'fleet-1',
          request({ expectedVersion: 1 }),
          'u',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a Fleet not in that Community', async () => {
      lockedFleet = null;

      await expect(
        service.save('community-2', 'fleet-1', request(), 'u'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a faction that does not exist, once however often it is named', async () => {
      factionCount = 0;

      await expect(
        service.save(
          'community-1',
          'fleet-1',
          request({ factionIds: [FEDERATION, FEDERATION] }),
          'u',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.count).toHaveBeenCalledWith(FactionEntity, {
        where: { id: expect.anything() },
      });
    });

    it('keeps a question’s identity across versions, and mints one for a new question', async () => {
      const saved = await service.save(
        'community-1',
        'fleet-1',
        request({
          questions: [
            {
              id: 'q-why',
              kind: ApplicationQuestionKind.SHORT_TEXT,
              prompt: ' Why us? ',
              required: true,
              options: [],
            },
            {
              kind: ApplicationQuestionKind.SINGLE_CHOICE,
              prompt: 'When?',
              required: false,
              options: [' Evenings ', 'Weekends'],
            },
            {
              id: 'q-why',
              kind: ApplicationQuestionKind.YES_NO,
              prompt: 'Rules?',
              required: true,
              options: [],
            },
            {
              id: '99999999-9999-4999-8999-999999999999',
              kind: ApplicationQuestionKind.LONG_TEXT,
              prompt: 'About you',
              required: false,
              options: [],
            },
          ],
        }),
        'u',
      );
      const questions = (saved as FleetRecruitmentSettingsEntity).questions;

      expect(questions[0]).toEqual({
        id: 'q-why',
        kind: ApplicationQuestionKind.SHORT_TEXT,
        prompt: 'Why us?',
        required: true,
        options: [],
      });
      expect(questions[1].options).toEqual(['Evenings', 'Weekends']);
      // A second question claiming the same identity, or one the Fleet never
      // had, gets a fresh one rather than borrowing another's answers.
      expect(new Set(questions.map(question => question.id)).size).toBe(4);
      expect(questions[3].id).not.toBe('99999999-9999-4999-8999-999999999999');
    });

    it.each([
      [
        'a blank prompt',
        { kind: ApplicationQuestionKind.SHORT_TEXT, prompt: '  ', options: [] },
        'Every question needs a prompt.',
      ],
      [
        'a choice with one option',
        {
          kind: ApplicationQuestionKind.SINGLE_CHOICE,
          prompt: 'Pick',
          options: ['Only'],
        },
        'at least two options',
      ],
      [
        'a choice with a blank option',
        {
          kind: ApplicationQuestionKind.SINGLE_CHOICE,
          prompt: 'Pick',
          options: ['One', ' '],
        },
        'at least two options',
      ],
      [
        'a choice offered twice',
        {
          kind: ApplicationQuestionKind.SINGLE_CHOICE,
          prompt: 'Pick',
          options: ['One', 'one '],
        },
        'the same option twice',
      ],
      [
        'options on a text question',
        {
          kind: ApplicationQuestionKind.YES_NO,
          prompt: 'Rules?',
          options: ['Yes'],
        },
        'Only a single-choice question has options.',
      ],
    ])('refuses %s', async (_label, question, message) => {
      await expect(
        service.save(
          'community-1',
          'fleet-1',
          request({ questions: [{ required: false, ...question }] }),
          'u',
        ),
      ).rejects.toThrow(message);
    });
  });
});
