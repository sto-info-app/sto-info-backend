import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { EntityManager, Repository } from 'typeorm';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetPublisherRegistry,
  RestrictedAssetAttachment,
} from 'src/file-assets/services/asset-publisher.registry';

import { RosterReplayQueueService } from '../../projection/services/roster-replay-queue.service';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterObservationEntity } from '../entities/roster-observation.entity';
import { RosterCsvRejectionCode } from '../enums/roster-csv-rejection-code.enum';
import { RosterProfession } from '../enums/roster-profession.enum';
import { RosterPublicationRejectionCode } from '../enums/roster-publication-rejection-code.enum';
import { RosterRowRejectionCode } from '../enums/roster-row-rejection-code.enum';
import { RosterCsvPrivacyParserService } from './roster-csv-privacy-parser.service';
import { RosterImportConflictService } from './roster-import-conflict.service';
import { RosterImportPublisher } from './roster-import.publisher';
import { RosterTypedParserService } from './roster-typed-parser.service';

const FIXTURE_DIR = join(process.cwd(), 'test', 'fixtures', 'fleet-community');
const IMPORT_ID = '55555555-5555-4555-8555-555555555555';
const ASSET_ID = '66666666-6666-4666-8666-666666666666';
const FLEET_ID = '77777777-7777-4777-8777-777777777777';

/**
 * Sanitises an export the way the upload did, so the publisher is handed the
 * bytes it would really be handed.
 *
 * @param text - The export as STO writes it.
 * @returns The sanitised CSV.
 */
function sanitised(text: string): Buffer {
  return new RosterCsvPrivacyParserService().sanitise(Buffer.from(text, 'utf8'))
    .csv;
}

/**
 * Reads the basic fixture as STO wrote it.
 *
 * @returns The export's text.
 */
function basicExport(): string {
  return readFileSync(
    join(FIXTURE_DIR, 'Fixture Basic Fleet_20240101-120000.Csv'),
    'utf8',
  );
}

