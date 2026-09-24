import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, FindOptionsWhere, In } from 'typeorm';

import { RosterImportSourceEntity } from '../../imports/entities/roster-import-source.entity';
import {
  resolveDirectoryPage,
  resolveDirectoryPageSize,
} from '../../utilities/directory-query.utility';
import { rosterIdentityLockKey } from '../constants/roster-identity.constants';
import { DecideRosterIdentityCandidateDto } from '../dto/decide-roster-identity-candidate.dto';
import { RosterIdentityCandidateQueryDto } from '../dto/roster-identity-candidate-query.dto';
import {
  RosterIdentityAliasDto,
  RosterIdentityCandidateDto,
  RosterIdentityCandidatePageDto,
} from '../dto/roster-identity-candidate.dto';
import { RosterIdentityAliasEntity } from '../entities/roster-identity-alias.entity';
import { RosterIdentityCandidateEntity } from '../entities/roster-identity-candidate.entity';
import { RosterIdentityDecisionEntity } from '../entities/roster-identity-decision.entity';
import { RosterIdentityCandidateState } from '../enums/roster-identity-candidate-state.enum';
import { RosterIdentityDecisionAction } from '../enums/roster-identity-decision-action.enum';
import { RosterIdentityQueueService } from './roster-identity-queue.service';

/**
 * Where each action may be taken from, and where it leaves the candidate.
 *
 * Confirming and rejecting decide an open candidate; undoing returns a decided
 * one to open. Nothing goes from confirmed to rejected in one step, so the
 * history always shows the undo that separated two opposite decisions.
 */
const TRANSITIONS: Readonly<
  Record<
    RosterIdentityDecisionAction,
    {
      readonly from: readonly RosterIdentityCandidateState[];
      readonly to: RosterIdentityCandidateState;
      readonly refusal: string;
    }
  >
> = {
  [RosterIdentityDecisionAction.CONFIRM]: {
    from: [RosterIdentityCandidateState.OPEN],
    to: RosterIdentityCandidateState.CONFIRMED,
    refusal:
      'Only an open candidate can be confirmed. Undo its decision first.',
  },
  [RosterIdentityDecisionAction.REJECT]: {
    from: [RosterIdentityCandidateState.OPEN],
    to: RosterIdentityCandidateState.REJECTED,
    refusal: 'Only an open candidate can be rejected. Undo its decision first.',
  },
  [RosterIdentityDecisionAction.UNDO]: {
    from: [
      RosterIdentityCandidateState.CONFIRMED,
      RosterIdentityCandidateState.REJECTED,
    ],
    to: RosterIdentityCandidateState.OPEN,
    refusal: 'This candidate has no decision to undo.',
  },
};

/**
 * A Fleet's rename candidates, as a reviewer reads and decides them.
 *
 * FC-018's first two acceptance criteria are about what is never merged
 * without a person, and this is the person's side of it. Everything here is
 * scoped to one Fleet by the route, and a candidate of another Fleet is
 * reported as missing rather than refused, like an import of another Fleet.
 *
 * ## A decision changes the candidate, and the recompute does the rest
 *
 * Confirming a rename does not touch an alias. It records the decision and
 * queues the Fleet's recompute, which works out from every confirmed
 * candidate's links which aliases share an identity; undoing is the same in
 * reverse. So a decision and the identities it implies can never disagree
 * for longer than one queued job, and no path exists by which a decision
 * could change an STO Info account: the recompute writes only roster tables.
 *
 * ## Serialised with the recompute
 *
 * A decision takes the same per-Fleet lock as the recompute. Without it a
 * recompute that had read an undecided candidate could remove it just after a
 * reviewer confirmed it, and the decision would go with it.
 *
 * ## Versioned
 *
 * Each decision is a new row, numbered by the candidate's revision, and the
 * reviewer must name the revision they saw. Two reviewers deciding one
 * candidate at once are therefore told, rather than the second silently
 * overturning the first.
 */
@Injectable()
export class RosterIdentityReviewService {
  private readonly _logger = new Logger(RosterIdentityReviewService.name);

