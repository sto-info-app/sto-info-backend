import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { PublicMemberService } from '../community/public-member.service';
import { UserEntity } from '../user/entities/user.entity';
import { CreateUserReportDto } from './dto/create-user-report.dto';
import { ReportQueryDto } from './dto/report-query.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import {
  PaginatedReportsDto,
  ReportPartyDto,
  UserReportDto,
} from './dto/user-report.dto';
import { UserReportEntity } from './entities/user-report.entity';
import { ReportStatus } from './enums/report-status.enum';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** The states a report is still waiting on someone for. */
export const UNRESOLVED_STATUSES = [
  ReportStatus.OPEN,
  ReportStatus.UNDER_REVIEW,
];

/**
 * Member-submitted reports of other members, and the admin queue that works
 * through them.
 *
 * Reporting is one-way by design: a member can raise a report but has no
 * endpoint to read one back, and nothing here is ever visible to the member
 * being reported. That keeps a report from becoming a channel for pressuring
 * the person it names.
 *
 * Reporting is deliberately separate from blocking. A block is a private
 * preference the blocker manages themselves ({@link BlockService}); a report
 * asks an administrator to look. The two are usually raised together, but
 * neither implies the other.
 */
@Injectable()
export class ReportService {
  /**
   * Creates an instance of ReportService.
   *
   * @param _reportRepository - The user-report repository.
   * @param _publicMemberService - Resolves members by username.
   */
  constructor(
    @InjectRepository(UserReportEntity)
    private readonly _reportRepository: Repository<UserReportEntity>,
    private readonly _publicMemberService: PublicMemberService,
  ) {}

  // ----- Member -----

  /**
   * Raises a report against a member.
   *
   * Returns nothing on purpose: the reporter is told the report was received
   * and nothing else, so no part of the moderation process leaks back through
   * the response.
   *
   * @param reporterId - The reporting member's user ID.
   * @param dto - The member to report, the category and the details.
   * @throws {BadRequestException} When a member tries to report themselves.
   * @throws {NotFoundException} When no active member matches the username.
   * @throws {ConflictException} When the reporter already has an unresolved
   *   report against the same member.
   */
  async reportMember(
    reporterId: string,
    dto: CreateUserReportDto,
  ): Promise<void> {
    const target = await this._publicMemberService.requireActiveMember(
      dto.username,
    );

    if (target.userId === reporterId) {
      throw new BadRequestException('You cannot report yourself');
    }

    const existing = await this._reportRepository.findOne({
      where: {
        reporterId,
        reportedId: target.userId,
        status: In(UNRESOLVED_STATUSES),
        deletedAt: IsNull(),
      },
    });

    if (existing) {
      throw new ConflictException(
        'You already have a report about this member awaiting review',
      );
    }

    await this._reportRepository.save(
      this._reportRepository.create({
        reporterId,
        reportedId: target.userId,
        reason: dto.reason,
        details: dto.details ?? null,
        status: ReportStatus.OPEN,
      }),
    );
  }

  // ----- Admin -----

  /**
   * Lists reports for the admin queue, oldest first so the longest-waiting
   * report is dealt with first.
   *
   * @param query - Status, reason, search and pagination options.
   * @returns A page of reports, with the queue-wide unresolved count.
   */
  async findForAdmin(query: ReportQueryDto): Promise<PaginatedReportsDto> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = Math.min(
      query.pageSize && query.pageSize > 0 ? query.pageSize : DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    const builder = this.buildReportQuery();

    if (query.status) {
      builder.andWhere('report.status = :status', { status: query.status });
    }

    if (query.reason) {
      builder.andWhere('report.reason = :reason', { reason: query.reason });
    }

    if (query.search) {
      builder.andWhere(
        '(LOWER(reporterProfile.username) LIKE LOWER(:search) OR ' +
          'LOWER(reportedProfile.username) LIKE LOWER(:search))',
        { search: `%${query.search}%` },
      );
    }

    const [reports, total] = await builder
      .orderBy('report.createdAt', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: reports.map(report => this.toReport(report)),
      total,
      page,
      pageSize,
      openCount: await this.countUnresolved(),
    };
  }

  /**
   * Retrieves a single report for the admin queue.
   *
   * @param reportId - The report to retrieve.
   * @returns The report.
   * @throws {NotFoundException} When no such live report exists.
   */
  async findOneForAdmin(reportId: string): Promise<UserReportDto> {
    return this.toReport(await this.requireReport(reportId));
  }

  /**
   * Records an administrator's decision on a report.
   *
   * The reviewer and the time are stamped on every change, not only on the
   * terminal ones, so the queue always shows who last touched a report.
   *
   * @param reportId - The report to update.
   * @param adminUserId - The acting administrator's user ID.
   * @param dto - The new status and any notes.
   * @returns The updated report.
   * @throws {NotFoundException} When no such live report exists.
   */
  async updateForAdmin(
    reportId: string,
    adminUserId: string,
    dto: UpdateReportDto,
  ): Promise<UserReportDto> {
    const report = await this.requireReport(reportId);

    report.status = dto.status;
    report.moderatorNotes = dto.moderatorNotes ?? report.moderatorNotes;
    report.reviewedById = adminUserId;
    report.reviewedAt = new Date();

    await this._reportRepository.save(report);

    return this.toReport(await this.requireReport(reportId));
  }

