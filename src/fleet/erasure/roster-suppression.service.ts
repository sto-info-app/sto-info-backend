import { createHmac } from 'node:crypto';

import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import {
  normaliseRosterAccountHandle,
  normaliseRosterCharacterName,
} from '../imports/utilities/roster-identity.utility';
import { ERASED_COLUMNS, ERASED_MEMBER_NAME } from './roster-erasure.constants';
import { RosterErasureEntity } from './roster-erasure.entity';

/** The erasure key, or null where it has not been configured. */
export interface RosterErasureKey {
  readonly value: string | null;
}

/** The injection token for {@link RosterErasureKey}. */
export const ROSTER_ERASURE_KEY = Symbol('ROSTER_ERASURE_KEY');

/** Rewrites one sanitised roster row, if it names somebody erased. */
export type RosterRowScrubber = (row: readonly string[]) => string[];

/**
 * The suppression list every roster import is scrubbed against (FC-038).
 *
 * Steve's decisions of 29 September 2026: a site-wide list of erased
 * Character name and @handle pairs, held only as HMAC-SHA256 hashes keyed
 * with `rosterErasureKey`, so a copy of the list reveals nothing without the
 * key. A row whose pair is on it is rewritten before anything is stored —
 * the sanitised file included — to the erasure's pseudonym, with no public
 * comment.
 *
 * With erasures on the list and no key, nothing can be matched, so an
 * import is refused rather than stored unscrubbed.
 */
@Injectable()
export class RosterSuppressionService {
  /**
   * Creates an instance of RosterSuppressionService.
   *
   * @param _dataSource - The database.
   * @param _key - The erasure key.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    @Inject(ROSTER_ERASURE_KEY)
    private readonly _key: RosterErasureKey,
  ) {}

  /**
   * The hash of a pair as a roster writes it.
   *
   * @param characterName - The Character name.
   * @param accountHandle - The @handle.
   * @returns The hash, as hex.
   * @throws ServiceUnavailableException when there is no key.
   */
  hashOf(characterName: string, accountHandle: string): string {
    return this.hashOfNormalised(
      normaliseRosterCharacterName(characterName),
      normaliseRosterAccountHandle(accountHandle),
    );
  }

  /**
   * The hash of a pair already normalised, as stored rows hold it.
   *
   * @param characterName - The normalised Character name.
   * @param accountHandle - The normalised @handle.
   * @returns The hash, as hex.
   * @throws ServiceUnavailableException when there is no key.
   */
  hashOfNormalised(characterName: string, accountHandle: string): string {
    return createHmac('sha256', this.requireKey())
      .update(JSON.stringify([characterName, accountHandle]))
      .digest('hex');
  }

  /**
   * A scrubber for the list as it stands.
   *
   * @returns A function rewriting a row that names somebody erased; the row
   *   unchanged otherwise.
   * @throws ServiceUnavailableException when there are erasures and no key.
   */
  async scrubber(): Promise<RosterRowScrubber> {
    const erasures = await this._dataSource.manager.find(RosterErasureEntity, {
      select: { id: true, pairHash: true, pseudonym: true },
    });

    if (erasures.length === 0) {
      return row => [...row];
    }

    const byHash = new Map(
      erasures.map(erasure => [erasure.pairHash, erasure.pseudonym]),
    );

    this.requireKey();

    return row => {
      const pseudonym = byHash.get(
        this.hashOf(
          row[ERASED_COLUMNS.characterName],
          row[ERASED_COLUMNS.accountHandle],
        ),
      );

      return pseudonym === undefined ? [...row] : erasedRow(row, pseudonym);
    };
  }

  /**
   * The key, or a refusal.
   *
   * @returns The key.
   * @throws ServiceUnavailableException when there is none.
   */
  private requireKey(): string {
    if (this._key.value === null) {
      throw new ServiceUnavailableException(
        'Roster erasure is not configured on this server.',
      );
    }

    return this._key.value;
  }
}

/**
 * A row with its erased member's name, handle and comment replaced.
 *
 * @param row - The row.
 * @param pseudonym - The erasure's handle.
 * @returns The rewritten row.
 */
export function erasedRow(row: readonly string[], pseudonym: string): string[] {
  const rewritten = [...row];

  rewritten[ERASED_COLUMNS.characterName] = ERASED_MEMBER_NAME;
  rewritten[ERASED_COLUMNS.accountHandle] = pseudonym;
  rewritten[ERASED_COLUMNS.publicComment] = '';

  return rewritten;
}
