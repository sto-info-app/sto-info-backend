import { FindOperator, Repository } from 'typeorm';

import {
  RegistryCharacterPath,
  RegistryService,
} from 'src/registry/registry.service';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { CharacterFleetMembershipEntity } from '../../entities/character-fleet-membership.entity';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { RosterProfileLinkService } from './roster-profile-link.service';

const FLEET_ID = 'fleet-1';
const VIEWER_ID = 'viewer-1';
const EXPORTED_AT = new Date('2024-11-15T12:00:00Z');

const VEX = { characterName: 'Vex Loran', accountHandle: '@VexLoran' };
const TOVA = { characterName: 'Tova Reen', accountHandle: '@TovaReen' };

const VEX_PATH: RegistryCharacterPath = {
  username: 'vex',
  accountSlug: 'VexLoran',
  characterSlug: 'vex-loran@vexloran',
};

/**
 * Builds a registered Character as the service reads one.
 *
 * @param id - Its ID.
 * @param fullHandleNormalized - Its folded full handle.
 * @param userId - Its owner.
 * @returns The Character.
 */
function character(
  id: string,
  fullHandleNormalized: string,
  userId = 'owner-1',
): CharacterEntity {
  return {
    id,
    fullHandleNormalized,
    account: { id: `account-${id}`, userId },
  } as unknown as CharacterEntity;
}

