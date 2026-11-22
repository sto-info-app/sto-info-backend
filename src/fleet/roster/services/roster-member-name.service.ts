import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { RosterIdentityAliasEntity } from '../../identity/entities/roster-identity-alias.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { RosterMemberNameDto } from '../dto/roster-history.dto';

/** A member on one export. */
export interface RosterMemberAt {
  /** The export. */
  readonly importId: string;
  /** The member. */
  readonly identityId: string;
}

/**
 * Names members as particular exports listed them (FC-020).
 *
 * A stored change records its member only by identity, which is a UUID and
 * survives renames. A reader wants a name: the one the export that showed
 * the change listed, so a departure reads under the name its member left
 * with and a rename under the name it became.
 */
@Injectable()
export class RosterMemberNameService {
  /**
   * Creates an instance of RosterMemberNameService.
   *
   * @param _observations - Every row of every export.
   */
  constructor(
    @InjectRepository(RosterObservationEntity)
    private readonly _observations: Repository<RosterObservationEntity>,
  ) {}

  /**
   * Names some members on some exports.
   *
   * Where an export lists a member twice — a confirmed rename whose names are
   * both still listed — the row nearer the top names them.
   *
   * @param fleetId - The Fleet.
   * @param wanted - The members and the exports to name them from.
   * @returns Each member's name and handle, by {@link rosterMemberKey}. A
   *   member an export does not list is absent.
   */
  async names(
    fleetId: string,
    wanted: readonly RosterMemberAt[],
  ): Promise<Map<string, RosterMemberNameDto>> {
    const names = new Map<string, RosterMemberNameDto>();

    if (wanted.length === 0) {
      return names;
    }

    const rows = await this._observations
      .createQueryBuilder('o')
      .innerJoin(
        RosterIdentityAliasEntity,
        'a',
        'a.fleetId = o.fleetId AND a.characterNameNormalised = o.characterNameNormalised AND a.accountHandleNormalised = o.accountHandleNormalised',
      )
      .select('o.importSourceId', 'importId')
      .addSelect('a.identityId', 'identityId')
      .addSelect('o.characterName', 'characterName')
      .addSelect('o.accountHandle', 'accountHandle')
      .where('o.fleetId = :fleetId', { fleetId })
      .andWhere('o.importSourceId IN (:...importIds)', {
        importIds: [...new Set(wanted.map(member => member.importId))],
      })
      .andWhere('a.identityId IN (:...identityIds)', {
        identityIds: [...new Set(wanted.map(member => member.identityId))],
      })
      .orderBy('o.line', 'ASC')
      .getRawMany<RosterMemberAt & RosterMemberNameDto>();

    for (const row of rows) {
      const key = rosterMemberKey(row);

      if (!names.has(key)) {
        names.set(key, {
          characterName: row.characterName,
          accountHandle: row.accountHandle,
        });
      }
    }

    return names;
  }
}

/**
 * Keys a member on an export.
 *
 * @param member - The member and export.
 * @returns The key {@link RosterMemberNameService.names} answers by.
 */
export function rosterMemberKey(member: RosterMemberAt): string {
  return `${member.importId}/${member.identityId}`;
}
