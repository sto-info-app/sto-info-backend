import { Repository } from 'typeorm';

import { RosterIdentityAliasEntity } from '../../identity/entities/roster-identity-alias.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import {
  rosterMemberKey,
  RosterMemberNameService,
} from './roster-member-name.service';

describe('RosterMemberNameService', () => {
  let builder: Record<string, jest.Mock>;
  let observations: { createQueryBuilder: jest.Mock };
  let service: RosterMemberNameService;

  beforeEach(() => {
    builder = {};

    for (const method of [
      'innerJoin',
      'select',
      'addSelect',
      'where',
      'andWhere',
      'orderBy',
    ]) {
      builder[method] = jest.fn(() => builder);
    }

    builder.getRawMany = jest.fn(() =>
      Promise.resolve([
        {
          importId: 'import-2',
          identityId: 'identity-1',
          characterName: 'Ilan Sorel',
          accountHandle: '@fixture040new',
        },
        {
          importId: 'import-2',
          identityId: 'identity-1',
          characterName: 'Ilan Sorel',
          accountHandle: '@fixture040old',
        },
        {
          importId: 'import-1',
          identityId: 'identity-2',
          characterName: 'Kess Varro',
          accountHandle: '@fixture030',
        },
      ]),
    );
    observations = { createQueryBuilder: jest.fn(() => builder) };
    service = new RosterMemberNameService(
      observations as unknown as Repository<RosterObservationEntity>,
    );
  });

  it('names each member as the export listed them, the top row first', async () => {
    const names = await service.names('fleet-1', [
      { importId: 'import-2', identityId: 'identity-1' },
      { importId: 'import-1', identityId: 'identity-2' },
      { importId: 'import-2', identityId: 'identity-2' },
    ]);

    expect([...names.entries()]).toEqual([
      [
        'import-2/identity-1',
        { characterName: 'Ilan Sorel', accountHandle: '@fixture040new' },
      ],
      [
        'import-1/identity-2',
        { characterName: 'Kess Varro', accountHandle: '@fixture030' },
      ],
    ]);
    expect(builder.innerJoin).toHaveBeenCalledWith(
      RosterIdentityAliasEntity,
      'a',
      expect.stringContaining(
        'a.characterNameNormalised = o.characterNameNormalised',
      ),
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'o.importSourceId IN (:...importIds)',
      { importIds: ['import-2', 'import-1'] },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'a.identityId IN (:...identityIds)',
      { identityIds: ['identity-1', 'identity-2'] },
    );
    expect(builder.orderBy).toHaveBeenCalledWith('o.line', 'ASC');
  });

  it('asks nothing when nobody is to be named', async () => {
    await expect(service.names('fleet-1', [])).resolves.toEqual(new Map());
    expect(observations.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('keys a member on an export', () => {
    expect(
      rosterMemberKey({ importId: 'import-1', identityId: 'identity-1' }),
    ).toBe('import-1/identity-1');
  });
});