describe('RosterImportPublisher', () => {
  let publisher: RosterImportPublisher;
  let record: RosterImportSourceEntity;
  let imports: { findOne: jest.Mock; save: jest.Mock };
  let manager: { delete: jest.Mock; insert: jest.Mock };
  let transaction: jest.Mock;
  let registry: { registerRestricted: jest.Mock };
  let conflicts: { isHeld: jest.Mock };
  let replays: { request: jest.Mock; enqueue: jest.Mock };

  beforeEach(() => {
    record = {
      id: IMPORT_ID,
      assetId: ASSET_ID,
      fleetId: FLEET_ID,
      exportTimezone: 'Europe/London',
      publicationProblems: null,
    } as RosterImportSourceEntity;

    imports = {
      findOne: jest.fn(() => Promise.resolve(record)),
      save: jest.fn((values: unknown) => Promise.resolve(values)),
    };

    manager = {
      delete: jest.fn(() => Promise.resolve({})),
      insert: jest.fn(() => Promise.resolve({})),
    };

    transaction = jest.fn((work: unknown) =>
      (work as (manager: EntityManager) => Promise<void>)(
        manager as unknown as EntityManager,
      ),
    );

    registry = { registerRestricted: jest.fn() };
    conflicts = { isHeld: jest.fn(() => Promise.resolve(false)) };
    replays = {
      request: jest.fn(() => Promise.resolve()),
      enqueue: jest.fn(() => Promise.resolve()),
    };

    publisher = new RosterImportPublisher(
      imports as unknown as Repository<RosterImportSourceEntity>,
      {
        manager: { transaction },
      } as unknown as Repository<RosterObservationEntity>,
      new RosterTypedParserService(),
      registry as unknown as AssetPublisherRegistry,
      conflicts as unknown as RosterImportConflictService,
      replays as unknown as RosterReplayQueueService,
    );

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Hands the publisher a cleared file.
   *
   * @param bytes - The sanitised CSV.
   * @param overrides - Whatever the case is actually about.
   * @returns What the publisher made of it.
   */
  function receive(
    bytes: Buffer,
    overrides: Partial<RestrictedAssetAttachment> = {},
  ) {
    return publisher.receive({
      subjectId: IMPORT_ID,
      slot: FileAssetSlot.SOURCE,
      assetId: ASSET_ID,
      bytes,
      uploadedByUserId: null,
      detail: null,
      ...overrides,
    });
  }

  /**
   * Collects every observation inserted, across every batch.
   *
   * @returns The observations, in insertion order.
   */
  function inserted(): Partial<RosterObservationEntity>[] {
    return (
      manager.insert.mock.calls as [
        unknown,
        Partial<RosterObservationEntity>[],
      ][]
    ).flatMap(([, rows]) => rows);
  }

  it('registers itself as the restricted publisher for roster imports', () => {
    publisher.onModuleInit();

    expect(registry.registerRestricted).toHaveBeenCalledWith(publisher);
    expect(publisher.subject).toBe(FileAssetSubject.ROSTER_IMPORT);
  });

  describe('a file that reads', () => {
    it('accepts it', async () => {
      await expect(receive(sanitised(basicExport()))).resolves.toEqual({
        outcome: 'ACCEPTED',
      });
    });

    it('looks the import up by the placement it was handed', async () => {
      await receive(sanitised(basicExport()));

      expect(imports.findOne).toHaveBeenCalledWith({
        where: { id: IMPORT_ID },
      });
    });

    it('writes one observation per row, against the import and its Fleet', async () => {
      await receive(sanitised(basicExport()));

      const rows = inserted();
      const dataLines = basicExport().trimEnd().split('\n').length - 1;

      expect(rows).toHaveLength(dataLines);

      for (const row of rows) {
        expect(row.importSourceId).toBe(IMPORT_ID);
        expect(row.fleetId).toBe(FLEET_ID);
      }
    });

    it('records a row as the file wrote it', async () => {
      await receive(sanitised(basicExport()));

      expect(inserted()[0]).toEqual({
        importSourceId: IMPORT_ID,
        fleetId: FLEET_ID,
        line: 2,
        characterName: 'Aria Venn',
        characterNameNormalised: 'aria venn',
        accountHandle: '@fixture001',
        accountHandleNormalised: '@fixture001',
        level: 65,
        className: 'Starfleet Tactical Officer',
        profession: RosterProfession.TACTICAL,
        guildRank: 'Member',
        contributionTotal: '120500',
        joinedAtLocal: '2023-03-04T20:15:00',
        joinedAt: new Date('2023-03-04T20:15:00.000Z'),
        joinedAtAmbiguous: false,
        rankChangedAtLocal: '2023-06-01T09:00:00',
        rankChangedAt: new Date('2023-06-01T08:00:00.000Z'),
        rankChangedAtAmbiguous: false,
        lastActiveAtLocal: '2024-01-01T11:45:00',
        lastActiveAt: new Date('2024-01-01T11:45:00.000Z'),
        lastActiveAtAmbiguous: false,
        status: 'Offline',
        publicComment: 'Happy to run TFOs at weekends',
        publicCommentEditedAtLocal: '2023-05-02T19:30:00',
        publicCommentEditedAt: new Date('2023-05-02T18:30:00.000Z'),
        publicCommentEditedAtAmbiguous: false,
      });
    });

    it('keeps an empty date empty on both sides of the pair', async () => {
      await receive(sanitised(basicExport()));

      expect(inserted()[1]).toEqual(
        expect.objectContaining({
          rankChangedAtLocal: null,
          rankChangedAt: null,
          rankChangedAtAmbiguous: false,
        }),
      );
    });

    // 01:30 on 27 October 2024 happened twice in London. The earlier is
    // recorded, and the flag says a choice was made.
    it('records the earlier of two instants, and says there were two', async () => {
      const text = basicExport().replace(
        '1/1/2024 11:45:00am',
        '10/27/2024 1:30:00am',
      );

      await receive(sanitised(text));

      expect(inserted()[0]).toEqual(
        expect.objectContaining({
          lastActiveAtLocal: '2024-10-27T01:30:00',
          lastActiveAt: new Date('2024-10-27T00:30:00.000Z'),
          lastActiveAtAmbiguous: true,
        }),
      );
    });

    it('reads the dates through the zone the upload recorded', async () => {
      record.exportTimezone = 'America/New_York';

      await receive(sanitised(basicExport()));

      expect(inserted()[0].lastActiveAt).toEqual(
        new Date('2024-01-01T16:45:00.000Z'),
      );
    });

    // A retried job must leave exactly what the first attempt would have.
    it('replaces what an earlier attempt wrote, inside one transaction', async () => {
      const order: string[] = [];

      manager.delete.mockImplementation(() => {
        order.push('delete');

        return Promise.resolve({});
      });
      manager.insert.mockImplementation(() => {
        order.push('insert');

        return Promise.resolve({});
      });

      await receive(sanitised(basicExport()));

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(manager.delete).toHaveBeenCalledWith(RosterObservationEntity, {
        importSourceId: IMPORT_ID,
      });
      expect(order[0]).toBe('delete');
      expect(order.slice(1).every(step => step === 'insert')).toBe(true);
    });

    it('inserts a large roster in batches', async () => {
      const [header] = basicExport().split(/\r?\n/);
      const rows = Array.from(
        { length: 1200 },
        (_, index) =>
          `Member ${index},@member${index},65,Starfleet Tactical Officer,` +
          `Member,${index},3/4/2023 8:15:00pm,,1/1/2024 11:45:00am,` +
          `"Offline","",`,
      );

      await receive(sanitised(`${header}\r\n${rows.join('\r\n')}\r\n`));

      expect(
        (manager.insert.mock.calls as [unknown, unknown[]][]).map(
          ([, batch]) => batch.length,
        ),
      ).toEqual([500, 500, 200]);
      expect(inserted().map(row => row.line)).toEqual(
        Array.from({ length: 1200 }, (_, index) => index + 2),
      );
    });

    it('does not touch the import record', async () => {
      await receive(sanitised(basicExport()));

      expect(imports.save).not.toHaveBeenCalled();
    });
  });

  describe('a file that has to wait for a conflicting export', () => {
    beforeEach(() => {
      record.conflictGroupId = 'group-1';
      conflicts.isHeld.mockImplementation(() => Promise.resolve(true));
    });

    it('asks about the import it looked up', async () => {
      await receive(sanitised(basicExport()));

      expect(conflicts.isHeld).toHaveBeenCalledWith(record);
    });

    it('is held, and says why', async () => {
      await expect(receive(sanitised(basicExport()))).resolves.toEqual({
        outcome: 'HELD',
        reason: 'EXPORT_INSTANT_IN_CONFLICT',
      });
    });

    it('writes no observations', async () => {
      await receive(sanitised(basicExport()));

      expect(transaction).not.toHaveBeenCalled();
    });

    it('logs the group it is waiting on', async () => {
      await receive(sanitised(basicExport()));

      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('ConflictGroupId: group-1'),
      );
    });

    // A file that does not read is refused whatever else is true of it.
    it('is refused rather than held when it no longer reads', async () => {
      await expect(
        receive(
          sanitised(basicExport().replace('@fixture001,65,', '@fixture001,x,')),
        ),
      ).resolves.toEqual(expect.objectContaining({ outcome: 'REFUSED' }));
      expect(conflicts.isHeld).not.toHaveBeenCalled();
    });
  });

  describe('a file that no longer reads', () => {
    const unreadable = (): Buffer =>
      sanitised(basicExport().replace('@fixture001,65,', '@fixture001,x,'));

    it('refuses it as unreadable', async () => {
      await expect(receive(unreadable())).resolves.toEqual({
        outcome: 'REFUSED',
        rejectionCode: RosterCsvRejectionCode.ROWS_UNREADABLE,
      });
    });

    it('records why on the import, as a line, a column and a code', async () => {
      await receive(unreadable());

      expect(imports.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: IMPORT_ID,
          publicationProblems: [
            {
              code: RosterRowRejectionCode.LEVEL_MALFORMED,
              line: 2,
              column: 'Level',
            },
          ],
        }),
      );
    });

    it('writes no observations', async () => {
      await receive(unreadable());

      expect(transaction).not.toHaveBeenCalled();
    });
  });

  describe('a placement that does not match its import', () => {
    it('refuses an import that does not exist', async () => {
      imports.findOne.mockImplementation(() => Promise.resolve(null));

      await expect(receive(sanitised(basicExport()))).resolves.toEqual({
        outcome: 'REFUSED',
        rejectionCode: RosterPublicationRejectionCode.NOT_THIS_IMPORT,
      });
      expect(transaction).not.toHaveBeenCalled();
    });

    it('refuses an import recorded against a different file', async () => {
      await expect(
        receive(sanitised(basicExport()), {
          assetId: '88888888-8888-4888-8888-888888888888',
        }),
      ).resolves.toEqual({
        outcome: 'REFUSED',
        rejectionCode: RosterPublicationRejectionCode.NOT_THIS_IMPORT,
      });
      expect(transaction).not.toHaveBeenCalled();
    });

    // Reading its dates would mean guessing a zone.
    it('refuses an import that never recorded its zone', async () => {
      record.exportTimezone = null;

      await expect(receive(sanitised(basicExport()))).resolves.toEqual({
        outcome: 'REFUSED',
        rejectionCode: RosterPublicationRejectionCode.EXPORT_TIMEZONE_MISSING,
      });
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  describe('an import going into force', () => {
    let findOne: jest.Mock<(...args: any[]) => Promise<any>>;
    let activation: EntityManager;

    beforeEach(() => {
      findOne = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({
        id: IMPORT_ID,
        fleetId: FLEET_ID,
      });
      activation = { findOne } as unknown as EntityManager;
    });

    it('reads the import inside the transaction it was handed', async () => {
      await publisher.activated(IMPORT_ID, activation);

      expect(findOne).toHaveBeenCalledWith(RosterImportSourceEntity, {
        where: { id: IMPORT_ID },
        select: { id: true, fleetId: true },
      });
    });

    // The import cannot be in force without its Fleet's projection knowing
    // it is behind. The Fleet's last imported date follows the published
    // revision since FC-019, so nothing else is written here.
    it("records the Fleet's replay request in that transaction", async () => {
      await publisher.activated(IMPORT_ID, activation);

      expect(replays.request).toHaveBeenCalledWith(activation, FLEET_ID);
      expect(replays.enqueue).not.toHaveBeenCalled();
    });

    it('asks for nothing for an import that is not there', async () => {
      findOne.mockResolvedValue(null);

      await publisher.activated(IMPORT_ID, activation);

      expect(replays.request).not.toHaveBeenCalled();
    });
  });

  describe('an import in force and committed', () => {
    beforeEach(() => {
      imports.findOne.mockImplementation(() =>
        Promise.resolve({ id: IMPORT_ID, fleetId: FLEET_ID }),
      );
    });

    it("queues the Fleet's replay", async () => {
      await publisher.afterActivation(IMPORT_ID);

      expect(imports.findOne).toHaveBeenCalledWith({
        where: { id: IMPORT_ID },
        select: { id: true, fleetId: true },
      });
      expect(replays.enqueue).toHaveBeenCalledWith(FLEET_ID);
    });

    it('asks for nothing for an import that has gone', async () => {
      imports.findOne.mockImplementation(() => Promise.resolve(null));

      await publisher.afterActivation(IMPORT_ID);

      expect(replays.enqueue).not.toHaveBeenCalled();
    });

    // The publication job fails and is retried, finding the placement
    // already active and asking again; the request is already recorded, so
    // the sweep would queue it even if the retries ran out.
    it('fails when the replay cannot be queued', async () => {
      replays.enqueue.mockImplementation(() =>
        Promise.reject(new Error('Redis is not answering')),
      );

      await expect(publisher.afterActivation(IMPORT_ID)).rejects.toThrow(
        'Redis is not answering',
      );
    });
  });
});