  /**
   * Counts the reports still waiting on an administrator.
   *
   * @returns The number of unresolved reports.
   */
  countUnresolved(): Promise<number> {
    return this._reportRepository.count({
      where: { status: In(UNRESOLVED_STATUSES), deletedAt: IsNull() },
    });
  }

  /**
   * Counts the unresolved reports naming each of the given members.
   *
   * Drives the "reports against this member" figure on the admin user list, so
   * a single query answers for the whole page.
   *
   * @param userIds - The reported members' user IDs.
   * @returns A map from user ID to unresolved report count, omitting members
   *   with none.
   */
  async countUnresolvedByReportedUser(
    userIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (userIds.length === 0) {
      return counts;
    }

    const rows = await this._reportRepository
      .createQueryBuilder('report')
      .select('report.reportedId', 'reportedId')
      .addSelect('COUNT(report.id)', 'count')
      .where('report.reportedId IN (:...userIds)', { userIds })
      .andWhere('report.status IN (:...statuses)', {
        statuses: UNRESOLVED_STATUSES,
      })
      .andWhere('report.deletedAt IS NULL')
      .groupBy('report.reportedId')
      .getRawMany<{ reportedId: string; count: string }>();

    for (const row of rows) {
      counts.set(row.reportedId, Number(row.count));
    }

    return counts;
  }

  /**
   * Resolves every unresolved report naming a member as actioned.
   *
   * Called when an administrator disables an account: the reports that led
   * there are closed in the same breath, so the queue does not keep offering
   * complaints that have already been acted on.
   *
   * @param reportedId - The disabled member's user ID.
   * @param adminUserId - The acting administrator's user ID.
   * @returns The number of reports closed.
   */
  async actionReportsAgainst(
    reportedId: string,
    adminUserId: string,
  ): Promise<number> {
    const result = await this._reportRepository.update(
      {
        reportedId,
        status: In(UNRESOLVED_STATUSES),
        deletedAt: IsNull(),
      },
      {
        status: ReportStatus.ACTIONED,
        reviewedById: adminUserId,
        reviewedAt: new Date(),
      },
    );

    return result.affected ?? 0;
  }

  // ----- Helpers -----

  /**
   * Loads a live report with both members and the reviewer attached.
   *
   * @param reportId - The report to load.
   * @returns The report entity.
   * @throws {NotFoundException} When no such live report exists.
   */
  private async requireReport(reportId: string): Promise<UserReportEntity> {
    const report = await this.buildReportQuery()
      .andWhere('report.id = :reportId', { reportId })
      .getOne();

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    return report;
  }

  /**
   * Starts a report query with both members, their profiles and the reviewer
   * joined in.
   *
   * The joins are left joins throughout: a reported member may never have
   * created a profile, and a report is not yet reviewed.
   *
   * @returns The query builder.
   */
  private buildReportQuery() {
    return this._reportRepository
      .createQueryBuilder('report')
      .leftJoinAndSelect('report.reporter', 'reporter')
      .leftJoinAndSelect('reporter.profile', 'reporterProfile')
      .leftJoinAndSelect('report.reported', 'reported')
      .leftJoinAndSelect('reported.profile', 'reportedProfile')
      .leftJoinAndSelect('report.reviewedBy', 'reviewer')
      .leftJoinAndSelect('reviewer.profile', 'reviewerProfile')
      .where('report.deletedAt IS NULL');
  }

  /**
   * Maps a report entity onto its admin DTO.
   *
   * @param report - The report entity, with its relations loaded.
   * @returns The report DTO.
   */
  private toReport(report: UserReportEntity): UserReportDto {
    return {
      id: report.id,
      reporter: this.toParty(report.reporterId, report.reporter),
      reported: this.toParty(report.reportedId, report.reported),
      reason: report.reason,
      details: report.details,
      status: report.status,
      moderatorNotes: report.moderatorNotes,
      reviewedBy:
        report.reviewedBy?.profile?.username ??
        report.reviewedBy?.email ??
        null,
      reviewedAt: report.reviewedAt,
      createdAt: report.createdAt,
    };
  }

  /**
   * Maps one side of a report onto its DTO.
   *
   * Falls back to the ID-only shape when the user row has gone, which a
   * cascading delete makes possible between the report being raised and the
   * queue being read.
   *
   * @param userId - The member's user ID.
   * @param user - The loaded user, when still present.
   * @returns The party DTO.
   */
  private toParty(userId: string, user: UserEntity | null): ReportPartyDto {
    return {
      userId,
      username: user?.profile?.username ?? null,
      profilePicture100: user?.profile?.profilePicture100 ?? null,
      isAccountDisabled: user?.isAccountDisabled ?? false,
    };
  }
}
