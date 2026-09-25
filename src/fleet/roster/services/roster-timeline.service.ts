import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { RosterIdentityAliasEntity } from '../../identity/entities/roster-identity-alias.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { rosterRowFullHandle } from '../../imports/utilities/roster-identity.utility';
import { RosterChangeEntity } from '../../projection/entities/roster-change.entity';
import { RosterEpisodeEntity } from '../../projection/entities/roster-episode.entity';
import {
  RosterEpisodeDto,
  RosterMemberRowDto,
  RosterTimelineDto,
} from '../dto/roster-history.dto';
import { toRosterChangeDto } from '../utilities/roster-change.mapper';
import {
  EffectiveRosterExport,
  PublishedRosterRevisionService,
} from './published-roster-revision.service';
import { RosterProfileLinkService } from './roster-profile-link.service';
import { RosterRankOrderService } from './roster-rank-order.service';
import { RosterViewer } from './roster-view.service';

/**
 * Reads one member's history in a Fleet (FC-020).
 *
 * For `roster.view` holders, from the published revision: the member's
 * episodes, every change including contribution, and their row on each
 * effective export listing them (Steve's decisions of 25 September 2026).
 * Rows an investigator excluded are shown to investigators alone, as on the
 * roster, and the registry link follows the roster's rule, applied to the
 * latest export listing them.
 */
@Injectable()
export class RosterTimelineService {
  /**
   * Creates an instance of RosterTimelineService.
   *
   * @param _revisions - Pins the reader to the published revision.
   * @param _episodes - Each revision's episodes.
   * @param _changes - Each revision's changes.
   * @param _observations - Every row of every export.
   * @param _rankOrder - Reads the Fleet's rank order.
   * @param _profileLinks - Decides whether the member may link to a
   *   registry page.
   */
  constructor(
    private readonly _revisions: PublishedRosterRevisionService,
    @InjectRepository(RosterEpisodeEntity)
    private readonly _episodes: Repository<RosterEpisodeEntity>,
    @InjectRepository(RosterChangeEntity)
    private readonly _changes: Repository<RosterChangeEntity>,
    @InjectRepository(RosterObservationEntity)
    private readonly _observations: Repository<RosterObservationEntity>,
    private readonly _rankOrder: RosterRankOrderService,
    private readonly _profileLinks: RosterProfileLinkService,
  ) {}

  /**
   * Reads one member's timeline.
   *
   * @param fleetId - The Fleet.
   * @param identityId - The member.
   * @param viewer - Who is reading.
   * @returns Their episodes, changes and rows.
   * @throws NotFoundException when the published revision has nothing of
   *   them — including a member of another Fleet, or one whose names a
   *   confirmed rename has since joined to another member.
   */
  async timeline(
    fleetId: string,
    identityId: string,
    viewer: RosterViewer,
  ): Promise<RosterTimelineDto> {
    const pinned = await this._revisions.pin(fleetId);
    const episodes = await this._episodes.find({
      where: { fleetId, revision: pinned.revision, identityId },
      order: { ordinal: 'ASC' },
    });
    const rows = await this.rows(fleetId, pinned.revision, identityId, viewer);

    if (episodes.length === 0 && rows.length === 0) {
      throw new NotFoundException('Not found');
    }

    const changes = await this._changes.find({
      where: { fleetId, revision: pinned.revision, identityId },
      order: { toAt: 'ASC', episodeOrdinal: 'ASC' },
    });
    const tiers = await this._rankOrder.tiers(fleetId);
    const latest = rows.length > 0 ? rows[rows.length - 1] : null;
    const member =
      latest === null
        ? null
        : {
            characterName: latest.characterName,
            accountHandle: latest.accountHandle,
          };
    const links =
      latest === null
        ? new Map()
        : await this._profileLinks.find(
            fleetId,
            latest.exportedAt,
            [latest],
            viewer.userId,
          );

    return {
      ...pinned,
      identityId,
      member,
      profile:
        latest === null
          ? null
          : (links.get(
              rosterRowFullHandle(latest.characterName, latest.accountHandle),
            ) ?? null),
      episodes: episodes.map(toEpisodeDto),
      changes: changes.map(change =>
        toRosterChangeDto(change, tiers, null, true),
      ),
      rows: rows.map(row => ({
        ...row,
        rankTier: tiers.get(row.guildRank) ?? null,
      })),
    };
  }

  /**
   * Reads the member's row on each effective export listing them.
   *
   * @param fleetId - The Fleet.
   * @param revision - The revision pinned.
   * @param identityId - The member.
   * @param viewer - Who is reading.
   * @returns Their rows, oldest export first, without tiers.
   */
  private async rows(
    fleetId: string,
    revision: number,
    identityId: string,
    viewer: RosterViewer,
  ): Promise<Array<Omit<RosterMemberRowDto, 'rankTier'>>> {
    const effective = await this._revisions.effectiveExports(fleetId, revision);

    if (effective.length === 0) {
      return [];
    }

    const byImport = new Map(effective.map(entry => [entry.importId, entry]));
    const builder = this._observations
      .createQueryBuilder('o')
      .innerJoin(
        RosterIdentityAliasEntity,
        'a',
        'a.fleetId = o.fleetId AND a.characterNameNormalised = o.characterNameNormalised AND a.accountHandleNormalised = o.accountHandleNormalised',
      )
      .where('o.fleetId = :fleetId', { fleetId })
      .andWhere('a.identityId = :identityId', { identityId })
      .andWhere('o.importSourceId IN (:...importIds)', {
        importIds: [...byImport.keys()],
      });

    if (!viewer.investigator) {
      builder.andWhere('o.excluded = false');
    }

    const observations = await builder.getMany();

    return observations
      .map(observation => {
        // The query asked only for these exports' rows.
        const source = byImport.get(
          observation.importSourceId,
        ) as EffectiveRosterExport;

        return {
          importId: source.importId,
          exportedAt: source.exportedAt,
          partial: source.partial,
          line: observation.line,
          characterName: observation.characterName,
          accountHandle: observation.accountHandle,
          level: observation.level,
          guildRank: observation.guildRank,
          contributionTotal: observation.contributionTotal,
          lastActiveAt: observation.lastActiveAt,
          lastActiveAtAmbiguous: observation.lastActiveAtAmbiguous,
          excluded: observation.excluded,
        };
      })
      .sort(
        (a, b) =>
          a.exportedAt.getTime() - b.exportedAt.getTime() || a.line - b.line,
      );
  }
}

/**
 * Maps an episode for a reader.
 *
 * @param episode - The episode.
 * @returns It as a reader sees it.
 */
function toEpisodeDto(episode: RosterEpisodeEntity): RosterEpisodeDto {
  return {
    ordinal: episode.ordinal,
    startKind: episode.startKind,
    startedAfter:
      episode.startedAfterImportId === null || episode.startedAfterAt === null
        ? null
        : {
            importId: episode.startedAfterImportId,
            exportedAt: episode.startedAfterAt,
          },
    first: {
      importId: episode.firstImportId,
      exportedAt: episode.firstObservedAt,
    },
    reportedJoinedAt: episode.reportedJoinedAt,
    reportedJoinedAtAmbiguous: episode.reportedJoinedAtAmbiguous,
    last: {
      importId: episode.lastImportId,
      exportedAt: episode.lastObservedAt,
    },
    endKind: episode.endKind,
    endedBefore: episode.endedBefore,
    endedBeforeImportId: episode.endedBeforeImportId,
    baselineContribution: episode.baselineContribution,
    lastObservedContribution: episode.lastObservedContribution,
  };
}
