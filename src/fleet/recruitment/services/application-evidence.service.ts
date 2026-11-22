import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { RosterIdentityAliasEntity } from '../../identity/entities/roster-identity-alias.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import {
  normaliseRosterCharacterName,
  rosterRowFullHandle,
} from '../../imports/utilities/roster-identity.utility';
import { RosterEpisodeEntity } from '../../projection/entities/roster-episode.entity';
import { PublishedRosterRevisionService } from '../../roster/services/published-roster-revision.service';
import { ApplicationRosterEvidenceDto } from '../dto/fleet-application.dto';

/** The two things about a Character the roster can be matched on. */
export interface EvidenceCharacter {
  /** Its name, as the Character record holds it. */
  readonly handle: string;
  /** `Name@handle`, folded, as `character.fullHandleNormalized` holds it. */
  readonly fullHandleNormalized: string;
}

/**
 * What a Fleet's roster says about an applicant's Character (FC-021).
 *
 * Evidence a decider is shown and nothing more: nothing reads this to approve
 * anything, which is the story's third criterion. A roster row is matched to
 * a registered Character exactly as FC-018's proposals and FC-020's profile
 * links match them, by the folded `Name@handle`, and read from the Fleet's
 * published revision, as every roster page is.
 */
@Injectable()
export class ApplicationEvidenceService {
  /**
   * Creates an instance of ApplicationEvidenceService.
   *
   * @param _published - Which revision to read.
   * @param _aliases - The names each roster member has been listed under.
   * @param _episodes - Each member's continuous runs on the roster.
   * @param _observations - The rows each export listed.
   */
  constructor(
    private readonly _published: PublishedRosterRevisionService,
    @InjectRepository(RosterIdentityAliasEntity)
    private readonly _aliases: Repository<RosterIdentityAliasEntity>,
    @InjectRepository(RosterEpisodeEntity)
    private readonly _episodes: Repository<RosterEpisodeEntity>,
    @InjectRepository(RosterObservationEntity)
    private readonly _observations: Repository<RosterObservationEntity>,
  ) {}

  /**
   * Reads the roster's evidence about one Character in one Fleet.
   *
   * @param fleetId - The Fleet.
   * @param character - The Character.
   * @returns Whether the latest export lists it, since when, at what rank,
   *   and whether any ever has.
   */
  async forCharacter(
    fleetId: string,
    character: EvidenceCharacter,
  ): Promise<ApplicationRosterEvidenceDto> {
    const pinned = await this._published.pin(fleetId);
    const exports = await this._published.effectiveExports(
      fleetId,
      pinned.revision,
    );
    const latest = exports.length === 0 ? null : exports[exports.length - 1];

    const aliases = (
      await this._aliases.find({
        where: {
          fleetId,
          characterNameNormalised: normaliseRosterCharacterName(
            character.handle,
          ),
        },
      })
    ).filter(
      alias =>
        rosterRowFullHandle(alias.characterName, alias.accountHandle) ===
        character.fullHandleNormalized,
    );

    const unlisted: ApplicationRosterEvidenceDto = {
      listed: false,
      latestExportAt: latest?.exportedAt ?? null,
      listedSince: null,
      rank: null,
      everListed: false,
    };

    if (aliases.length === 0) {
      return unlisted;
    }

    const episodes =
      pinned.revision === 0
        ? []
        : await this._episodes.find({
            where: {
              fleetId,
              revision: pinned.revision,
              identityId: In([...new Set(aliases.map(a => a.identityId))]),
            },
          });
    const everListed = episodes.length > 0;
    const current =
      latest === null
        ? undefined
        : episodes.find(episode => episode.lastImportId === latest.importId);

    if (latest === null || current === undefined) {
      return { ...unlisted, everListed };
    }

    const rows = await this._observations.find({
      where: {
        fleetId,
        importSourceId: latest.importId,
        characterNameNormalised: In(
          aliases.map(alias => alias.characterNameNormalised),
        ),
      },
      select: {
        id: true,
        characterName: true,
        accountHandle: true,
        guildRank: true,
      },
    });
    const row = rows.find(
      candidate =>
        rosterRowFullHandle(
          candidate.characterName,
          candidate.accountHandle,
        ) === character.fullHandleNormalized,
    );

    return {
      listed: true,
      latestExportAt: latest.exportedAt,
      listedSince: current.firstObservedAt,
      rank: row?.guildRank ?? null,
      everListed: true,
    };
  }
}
