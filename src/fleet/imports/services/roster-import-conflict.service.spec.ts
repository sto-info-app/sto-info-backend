import { Logger } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { EntityManager, In, Not, Repository } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';

import { RosterImportConflictEntity } from '../entities/roster-import-conflict.entity';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterImportConflictService } from './roster-import-conflict.service';

const FLEET_ID = '11111111-1111-4111-8111-111111111111';
const GROUP_ID = '99999999-9999-4999-8999-999999999999';
const EXPORTED_AT = new Date('2024-01-01T12:00:00.000Z');

/**
 * Builds an import of the Fleet at the instant every case is about.
 *
 * @param id - Its identifier.
 * @param sanitisedSha256 - What it says, as a hash.
 * @param state - Where its asset has got to.
 * @param conflictGroupId - The group it is in, if any.
 * @returns The import, with its asset.
 */
function member(
  id: string,
  sanitisedSha256: string,
  state = FileAssetState.CLEAN,
  conflictGroupId: string | null = null,
): RosterImportSourceEntity {
  return {
    id,
    fleetId: FLEET_ID,
    exportedAt: EXPORTED_AT,
    sanitisedSha256,
    conflictGroupId,
    asset: { state } as FileAssetEntity,
  } as RosterImportSourceEntity;
}

describe('RosterImportConflictService', () => {
  let service: RosterImportConflictService;
  let conflicts: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let imports: { find: jest.Mock; update: jest.Mock };
  let manager: { query: jest.Mock; getRepository: jest.Mock };
  let warned: jest.SpiedFunction<Logger['warn']>;

  beforeEach(() => {
    conflicts = {
      findOne: jest.fn(() => Promise.resolve(null)),
      create: jest.fn((values: unknown) => values),
      save: jest.fn((values: unknown) =>
        Promise.resolve({ id: GROUP_ID, ...(values as object) }),
      ),
      update: jest.fn(() => Promise.resolve({})),
    };

    imports = {
      find: jest.fn(() => Promise.resolve([])),
      update: jest.fn(() => Promise.resolve({})),
    };

    manager = {
      query: jest.fn(() => Promise.resolve([])),
      getRepository: jest.fn((entity: unknown) =>
        entity === RosterImportSourceEntity ? imports : conflicts,
      ),
    };

    service = new RosterImportConflictService(
      conflicts as unknown as Repository<RosterImportConflictEntity>,
      imports as unknown as Repository<RosterImportSourceEntity>,
    );

    warned = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('grouping a new import', () => {
    const group = (record: RosterImportSourceEntity) =>
      service.group(manager as unknown as EntityManager, record, EXPORTED_AT);

    // Whoever takes the lock second finds the first already committed.
    it('serialises every decision about one Fleet and instant', async () => {
      await group(member('new', 'b'));

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`fleet-roster-export:${FLEET_ID}:2024-01-01T12:00:00.000Z`],
      );
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        imports.find.mock.invocationCallOrder[0],
      );
    });

    it('looks at every other import of the Fleet at that instant', async () => {
      await group(member('new', 'b'));

      expect(imports.find).toHaveBeenCalledWith({
        where: { fleetId: FLEET_ID, exportedAt: EXPORTED_AT, id: Not('new') },
        relations: { asset: true },
      });
    });

    it('groups nothing when no other import claims the instant', async () => {
      await expect(group(member('new', 'b'))).resolves.toBeNull();

      expect(conflicts.save).not.toHaveBeenCalled();
      expect(imports.update).not.toHaveBeenCalled();
    });

    // Their officer notes may have differed; what was kept did not.
    it('groups nothing when every other import says the same', async () => {
      imports.find.mockImplementation(() =>
        Promise.resolve([member('earlier', 'b')]),
      );

      await expect(group(member('new', 'b'))).resolves.toBeNull();
      expect(imports.update).not.toHaveBeenCalled();
    });

    it('ignores an import that was refused', async () => {
      imports.find.mockImplementation(() =>
        Promise.resolve([member('earlier', 'a', FileAssetState.REJECTED)]),
      );

      await expect(group(member('new', 'b'))).resolves.toBeNull();
    });

    it('opens a group when another import says something different', async () => {
      imports.find.mockImplementation(() =>
        Promise.resolve([member('earlier', 'a')]),
      );

      await expect(group(member('new', 'b'))).resolves.toEqual({
        id: GROUP_ID,
        fleetId: FLEET_ID,
        exportedAt: EXPORTED_AT,
      });
      // One group per moment, ever, settled or not.
      expect(conflicts.findOne).toHaveBeenCalledWith({
        where: { fleetId: FLEET_ID, exportedAt: EXPORTED_AT },
      });
    });

    it('puts every import at the instant in it, refused ones aside', async () => {
      imports.find.mockImplementation(() =>
        Promise.resolve([
          member('earlier', 'a'),
          member('same', 'b'),
          member('refused', 'c', FileAssetState.REJECTED),
        ]),
      );

      await group(member('new', 'b'));

      expect(imports.update).toHaveBeenCalledWith(
        { id: In(['new', 'earlier', 'same']) },
        { conflictGroupId: GROUP_ID },
      );
    });

    it('joins the group already open for the instant', async () => {
      const open = {
        id: 'open-group',
        selectedImportId: null,
        resolvedAt: null,
      } as RosterImportConflictEntity;

      conflicts.findOne.mockImplementation(() => Promise.resolve(open));
      imports.find.mockImplementation(() =>
        Promise.resolve([member('earlier', 'a', FileAssetState.AVAILABLE)]),
      );

      await expect(group(member('new', 'b'))).resolves.toBe(open);
      expect(conflicts.save).not.toHaveBeenCalled();
      expect(conflicts.update).not.toHaveBeenCalled();
      expect(imports.update).toHaveBeenCalledWith(
        { id: 'new' },
        { conflictGroupId: 'open-group' },
      );
    });

    describe('when the moment’s group was settled', () => {
      const settled = {
        id: 'settled-group',
        selectedImportId: 'chosen',
        resolvedAt: new Date('2024-02-01T00:00:00Z'),
      } as RosterImportConflictEntity;

      beforeEach(() => {
        conflicts.findOne.mockImplementation(() => Promise.resolve(settled));
        imports.find.mockImplementation(() =>
          Promise.resolve([member('first', 'a'), member('chosen', 'b')]),
        );
      });

      // A copy of what was selected changes nothing anybody decided.
      it('joins without reopening when it says the same as the selection', async () => {
        await expect(group(member('new', 'b'))).resolves.toBe(settled);

        expect(imports.update).toHaveBeenCalledWith(
          { id: 'new' },
          { conflictGroupId: 'settled-group' },
        );
        expect(conflicts.update).not.toHaveBeenCalled();
      });

      // Steve's decision of 25 September 2026: the selection stays in force
      // and the newcomer waits for an investigator to select again.
      it('reopens it when it says something different from the selection', async () => {
        await expect(group(member('new', 'a'))).resolves.toEqual({
          ...settled,
          resolvedAt: null,
        });

        expect(conflicts.update).toHaveBeenCalledWith(
          { id: 'settled-group' },
          { resolvedAt: null },
        );
        expect(conflicts.save).not.toHaveBeenCalled();
        expect(warned).toHaveBeenCalledWith(
          `[join] Settled roster conflict reopened - ` +
            `ConflictGroupId: settled-group, FleetId: ${FLEET_ID}, ` +
            `ImportId: new`,
        );
      });

      it('reopens nothing when the selection is not among the moment’s imports', async () => {
        imports.find.mockImplementation(() =>
          Promise.resolve([member('first', 'a')]),
        );

        await group(member('new', 'c'));

        expect(conflicts.update).not.toHaveBeenCalled();
      });
    });

    it('says so, with identifiers and a count', async () => {
      imports.find.mockImplementation(() =>
        Promise.resolve([member('earlier', 'a')]),
      );

      await group(member('new', 'b'));

      expect(warned).toHaveBeenCalledWith(
        `[group] Roster exports claim one instant and disagree - ` +
          `ConflictGroupId: ${GROUP_ID}, FleetId: ${FLEET_ID}, ` +
          `ExportedAt: 2024-01-01T12:00:00.000Z, Members: 2`,
      );
    });
  });

  describe('deciding whether an import waits', () => {
    const open = { id: GROUP_ID, selectedImportId: null, resolvedAt: null };

    beforeEach(() => {
      conflicts.findOne.mockImplementation(() => Promise.resolve(open));
    });

    it('does not hold an import in no group', async () => {
      await expect(service.isHeld(member('new', 'b'))).resolves.toBe(false);
      expect(conflicts.findOne).not.toHaveBeenCalled();
    });

    it('does not hold an import whose group cannot be found', async () => {
      conflicts.findOne.mockImplementation(() => Promise.resolve(null));

      await expect(
        service.isHeld(member('new', 'b', FileAssetState.CLEAN, GROUP_ID)),
      ).resolves.toBe(false);
      expect(conflicts.findOne).toHaveBeenCalledWith({
        where: { id: GROUP_ID },
      });
    });

    describe('once an investigator has selected an export', () => {
      beforeEach(() => {
        conflicts.findOne.mockImplementation(() =>
          Promise.resolve({ id: GROUP_ID, selectedImportId: 'chosen' }),
        );
        imports.find.mockImplementation(() =>
          Promise.resolve([member('first', 'a'), member('chosen', 'b')]),
        );
      });

      it('never holds the selected export', async () => {
        await expect(
          service.isHeld(member('chosen', 'b', FileAssetState.CLEAN, GROUP_ID)),
        ).resolves.toBe(false);
        expect(imports.find).not.toHaveBeenCalled();
      });

      it('holds one that differs from the selection, the first version included', async () => {
        await expect(
          service.isHeld(member('first', 'a', FileAssetState.CLEAN, GROUP_ID)),
        ).resolves.toBe(true);
      });

      it('does not hold one that says the same as the selection', async () => {
        await expect(
          service.isHeld(member('copy', 'b', FileAssetState.CLEAN, GROUP_ID)),
        ).resolves.toBe(false);
      });
    });

    it('reads the group in upload order', async () => {
      await service.isHeld(member('new', 'b', FileAssetState.CLEAN, GROUP_ID));

      expect(imports.find).toHaveBeenCalledWith({
        where: { conflictGroupId: GROUP_ID },
        relations: { asset: true },
        order: { uploadedAt: 'ASC', id: 'ASC' },
      });
    });

    it('holds an import that differs from the first version of the moment', async () => {
      const record = member('new', 'b', FileAssetState.CLEAN, GROUP_ID);

      imports.find.mockImplementation(() =>
        Promise.resolve([member('earlier', 'a'), record]),
      );

      await expect(service.isHeld(record)).resolves.toBe(true);
    });

    it('does not hold the first version itself', async () => {
      const record = member('earlier', 'a', FileAssetState.CLEAN, GROUP_ID);

      imports.find.mockImplementation(() =>
        Promise.resolve([record, member('new', 'b')]),
      );

      await expect(service.isHeld(record)).resolves.toBe(false);
    });

    it('does not hold a later import that says the same as the first', async () => {
      const record = member('same', 'a', FileAssetState.CLEAN, GROUP_ID);

      imports.find.mockImplementation(() =>
        Promise.resolve([member('earlier', 'a'), member('new', 'b'), record]),
      );

      await expect(service.isHeld(record)).resolves.toBe(false);
    });

    // Refused after the group was opened: it was never going to be in force.
    it('passes over a first upload that has since been refused', async () => {
      const record = member('new', 'b', FileAssetState.CLEAN, GROUP_ID);

      imports.find.mockImplementation(() =>
        Promise.resolve([
          member('earlier', 'a', FileAssetState.REJECTED),
          record,
        ]),
      );

      await expect(service.isHeld(record)).resolves.toBe(false);
    });

    it('treats the import itself as first when the group reads back empty', async () => {
      await expect(
        service.isHeld(member('new', 'b', FileAssetState.CLEAN, GROUP_ID)),
      ).resolves.toBe(false);
    });
  });
});
