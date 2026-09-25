import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetReportAudiencesDto } from '../dto/fleet-report-audience.dto';
import { FleetReportAudienceChangeEntity } from '../entities/fleet-report-audience-change.entity';
import { FleetReportAudienceEntity } from '../entities/fleet-report-audience.entity';
import { FleetReport } from '../enums/fleet-report.enum';

/**
 * Who may see each of a Fleet's reports (FC-020).
 *
 * The Owner chooses, per report, from the Fleet's four audiences (Steve's
 * decisions of 25 September 2026). A report nobody has chosen for is
 * `PRIVATE`: its `reports.view` holders alone. Every change is kept, from
 * what to what and by whom; no reason is asked, as for the Owner's other
 * settings.
 */
@Injectable()
export class FleetReportAudienceService {
  /**
   * Creates an instance of FleetReportAudienceService.
   *
   * @param _audiences - Each report's audience now.
   * @param _changes - Every change to one.
   * @param _dataSource - Runs a change as one transaction.
   */
  constructor(
    @InjectRepository(FleetReportAudienceEntity)
    private readonly _audiences: Repository<FleetReportAudienceEntity>,
    @InjectRepository(FleetReportAudienceChangeEntity)
    private readonly _changes: Repository<FleetReportAudienceChangeEntity>,
    @InjectDataSource()
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Reads who may see one report.
   *
   * @param fleetId - The Fleet.
   * @param report - The report.
   * @returns Its audience; `PRIVATE` when none has been chosen.
   */
  async audienceOf(
    fleetId: string,
    report: FleetReport,
  ): Promise<FleetAudience> {
    const chosen = await this._audiences.findOne({
      where: { fleetId, report },
      select: { fleetId: true, report: true, audience: true },
    });

    return chosen?.audience ?? FleetAudience.PRIVATE;
  }

  /**
   * Reads who may see each report, in one query.
   *
   * @param fleetId - The Fleet.
   * @returns Each report's audience; `PRIVATE` where none has been chosen.
   */
  async chosen(fleetId: string): Promise<Map<FleetReport, FleetAudience>> {
    const rows = await this._audiences.find({
      where: { fleetId },
      select: { fleetId: true, report: true, audience: true },
    });
    const byReport = new Map(rows.map(row => [row.report, row.audience]));

    return new Map(
      Object.values(FleetReport).map(report => [
        report,
        byReport.get(report) ?? FleetAudience.PRIVATE,
      ]),
    );
  }

  /**
   * Reads every report's audience and every change to one.
   *
   * @param fleetId - The Fleet.
   * @returns Each report's audience, in the reports' order, and the changes
   *   newest first.
   */
  async audiences(fleetId: string): Promise<FleetReportAudiencesDto> {
    const chosen = new Map(
      (await this._audiences.find({ where: { fleetId } })).map(row => [
        row.report,
        row,
      ]),
    );
    const changes = await this._changes.find({
      where: { fleetId },
      relations: { actor: { profile: true } },
      order: { changedAt: 'DESC', id: 'DESC' },
    });

    return {
      reports: Object.values(FleetReport).map(report => ({
        report,
        audience: chosen.get(report)?.audience ?? FleetAudience.PRIVATE,
        updatedAt: chosen.get(report)?.updatedAt ?? null,
      })),
      changes: changes.map(change => ({
        id: change.id,
        report: change.report,
        audienceBefore: change.audienceBefore,
        audienceAfter: change.audienceAfter,
        actorName: change.actor?.profile?.username ?? null,
        changedAt: change.changedAt,
      })),
    };
  }

  /**
   * Changes who may see one report.
   *
   * Under a lock on that report's audience, so two changes queue and each
   * records the audience it really moved from.
   *
   * @param fleetId - The Fleet.
   * @param report - The report.
   * @param audience - Who may see it now.
   * @param actorUserId - The Owner.
   * @returns Every report's audience and change, as after it.
   * @throws BadRequestException when it already has that audience.
   */
  async set(
    fleetId: string,
    report: FleetReport,
    audience: FleetAudience,
    actorUserId: string,
  ): Promise<FleetReportAudiencesDto> {
    await this._dataSource.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `fleet-report-audience:${fleetId}:${report}`,
      ]);

      const current = await manager.findOne(FleetReportAudienceEntity, {
        where: { fleetId, report },
      });
      const before = current?.audience ?? FleetAudience.PRIVATE;

      if (before === audience) {
        throw new BadRequestException('The report has that audience already.');
      }

      await manager.upsert(
        FleetReportAudienceEntity,
        { fleetId, report, audience, updatedAt: new Date() },
        ['fleetId', 'report'],
      );
      await manager.insert(FleetReportAudienceChangeEntity, {
        fleetId,
        report,
        audienceBefore: before,
        audienceAfter: audience,
        actorUserId,
      });
    });

    return this.audiences(fleetId);
  }
}
