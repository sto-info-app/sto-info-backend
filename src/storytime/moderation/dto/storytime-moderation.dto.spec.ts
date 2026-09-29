import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ReportStatus } from '../../../moderation/enums/report-status.enum';
import { DecideAppealDto } from './decide-appeal.dto';
import { ResolveStorytimeReportDto } from './resolve-storytime-report.dto';

/**
 * The properties a body fails on.
 *
 * @param type - The DTO.
 * @param body - The body.
 * @returns Each failing property.
 */
async function failures(type: new () => object, body: object) {
  return (await validate(plainToInstance(type, body))).map(
    error => error.property,
  );
}

// FC-039: each decision is kept in the site admin log with its reason, so a
// decision needs one.
describe('Storytime moderation DTOs (FC-039)', () => {
  describe('DecideAppealDto', () => {
    it('takes a decision with what the creator is told', async () => {
      await expect(
        failures(DecideAppealDto, { uphold: true, reviewNotes: ' Restored. ' }),
      ).resolves.toEqual([]);
    });

    it.each([
      ['no notes', {}],
      ['blank notes', { reviewNotes: '   ' }],
      ['notes too long', { reviewNotes: 'x'.repeat(1001) }],
    ])('refuses %s', async (_case, body) => {
      await expect(
        failures(DecideAppealDto, { uphold: false, ...body }),
      ).resolves.toEqual(['reviewNotes']);
    });
  });

  describe('ResolveStorytimeReportDto', () => {
    it.each([ReportStatus.OPEN, ReportStatus.UNDER_REVIEW])(
      'moves a report to %s without a resolution',
      async status => {
        await expect(
          failures(ResolveStorytimeReportDto, { status }),
        ).resolves.toEqual([]);
      },
    );

    it.each([ReportStatus.ACTIONED, ReportStatus.DISMISSED])(
      'closes a report as %s with a resolution, and not without one',
      async status => {
        await expect(
          failures(ResolveStorytimeReportDto, {
            status,
            resolution: 'Removed the chapter.',
          }),
        ).resolves.toEqual([]);
        await expect(
          failures(ResolveStorytimeReportDto, { status }),
        ).resolves.toEqual(['resolution']);
        await expect(
          failures(ResolveStorytimeReportDto, { status, resolution: '  ' }),
        ).resolves.toEqual(['resolution']);
      },
    );

    it('checks a resolution given for a live report too', async () => {
      await expect(
        failures(ResolveStorytimeReportDto, {
          status: ReportStatus.UNDER_REVIEW,
          resolution: 'x'.repeat(1001),
        }),
      ).resolves.toEqual(['resolution']);
    });
  });
});