describe('RosterProfileLinkService', () => {
  let characters: { find: jest.Mock };
  let memberships: { find: jest.Mock };
  let audience: { canView: jest.Mock };
  let registry: { findVisibleCharacterPaths: jest.Mock };
  let service: RosterProfileLinkService;

  beforeEach(() => {
    characters = {
      find: jest.fn(() =>
        Promise.resolve([character('character-1', 'vex loran@vexloran')]),
      ),
    };
    memberships = {
      find: jest.fn(() =>
        Promise.resolve([
          { characterId: 'character-1', visibility: FleetAudience.PUBLIC },
        ]),
      ),
    };
    audience = { canView: jest.fn(() => Promise.resolve(true)) };
    registry = {
      findVisibleCharacterPaths: jest.fn((ids: string[]) =>
        Promise.resolve(
          new Map(
            ids
              .filter(id => id === 'character-1')
              .map(id => [id, VEX_PATH] as const),
          ),
        ),
      ),
    };
    service = new RosterProfileLinkService(
      characters as unknown as Repository<CharacterEntity>,
      memberships as unknown as Repository<CharacterFleetMembershipEntity>,
      audience as unknown as FleetAudienceService,
      registry as unknown as RegistryService,
    );
  });

  it('links a row whose owner recorded the membership and left everything visible', async () => {
    const links = await service.find(
      FLEET_ID,
      EXPORTED_AT,
      [VEX, TOVA],
      VIEWER_ID,
    );

    expect([...links.entries()]).toEqual([['vex loran@vexloran', VEX_PATH]]);
    expect(characters.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          fullHandleNormalized: expect.any(FindOperator) as unknown,
        },
      }),
    );
    expect(registry.findVisibleCharacterPaths).toHaveBeenCalledWith(
      ['character-1'],
      VIEWER_ID,
    );
  });

  it('asks only about memberships covering the export', async () => {
    await service.find(FLEET_ID, EXPORTED_AT, [VEX], VIEWER_ID);

    const [{ where }] = memberships.find.mock.calls[0] as [
      { where: Array<Record<string, FindOperator<unknown> | string>> },
    ];

    expect(where).toHaveLength(2);

    for (const branch of where) {
      expect(branch.fleetId).toBe(FLEET_ID);
      expect((branch.validFrom as FindOperator<Date>).type).toBe(
        'lessThanOrEqual',
      );
      expect((branch.validFrom as FindOperator<Date>).value).toBe(EXPORTED_AT);
    }

    expect((where[0].validTo as FindOperator<unknown>).type).toBe('isNull');
    expect((where[1].validTo as FindOperator<Date>).type).toBe('moreThan');
    expect((where[1].validTo as FindOperator<Date>).value).toBe(EXPORTED_AT);
  });

  it('asks nothing for no rows', async () => {
    const links = await service.find(FLEET_ID, EXPORTED_AT, [], VIEWER_ID);

    expect(links.size).toBe(0);
    expect(characters.find).not.toHaveBeenCalled();
  });

  it('links nothing when no row names a registered Character', async () => {
    characters.find.mockResolvedValue([]);

    const links = await service.find(FLEET_ID, EXPORTED_AT, [VEX], VIEWER_ID);

    expect(links.size).toBe(0);
    expect(memberships.find).not.toHaveBeenCalled();
  });

  it('never links a Character whose owner recorded no membership then', async () => {
    memberships.find.mockResolvedValue([]);

    const links = await service.find(FLEET_ID, EXPORTED_AT, [VEX], VIEWER_ID);

    expect(links.size).toBe(0);
    expect(registry.findVisibleCharacterPaths).toHaveBeenCalledWith(
      [],
      VIEWER_ID,
    );
  });

  it('links neither of two claimed Characters sharing a handle', async () => {
    characters.find.mockResolvedValue([
      character('character-1', 'vex loran@vexloran'),
      character('character-2', 'vex loran@vexloran', 'owner-2'),
    ]);
    memberships.find.mockResolvedValue([
      { characterId: 'character-1', visibility: FleetAudience.PUBLIC },
      { characterId: 'character-2', visibility: FleetAudience.PUBLIC },
    ]);

    const links = await service.find(FLEET_ID, EXPORTED_AT, [VEX], VIEWER_ID);

    expect(links.size).toBe(0);
  });

  it('links the one claimed Character when another shares its handle unclaimed', async () => {
    characters.find.mockResolvedValue([
      character('character-1', 'vex loran@vexloran'),
      character('character-2', 'vex loran@vexloran', 'owner-2'),
    ]);

    const links = await service.find(FLEET_ID, EXPORTED_AT, [VEX], VIEWER_ID);

    expect(links.get('vex loran@vexloran')).toEqual(VEX_PATH);
  });

  it('holds a membership to its own audience, asking once per audience', async () => {
    characters.find.mockResolvedValue([
      character('character-1', 'vex loran@vexloran'),
      character('character-3', 'tova reen@tovareen'),
    ]);
    memberships.find.mockResolvedValue([
      { characterId: 'character-1', visibility: FleetAudience.FLEET_MEMBERS },
      { characterId: 'character-3', visibility: FleetAudience.FLEET_MEMBERS },
    ]);
    audience.canView.mockResolvedValue(false);

    const links = await service.find(
      FLEET_ID,
      EXPORTED_AT,
      [VEX, TOVA],
      VIEWER_ID,
    );

    expect(links.size).toBe(0);
    expect(audience.canView).toHaveBeenCalledTimes(1);
    expect(audience.canView).toHaveBeenCalledWith(
      FleetAudience.FLEET_MEMBERS,
      { kind: FleetScopeKind.FLEET, id: FLEET_ID },
      VIEWER_ID,
    );
  });

  // PRIVATE on a membership is the Character's owner, not the Community's.
  it('shows a private membership to the Character’s owner alone', async () => {
    memberships.find.mockResolvedValue([
      { characterId: 'character-1', visibility: FleetAudience.PRIVATE },
    ]);

    const other = await service.find(FLEET_ID, EXPORTED_AT, [VEX], VIEWER_ID);
    const owner = await service.find(FLEET_ID, EXPORTED_AT, [VEX], 'owner-1');

    expect(other.size).toBe(0);
    expect(owner.get('vex loran@vexloran')).toEqual(VEX_PATH);
    expect(audience.canView).not.toHaveBeenCalled();
  });

  it('leaves a row unlinked when the registry would not show the page', async () => {
    registry.findVisibleCharacterPaths.mockResolvedValue(new Map());

    const links = await service.find(FLEET_ID, EXPORTED_AT, [VEX], VIEWER_ID);

    expect(links.size).toBe(0);
  });
});
