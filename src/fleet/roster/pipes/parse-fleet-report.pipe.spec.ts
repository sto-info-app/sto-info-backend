import { BadRequestException } from '@nestjs/common';

import { FleetReport } from '../enums/fleet-report.enum';
import { ParseFleetReportPipe } from './parse-fleet-report.pipe';

describe('ParseFleetReportPipe', () => {
  const pipe = new ParseFleetReportPipe();

  it.each([
    ['growth', FleetReport.GROWTH],
    ['GROWTH', FleetReport.GROWTH],
    ['Contribution', FleetReport.CONTRIBUTION],
    ['ranks', FleetReport.RANKS],
  ])('reads %s as a report', (value, report) => {
    expect(pipe.transform(value)).toBe(report);
  });

  it('refuses a name that is no report, listing the ones there are', () => {
    expect(() => pipe.transform('holdings')).toThrow(
      new BadRequestException(
        'There is no report called "holdings". The reports are growth, ' +
          'tenure, ranks, activity, contribution.',
      ),
    );
  });
});
