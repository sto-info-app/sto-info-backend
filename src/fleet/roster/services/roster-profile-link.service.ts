import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, IsNull, LessThanOrEqual, MoreThan, Repository } from 'typeorm';

import {
  RegistryCharacterPath,
  RegistryService,
} from 'src/registry/registry.service';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { CharacterFleetMembershipEntity } from '../../entities/character-fleet-membership.entity';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { rosterRowFullHandle } from '../../imports/utilities/roster-identity.utility';

/** The two columns of a roster row that name a Character. */
export interface RosterRowName {
  /** The Character name, exactly as exported. */
  readonly characterName: string;
  /** The account handle, exactly as exported. */
  readonly accountHandle: string;
}

/**
 * Decides which roster rows may link to a Character's registry page
 * (FC-020, carrying FC-015's rule).
 *
 * A roster row is evidence that somebody by that name and handle was listed.
 * It never says whose Character it is — ADR-0002 — so a row links only where
 * the Character's owner has said so and every privacy setting on the way
 * lets the viewer through (Steve's decisions of 25 September 2026):
 *
 * 1. A registered Character has the row's exact full handle.
 * 2. Its owner has recorded a membership of this Fleet covering the moment of
 *    the export shown, whatever established it. A row naming two Characters
 *    so claimed — two accounts can share a handle — links to neither.
 * 3. The membership's own audience includes the viewer. `PRIVATE` there is
 *    the Character's owner alone — the owning user the audience names — not
 *    the Community's Owner, as it is for a Fleet record.
 * 4. The registry would show the viewer the Character's page: profile,
 *    account and Character public, and no block between them.
 *
 * Any of these failing leaves the row unlinked, and the response does not
 * say which: a hidden Character is indistinguishable from an unregistered
 * one.
 */
@Injectable()
export class RosterProfileLinkService {
  /**
   * Creates an instance of RosterProfileLinkService.
   *
   * @param _characters - Registered Characters.
   * @param _memberships - Owners' records of their Characters' Fleets.
   * @param _audienceService - Decides who may see a membership.
   * @param _registryService - Decides whose registry pages may be opened.
   */
  constructor(
    @InjectRepository(CharacterEntity)
    private readonly _characters: Repository<CharacterEntity>,
    @InjectRepository(CharacterFleetMembershipEntity)
    private readonly _memberships: Repository<CharacterFleetMembershipEntity>,
    private readonly _audienceService: FleetAudienceService,
    private readonly _registryService: RegistryService,
  ) {}

  /**
   * Finds the registry pages some rows of one export may link to.
   *
   * @param fleetId - The Fleet.
   * @param exportedAt - The moment of the export the rows are from.
   * @param rows - The rows.
   * @param viewerId - The viewer.
   * @returns Each linkable row's page, by the full handle
   *   {@link rosterRowFullHandle} folds it to.
   */
  async find(
    fleetId: string,
    exportedAt: Date,
    rows: readonly RosterRowName[],
    viewerId: string,
  ): Promise<Map<string, RegistryCharacterPath>> {
    const links = new Map<string, RegistryCharacterPath>();
    const handles = [
      ...new Set(
        rows.map(row =>
          rosterRowFullHandle(row.characterName, row.accountHandle),
        ),
      ),
    ];

    if (handles.length === 0) {
      return links;
    }

    const characters = await this._characters.find({
      where: { fullHandleNormalized: In(handles) },
      relations: { account: true },
      select: {
        id: true,
        fullHandleNormalized: true,
        account: { id: true, userId: true },
      },
    });

    if (characters.length === 0) {
      return links;
    }

    const claimed = await this.claimedAt(
      fleetId,
      exportedAt,
      characters.map(character => character.id),
    );

    // A handle two claimed Characters share links to neither.
    const byHandle = new Map<string, CharacterEntity[]>();

    for (const character of characters) {
      if (claimed.has(character.id)) {
        const matches = byHandle.get(character.fullHandleNormalized) ?? [];

        matches.push(character);
        byHandle.set(character.fullHandleNormalized, matches);
      }
    }

    const visible = new Map<FleetAudience, boolean>();
    const candidates = new Map<string, string>();

    for (const [handle, matches] of byHandle) {
      if (matches.length !== 1) {
        continue;
      }

      const [character] = matches;
      const audience = claimed.get(character.id) as FleetAudience;

      if (audience === FleetAudience.PRIVATE) {
        if (character.account.userId === viewerId) {
          candidates.set(handle, character.id);
        }

        continue;
      }

      if (!visible.has(audience)) {
        visible.set(
          audience,
          await this._audienceService.canView(
            audience,
            { kind: FleetScopeKind.FLEET, id: fleetId },
            viewerId,
          ),
        );
      }

      if (visible.get(audience) === true) {
        candidates.set(handle, character.id);
      }
    }

    const paths = await this._registryService.findVisibleCharacterPaths(
      [...candidates.values()],
      viewerId,
    );

    for (const [handle, characterId] of candidates) {
      const path = paths.get(characterId);

      if (path !== undefined) {
        links.set(handle, path);
      }
    }

    return links;
  }

  /**
   * Finds which Characters their owners have recorded as in the Fleet at a
   * moment, and who may see each record.
   *
   * @param fleetId - The Fleet.
   * @param at - The moment.
   * @param characterIds - The Characters asked about.
   * @returns Each claimed Character's membership audience, by Character ID.
   */
  private async claimedAt(
    fleetId: string,
    at: Date,
    characterIds: readonly string[],
  ): Promise<Map<string, FleetAudience>> {
    const covering = {
      fleetId,
      characterId: In([...characterIds]),
      validFrom: LessThanOrEqual(at),
    };
    const memberships = await this._memberships.find({
      where: [
        { ...covering, validTo: IsNull() },
        { ...covering, validTo: MoreThan(at) },
      ],
      select: { id: true, characterId: true, visibility: true },
    });

    return new Map(
      memberships.map(membership => [
        membership.characterId,
        membership.visibility,
      ]),
    );
  }
}
