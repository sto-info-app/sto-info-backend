import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ReportStatus } from '../enums/report-status.enum';
import { UpdateReportDto } from './update-report.dto';

/**
 * The properties a body fails on.
 *
 * @param body - The body.
 * @returns Each failing property.
 */
async function failures(body: object) {
  return (await validate(plainToInstance(UpdateReportDto, body))).map(
    error => error.property,
  );
}

// FC-039: a decision's reason is kept in the site admin log, so closing a
// report needs one; claiming one does not.
describe('UpdateReportDto (FC-039)', () => {
  it.each([ReportStatus.OPEN, ReportStatus.UNDER_REVIEW])(
    'moves a report to %s without a reason',
    async status => {
      await expect(failures({ status })).resolves.toEqual([]);
    },
  );

  it.each([ReportStatus.ACTIONED, ReportStatus.DISMISSED])(
    'closes a report as %s with a reason, and not without one',
    async status => {
      await expect(
        failures({ status, reason: ' Warned them ' }),
      ).resolves.toEqual([]);
      await expect(failures({ status })).resolves.toEqual(['reason']);
      await expect(failures({ status, reason: '   ' })).resolves.toEqual([
        'reason',
      ]);
    },
  );

  it('checks a reason given for a live report too', async () => {
    await expect(
      failures({ status: ReportStatus.UNDER_REVIEW, reason: 'x'.repeat(501) }),
    ).resolves.toEqual(['reason']);
  });

  it('keeps notes to 2,000 characters', async () => {
    await expect(
      failures({
        status: ReportStatus.UNDER_REVIEW,
        moderatorNotes: 'x'.repeat(2001),
      }),
    ).resolves.toEqual(['moderatorNotes']);
  });
});