  /**
   * Creates an instance of RosterIdentityReviewService.
   *
   * @param _dataSource - The connection decisions take their transaction on.
   * @param _queue - Asks for the Fleet's identities to be recomputed.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _queue: RosterIdentityQueueService,
  ) {}

  /**
   * Lists a Fleet's rename candidates, open ones first, newest first within.
   *
   * @param fleetId - The Fleet.
   * @param query - Which page, and which state.
   * @returns The page.
   */
  async list(
    fleetId: string,
    query: RosterIdentityCandidateQueryDto,
  ): Promise<RosterIdentityCandidatePageDto> {
    const page = resolveDirectoryPage(query.page);
    const pageSize = resolveDirectoryPageSize(query.pageSize);
    const where: FindOptionsWhere<RosterIdentityCandidateEntity> = {
      fleetId,
      ...(query.state === undefined ? {} : { state: query.state }),
    };

    const [candidates, total] = await this._dataSource.manager.findAndCount(
      RosterIdentityCandidateEntity,
      {
        where,
        relations: { links: true },
        // The enum's own order puts OPEN first. The identifier breaks ties,
        // so two suggested in one instant cannot swap between pages.
        order: { state: 'ASC', createdAt: 'DESC', id: 'DESC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      },
    );

    return {
      items: await this.describe(this._dataSource.manager, candidates),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Records a reviewer's decision, and asks for the identities to follow.
   *
   * @param fleetId - The Fleet the route names.
   * @param candidateId - The candidate.
   * @param userId - The reviewer.
   * @param decision - What they decided, the revision they saw and why.
   * @returns The candidate as it now stands.
   * @throws NotFoundException when the Fleet has no such candidate.
   * @throws ConflictException when it has changed since the reviewer saw it,
   *   cannot be resolved, or is not in a state the action applies to.
   */
  async decide(
    fleetId: string,
    candidateId: string,
    userId: string,
    decision: DecideRosterIdentityCandidateDto,
  ): Promise<RosterIdentityCandidateDto> {
    const transition = TRANSITIONS[decision.action];

    const described = await this._dataSource.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        rosterIdentityLockKey(fleetId),
      ]);

      const candidate = await manager.findOne(RosterIdentityCandidateEntity, {
        where: { id: candidateId, fleetId },
        lock: { mode: 'pessimistic_write' },
      });

      if (candidate === null) {
        throw new NotFoundException(
          `Rename candidate with ID "${candidateId}" not found`,
        );
      }

      if (candidate.revision !== decision.revision) {
        throw new ConflictException(
          'This candidate has changed since you loaded it. Reload it and ' +
            'decide again.',
        );
      }

      if (candidate.collisionReasons.length > 0) {
        throw new ConflictException(
          'The evidence fits more than one reading, so this candidate ' +
            'cannot be decided.',
        );
      }

      if (!transition.from.includes(candidate.state)) {
        throw new ConflictException(transition.refusal);
      }

      const revision = candidate.revision + 1;

      await manager.insert(RosterIdentityDecisionEntity, {
        candidateId,
        fleetId,
        action: decision.action,
        fromState: candidate.state,
        toState: transition.to,
        revision,
        actorUserId: userId,
        reason: decision.reason ?? null,
      });

      await manager.update(
        RosterIdentityCandidateEntity,
        { id: candidateId },
        { state: transition.to, revision },
      );

      const updated = await manager.findOneOrFail(
        RosterIdentityCandidateEntity,
        { where: { id: candidateId }, relations: { links: true } },
      );

      const [dto] = await this.describe(manager, [updated]);

      return dto;
    });

    this._logger.log(
      `[decide] Rename candidate decided - FleetId: ${fleetId}, ` +
        `CandidateId: ${candidateId}, Action: ${decision.action}, ` +
        `Revision: ${described.revision}`,
    );

    await this._queue.enqueue(fleetId);

    return described;
  }

  /**
   * Turns candidates into what a reviewer is shown.
   *
   * Their aliases, the exports they cite and their decisions are read in one
   * query each, whatever the size of the page.
   *
   * @param manager - The manager to read through.
   * @param candidates - The candidates, with their links.
   * @returns What a reviewer is shown of each, in the same order.
   */
  private async describe(
    manager: EntityManager,
    candidates: readonly RosterIdentityCandidateEntity[],
  ): Promise<RosterIdentityCandidateDto[]> {
    if (candidates.length === 0) {
      return [];
    }

    const aliasIds = [
      ...new Set(
        candidates.flatMap(candidate =>
          candidate.links.flatMap(link => [link.fromAliasId, link.toAliasId]),
        ),
      ),
    ];
    const importIds = [
      ...new Set(
        candidates.flatMap(candidate => [
          candidate.earlierImportId,
          candidate.laterImportId,
        ]),
      ),
    ];

    const [aliases, imports, decisions] = await Promise.all([
      manager.find(RosterIdentityAliasEntity, {
        where: { id: In(aliasIds) },
      }),
      manager.find(RosterImportSourceEntity, {
        where: { id: In(importIds) },
        select: { id: true, exportedAt: true },
      }),
      manager.find(RosterIdentityDecisionEntity, {
        where: { candidateId: In(candidates.map(candidate => candidate.id)) },
        relations: { actor: { profile: true } },
        order: { revision: 'DESC' },
      }),
    ]);

    const aliasById = new Map(aliases.map(alias => [alias.id, alias]));
    const exportedAtById = new Map(
      imports.map(record => [record.id, record.exportedAt]),
    );

    return candidates.map(candidate => ({
      id: candidate.id,
      kind: candidate.kind,
      state: candidate.state,
      decidable:
        candidate.state === RosterIdentityCandidateState.OPEN &&
        candidate.collisionReasons.length === 0,
      confidence: candidate.confidence,
      signals: candidate.signals.map(each => ({ ...each })),
      collisionReasons: [...candidate.collisionReasons],
      stale: candidate.stale,
      revision: candidate.revision,
      earlier: {
        importId: candidate.earlierImportId,
        exportedAt: exportedAtById.get(candidate.earlierImportId) ?? null,
      },
      later: {
        importId: candidate.laterImportId,
        exportedAt: exportedAtById.get(candidate.laterImportId) ?? null,
      },
      links: [...candidate.links]
        .map(link => ({
          from: this.alias(aliasById.get(link.fromAliasId)!),
          to: this.alias(aliasById.get(link.toAliasId)!),
        }))
        .sort((a, b) =>
          a.from.characterName.localeCompare(b.from.characterName),
        ),
      decisions: decisions
        .filter(decision => decision.candidateId === candidate.id)
        .map(decision => ({
          action: decision.action,
          fromState: decision.fromState,
          toState: decision.toState,
          revision: decision.revision,
          reason: decision.reason,
          decidedAt: decision.decidedAt,
          actorUsername: decision.actor?.profile?.username ?? null,
        })),
      createdAt: candidate.createdAt,
    }));
  }

  /**
   * What a reviewer is shown of one alias.
   *
   * @param alias - The alias.
   * @returns Its names, identity and observed dates.
   */
  private alias(alias: RosterIdentityAliasEntity): RosterIdentityAliasDto {
    return {
      aliasId: alias.id,
      identityId: alias.identityId,
      characterName: alias.characterName,
      accountHandle: alias.accountHandle,
      firstObservedAt: alias.firstObservedAt,
      lastObservedAt: alias.lastObservedAt,
    };
  }
}
