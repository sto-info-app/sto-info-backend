import { BadRequestException } from '@nestjs/common';

import { FleetReportView } from '../enums/fleet-report-view.enum';
import { FleetReport } from '../enums/fleet-report.enum';
import { FleetReportContextService } from './fleet-report-context.service';
import { PublishedRosterRevisionService } from './published-roster-revision.service';

const PUBLISHED_AT = new Date('2026-09-25T00:30:00Z');
const EXPORTS = [
  {
    importId: 'import-1',
    exportedAt: new Date('2024-01-01T12:00:00Z'),
    partial: false,
  },
  {
    importId: 'import-2',
    exportedAt: new Date('2024-11-01T12:00:00Z'),
    partial: true,
  },
  {
    importId: 'import-3',
    exportedAt: new Date('2024-12-01T12:00:00Z'),
    partial: false,
  },
];

describe('FleetReportContextService', () => {
  let revisions: { pin: jest.Mock; effectiveExports: jest.Mock };
  let service: FleetReportContextService;

  beforeEach(() => {
    revisions = {
      pin: jest.fn(() =>
        Promise.resolve({
          revision: 4,
          publishedAt: PUBLISHED_AT,
          stale: true,
        }),
      ),
      effectiveExports: jest.fn(() => Promise.resolve(EXPORTS)),
    };
    service = new FleetReportContextService(
      revisions as unknown as PublishedRosterRevisionService,
    );
  });

  it('pins the published revision and covers every export by default', async () => {
    const context = await service.open(
      'fleet-1',
      FleetReport.GROWTH,
      FleetReportView.FULL,
      {},
    );

    expect(revisions.effectiveExports).toHaveBeenCalledWith('fleet-1', 4);
    expect(context).toEqual({
      fleetId: 'fleet-1',
      header: {
        report: FleetReport.GROWTH,
        view: FleetReportView.FULL,
        revision: 4,
        publishedAt: PUBLISHED_AT,
        stale: true,
        range: { from: null, to: null },
        coverage: {
          exports: 3,
          first: { importId: 'import-1', exportedAt: EXPORTS[0].exportedAt },
          latest: { importId: 'import-3', exportedAt: EXPORTS[2].exportedAt },
        },
        minimumCohort: 5,
      },
      exports: EXPORTS,
      first: EXPORTS[0],
      at: EXPORTS[2],
    });
  });

  it('covers only the exports taken within the span, ends included', async () => {
    const context = await service.open(
      'fleet-1',
      FleetReport.GROWTH,
      FleetReportView.AGGREGATE,
      { from: '2024-11-01T12:00:00Z', to: '2024-11-30T23:59:59Z' },
    );

    expect(context.exports).toEqual([EXPORTS[1]]);
    // Still the Fleet's first, though the span starts later.
    expect(context.first).toBe(EXPORTS[0]);
    expect(context.header.range).toEqual({
      from: new Date('2024-11-01T12:00:00Z'),
      to: new Date('2024-11-30T23:59:59Z'),
    });
  });

  it('draws no detail for an aggregate view', async () => {
    const context = await service.open(
      'fleet-1',
      FleetReport.GROWTH,
      FleetReportView.AGGREGATE,
      { at: 'import-1' },
    );

    expect(context.at).toBeNull();
  });

  it('draws a full view’s detail at the export asked for', async () => {
    const context = await service.open(
      'fleet-1',
      FleetReport.TENURE,
      FleetReportView.FULL,
      { at: 'import-2' },
    );

    expect(context.at).toBe(EXPORTS[1]);
  });

  it('refuses detail at an export outside the span', async () => {
    await expect(
      service.open('fleet-1', FleetReport.TENURE, FleetReportView.FULL, {
        from: '2024-06-01T00:00:00Z',
        at: 'import-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('has no first export before the first revision', async () => {
    revisions.effectiveExports.mockResolvedValue([]);

    const context = await service.open(
      'fleet-1',
      FleetReport.RANKS,
      FleetReportView.FULL,
      {},
    );

    expect(context.first).toBeNull();
  });

  it('covers nothing for an empty span', async () => {
    const context = await service.open(
      'fleet-1',
      FleetReport.TENURE,
      FleetReportView.FULL,
      { to: '2020-01-01T00:00:00Z' },
    );

    expect(context).toMatchObject({
      exports: [],
      at: null,
      header: { coverage: { exports: 0, first: null, latest: null } },
    });
  });
});
