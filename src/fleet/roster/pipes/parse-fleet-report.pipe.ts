import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

import { FleetReport } from '../enums/fleet-report.enum';

/** Every report, by its name in lower case. */
const REPORTS = new Map(
  Object.values(FleetReport).map(report => [report.toLowerCase(), report]),
);

/**
 * Reads a report named in a path (FC-020).
 *
 * The report routes are `…/reports/growth` and the like, so a path naming
 * one for its export or its audience reads the same way; any case is
 * accepted.
 */
@Injectable()
export class ParseFleetReportPipe implements PipeTransform<
  string,
  FleetReport
> {
  /**
   * Reads the report.
   *
   * @param value - The path segment.
   * @returns The report it names.
   * @throws BadRequestException when it names none.
   */
  transform(value: string): FleetReport {
    const report = REPORTS.get(value.toLowerCase());

    if (report === undefined) {
      throw new BadRequestException(
        `There is no report called "${value}". The reports are ${[
          ...REPORTS.keys(),
        ].join(', ')}.`,
      );
    }

    return report;
  }
}
