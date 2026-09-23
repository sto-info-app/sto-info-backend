import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException, Logger } from '@nestjs/common';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryFailedError, Repository } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetAudience } from 'src/file-assets/enums/file-asset-audience.enum';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { FileAssetPlacementService } from 'src/file-assets/services/file-asset-placement.service';
import { FileAssetService } from 'src/file-assets/services/file-asset.service';
import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';
import { ScanRequestProducerService } from 'src/file-scanning/services/scan-request-producer.service';

import { FleetNameAliasEntity } from '../../entities/fleet-name-alias.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetPolicyService } from '../../fleet-policy.service';
import { ROSTER_OFFICER_HEADER_LINE } from '../constants/roster-csv.constants';
import {
  ROSTER_FILENAME_MAX_LENGTH,
  SANITISED_ROSTER_CONTENT_TYPE,
} from '../constants/roster-upload.constants';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterCsvRejectionCode } from '../enums/roster-csv-rejection-code.enum';
import { RosterFilenameRejectionCode } from '../enums/roster-filename-rejection-code.enum';
import { RosterRepeatRejectionCode } from '../enums/roster-repeat-rejection-code.enum';
import { RosterRowRejectionCode } from '../enums/roster-row-rejection-code.enum';
import { RosterSourceHeaderShape } from '../enums/roster-source-header-shape.enum';
import { RosterCsvPrivacyParserService } from './roster-csv-privacy-parser.service';
import { RosterExportIdentityService } from './roster-export-identity.service';
import { RosterImportIngressService } from './roster-import-ingress.service';
import { RosterTypedParserService } from './roster-typed-parser.service';

const CANARY = ['OFFICER', 'CANARY'].join('-');
const FLEET_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';
const ALIAS_ID = '44444444-4444-4444-8444-444444444444';
const RETENTION_DAYS = 180;

/** The Fleet every upload in this spec is made against. */
const FLEET = {
  id: FLEET_ID,
  exactGameName: 'Fixture Basic Fleet',
} as StoFleetEntity;

/**
 * A stamp Europe/London reads twice, on the morning the clocks go back.
 *
 * 01:30 on 27 October 2024 happened at 00:30 UTC and again an hour later.
 */
const AMBIGUOUS_FILENAME = 'Fixture Basic Fleet_20241027-013000.Csv';
const FIRST_CANDIDATE = new Date('2024-10-27T00:30:00.000Z');
const SECOND_CANDIDATE = new Date('2024-10-27T01:30:00.000Z');

/** What the default filename reads as in Europe/London. */
const DEFAULT_EXPORTED_AT = new Date('2024-01-01T12:00:00.000Z');

/** The asset an earlier upload of the same file registered. */
const EARLIER_ASSET = {
  id: '55555555-5555-4555-8555-555555555555',
  state: FileAssetState.AVAILABLE,
} as FileAssetEntity;

/**
 * Builds the import an earlier upload of the same file made.
 *
 * @param overrides - Whatever the case is actually about.
 * @returns The earlier import, with its asset.
 */
function earlierImport(
  overrides: Partial<RosterImportSourceEntity> = {},
): RosterImportSourceEntity {
  return {
    id: 'earlier-1',
    assetId: EARLIER_ASSET.id,
    fleetId: FLEET_ID,
    exportTimezone: 'Europe/London',
    exportLocalStamp: '2024-01-01T12:00:00',
    exportedAt: DEFAULT_EXPORTED_AT,
    asset: EARLIER_ASSET,
    ...overrides,
  } as RosterImportSourceEntity;
}

/**
 * Builds the error the insert throws when a concurrent upload of the same
 * file was recorded first.
 *
 * @param index - The index Postgres names.
 * @returns The error, as TypeORM wraps it.
 */
function duplicateKey(
  index = 'UQ_roster_import_source_fleet_hash',
): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO fleet_roster_import_source',
    [],
    new Error(`duplicate key value violates unique constraint "${index}"`),
  );
}

/**
 * Builds a fifteen-column export with one officer row.
 *
 * @returns The bytes, as STO writes them.
 */
function officerExport(): Buffer {
  const row =
    'Kell Marr,@fixture001,65,Starfleet Tactical Officer,Member,1000,' +
    '1/1/2022 1:00:00am,2/2/2023 2:00:00pm,3/3/2024 3:00:00am,' +
    `"Offline","Main tank",2/2/2023 3:00:00pm,"${CANARY}-01",` +
    `${CANARY}-AUTHOR-01,3/3/2023 4:00:00pm`;

  return Buffer.from(`${ROSTER_OFFICER_HEADER_LINE}\r\n${row}\r\n`, 'utf8');
}

describe('RosterImportIngressService', () => {
  const realParser = new RosterCsvPrivacyParserService();

  let service: RosterImportIngressService;
  let parser: { sanitise: jest.Mock };
  let repository: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let fileAssetService: {
    register: jest.Mock;
    recordStored: jest.Mock;
    discard: jest.Mock;
  };
  let placementService: { placePending: jest.Mock };
  let quarantineStorage: {
    buildObjectKey: jest.Mock;
    put: jest.Mock;
    remove: jest.Mock;
  };
  let scanRequestProducer: { requestScan: jest.Mock };
  let aliases: { find: jest.Mock };
  let saved: Partial<RosterImportSourceEntity> | undefined;

  beforeEach(() => {
    saved = undefined;

    // The real identity service, against a Fleet with no recorded former
    // names. Stubbing it would let this service and the preview disagree
    // about the same filename without either spec noticing.
    aliases = { find: jest.fn(() => Promise.resolve([])) };

    parser = {
      sanitise: jest.fn((source: unknown) =>
        realParser.sanitise(source as Buffer),
      ),
    };

    repository = {
      create: jest.fn((values: unknown) => values),
      save: jest.fn((values: unknown) => {
        saved = values as Partial<RosterImportSourceEntity>;

        return Promise.resolve({ id: 'record-1', ...saved });
      }),
      findOne: jest.fn(() => Promise.resolve(null)),
    };

    fileAssetService = {
      register: jest.fn(() =>
        Promise.resolve({
          id: ASSET_ID,
          state: FileAssetState.RECEIVING,
        } as FileAssetEntity),
      ),
      recordStored: jest.fn(() =>
        Promise.resolve({
          id: ASSET_ID,
          state: FileAssetState.QUARANTINED,
          retainUntil: null,
        } as FileAssetEntity),
      ),
      discard: jest.fn(() => Promise.resolve({})),
    };

    placementService = {
      placePending: jest.fn(() =>
        Promise.resolve({ placement: {}, superseded: null }),
      ),
    };

    quarantineStorage = {
      buildObjectKey: jest.fn((assetId: unknown) => `local/assets/${assetId}`),
      put: jest.fn((objectKey: unknown) =>
        Promise.resolve({ objectKey, objectVersion: null }),
      ),
      remove: jest.fn(() => Promise.resolve()),
    };

    scanRequestProducer = {
      requestScan: jest.fn((asset: unknown) =>
        Promise.resolve({
          asset: {
            ...(asset as FileAssetEntity),
            state: FileAssetState.SCANNING,
          },
          traceId: '0b5d4f6a-1c2e-4d3b-8a7f-9e8d7c6b5a40',
        }),
      ),
    };

    service = new RosterImportIngressService(
      repository as unknown as Repository<RosterImportSourceEntity>,
      parser as unknown as RosterCsvPrivacyParserService,
      new RosterTypedParserService(),
      new RosterExportIdentityService(
        aliases as unknown as Repository<FleetNameAliasEntity>,
      ),
      fileAssetService as unknown as FileAssetService,
      placementService as unknown as FileAssetPlacementService,
      quarantineStorage as unknown as QuarantineStorageService,
      scanRequestProducer as unknown as ScanRequestProducerService,
      { importSourceRetentionDays: RETENTION_DAYS } as FleetPolicyService,
    );
  });

  /**
   * Runs an upload with sensible defaults.
   *
   * @param source - The bytes to upload.
   * @param filename - The filename to claim.
   * @param chosenExportedAt - Which instant the stamp names, where it names
   *   two.
   * @returns Whatever the service returns.
   */
  async function accept(
    source: Buffer,
    filename = 'Fixture Basic Fleet_20240101-120000.Csv',
    chosenExportedAt: Date | null = null,
  ) {
    return service.accept({
      fleet: FLEET,
      timezone: 'Europe/London',
      chosenExportedAt,
      uploadedByUserId: USER_ID,
      originalFilename: filename,
      declaredContentType: 'application/vnd.ms-excel',
      source,
    });
  }

  /**
   * Catches the refusal an upload is answered with.
   *
   * @param source - The bytes to upload.
   * @param filename - The filename to claim.
   * @param chosenExportedAt - Which instant the stamp names.
   * @returns The exception body, or undefined when nothing was thrown.
   */
  async function refusalOf(
    source: Buffer,
    filename?: string,
    chosenExportedAt: Date | null = null,
  ) {
    try {
      await accept(source, filename, chosenExportedAt);
    } catch (error) {
      return (error as BadRequestException).getResponse();
    }

    return undefined;
  }

  describe('accepting an export', () => {
    it('registers the asset as a restricted roster source owned by the Fleet', async () => {
      await accept(officerExport());

      expect(fileAssetService.register).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: FileAssetKind.ROSTER_IMPORT_SOURCE,
          audience: FileAssetAudience.RESTRICTED,
          ownerUserId: USER_ID,
          fleetId: FLEET_ID,
          originalFilename: 'Fixture Basic Fleet_20240101-120000.Csv',
        }),
      );
    });

    // Keyed by the import, not the Fleet. A Fleet has a history of imports,
    // and a placement keyed by the Fleet would let each upload supersede the
    // one before it.
    it('claims a placement for the import, not for the Fleet', async () => {
      await accept(officerExport());

      expect(placementService.placePending).toHaveBeenCalledWith({
        assetId: ASSET_ID,
        subject: FileAssetSubject.ROSTER_IMPORT,
        subjectId: 'record-1',
        slot: FileAssetSlot.SOURCE,
      });
    });

    // A clean verdict with nothing waiting for it publishes nothing, so the
    // placement has to exist before the scanner can answer.
    it('claims the placement after the record and before the scan', async () => {
      const order: string[] = [];

      repository.save.mockImplementationOnce((values: unknown) => {
        order.push('record');

        return Promise.resolve({ id: 'record-1', ...(values as object) });
      });
      placementService.placePending.mockImplementationOnce(() => {
        order.push('placement');

        return Promise.resolve({ placement: {}, superseded: null });
      });
      scanRequestProducer.requestScan.mockImplementationOnce(
        (asset: unknown) => {
          order.push('scan');

          return Promise.resolve({
            asset: asset as FileAssetEntity,
            traceId: '0b5d4f6a-1c2e-4d3b-8a7f-9e8d7c6b5a40',
          });
        },
      );

      await accept(officerExport());

      expect(order).toEqual(['record', 'placement', 'scan']);
    });

    it('declares the asset as the CSV it wrote, not as what arrived', async () => {
      // The registered asset is the sanitised export this service
      // serialised; the uploaded file is gone by the time the row exists.
      // The worker checks the declared type against the bytes it reads, so
      // the claim has to describe those bytes — ADR-0020.
      await accept(officerExport());

      expect(fileAssetService.register).toHaveBeenCalledWith(
        expect.objectContaining({ declaredContentType: 'text/csv' }),
      );
    });

    it('keeps what the upload claimed on the provenance record', async () => {
      // Kept because the provenance record answers "what was actually
      // uploaded" once the upload is gone, and believed by nothing: this is
      // a Windows machine with Excel installed calling a CSV a spreadsheet.
      await accept(officerExport());

      expect(saved?.declaredContentType).toBe('application/vnd.ms-excel');
    });

    it('retains the sanitised source for the published window', async () => {
      // Bracketed rather than compared to a single instant. The service reads
      // the clock somewhere inside the call, so the only exact statement
      // available is that the deadline is the window measured from a moment
      // during it.
      const before = Date.now();

      await accept(officerExport());

      const after = Date.now();
      const [[input]] = fileAssetService.register.mock.calls as [
        [{ retainUntil: Date }],
      ];
      const window = RETENTION_DAYS * 24 * 60 * 60 * 1000;

      expect(input.retainUntil.getTime()).toBeGreaterThanOrEqual(
        before + window,
      );
      expect(input.retainUntil.getTime()).toBeLessThanOrEqual(after + window);
    });

    it('stores the sanitised bytes under a key built from the asset', async () => {
      await accept(officerExport());

      expect(quarantineStorage.buildObjectKey).toHaveBeenCalledWith(ASSET_ID);

      const [[objectKey, body]] = quarantineStorage.put.mock.calls as [
        [string, Buffer],
      ];

      expect(objectKey).toBe(`local/assets/${ASSET_ID}`);
      expect(body.toString('utf8')).not.toContain(CANARY);
      expect(body.toString('utf8').split('\n')[0]).toBe(
        '"Character Name","Account Handle","Level","Class","Guild Rank",' +
          '"Contribution Total","Join Date","Rank Change Date",' +
          '"Last Active Date","Status","Public Comment",' +
          '"Public Comment Last Edit Date"',
      );
    });

    it('binds the registry entry to the hash of what was stored', async () => {
      await accept(officerExport());

      const [[, body]] = quarantineStorage.put.mock.calls as [[string, Buffer]];
      const expected = createHash('sha256').update(body).digest('hex');

      expect(fileAssetService.recordStored).toHaveBeenCalledWith(ASSET_ID, {
        objectKey: `local/assets/${ASSET_ID}`,
        objectVersion: null,
        sha256: expected,
        byteSize: body.length,
        detectedContentType: SANITISED_ROSTER_CONTENT_TYPE,
      });
    });

    it('records the source hash although the source is not kept', async () => {
      const source = officerExport();
      const expected = createHash('sha256').update(source).digest('hex');

      await accept(source);

      expect(saved?.sourceSha256).toBe(expected);
      expect(saved?.sourceByteSize).toBe(String(source.length));
    });

    it('records what was discarded, as a count', async () => {
      await accept(officerExport());

      expect(saved).toEqual(
        expect.objectContaining({
          assetId: ASSET_ID,
          fleetId: FLEET_ID,
          uploadedByUserId: USER_ID,
          sourceHeaderShape: RosterSourceHeaderShape.OFFICER,
          rowCount: 1,
          officerTailRowCount: 1,
          parserVersion: 1,
        }),
      );
    });

    it('reports the asset as scanning, never as available', async () => {
      const accepted = await accept(officerExport());

      expect(accepted.asset.state).toBe(FileAssetState.SCANNING);
    });

    it('sends the sanitised asset to be scanned, and nothing else', async () => {
      // FC-009's fourth criterion said only the sanitised asset enters the
      // scan queue, and until now there was no queue for it to enter. The
      // asset handed over is the one the registry returned, which holds the
      // hash of the bytes that were written rather than of the upload.
      const accepted = await accept(officerExport());

      const [[handed]] = scanRequestProducer.requestScan.mock.calls as [
        [FileAssetEntity],
      ];

      expect(handed.id).toBe(ASSET_ID);
      expect(accepted.traceId).toBe('0b5d4f6a-1c2e-4d3b-8a7f-9e8d7c6b5a40');
    });

    it('records the import before it asks for a scan', async () => {
      // A crash between the two leaves an asset in quarantine with nothing
      // scanning it, which is safe and recoverable. The other order leaves
      // a scanned asset with no record of where it came from.
      await accept(officerExport());

      expect(repository.save.mock.invocationCallOrder[0]).toBeLessThan(
        scanRequestProducer.requestScan.mock.invocationCallOrder[0],
      );
    });
  });

  describe('a file this Fleet has imported before', () => {
    beforeEach(() => {
      repository.findOne.mockImplementation(() =>
        Promise.resolve(earlierImport()),
      );
    });

    // By Fleet and hash together. By hash alone, the answer would say
    // whether any Fleet anywhere had imported the file.
    it('looks for it by this Fleet and the hash of what arrived', async () => {
      const source = officerExport();
      const expected = createHash('sha256').update(source).digest('hex');

      await accept(source);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { fleetId: FLEET_ID, sourceSha256: expected },
        relations: { asset: true },
      });
    });

    it('answers with the import the earlier upload made', async () => {
      const accepted = await accept(officerExport());

      expect(accepted).toEqual({
        record: earlierImport(),
        asset: EARLIER_ASSET,
        traceId: null,
        repeated: true,
      });
    });

    it('reads, stores, places and scans nothing', async () => {
      await accept(officerExport());

      expect(parser.sanitise).not.toHaveBeenCalled();
      expect(fileAssetService.register).not.toHaveBeenCalled();
      expect(quarantineStorage.put).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
      expect(placementService.placePending).not.toHaveBeenCalled();
      expect(scanRequestProducer.requestScan).not.toHaveBeenCalled();
    });

    it('overwrites the buffer', async () => {
      const source = officerExport();

      await accept(source);

      expect(source.every(byte => byte === 0)).toBe(true);
    });

    describe('read differently', () => {
      it('refuses a zone other than the one the earlier import was read in', async () => {
        repository.findOne.mockImplementation(() =>
          Promise.resolve(
            earlierImport({
              exportTimezone: 'America/New_York',
              exportedAt: new Date('2024-01-01T17:00:00.000Z'),
            }),
          ),
        );

        await expect(refusalOf(officerExport())).resolves.toEqual({
          message: expect.any(String),
          code: RosterRepeatRejectionCode.ALREADY_IMPORTED_DIFFERENTLY,
          importId: 'earlier-1',
          exportTimezone: 'America/New_York',
          exportLocalStamp: '2024-01-01T12:00:00',
          exportedAt: new Date('2024-01-01T17:00:00.000Z'),
        });
      });

      // The same zone, but the other of the two instants the stamp names,
      // or a renamed file whose stamp says another time.
      it('refuses an instant other than the one the earlier import settled on', async () => {
        repository.findOne.mockImplementation(() =>
          Promise.resolve(
            earlierImport({ exportedAt: new Date('2024-01-01T13:00:00.000Z') }),
          ),
        );

        await expect(accept(officerExport())).rejects.toBeInstanceOf(
          ConflictException,
        );
      });

      it('refuses when the earlier import recorded no instant at all', async () => {
        repository.findOne.mockImplementation(() =>
          Promise.resolve(earlierImport({ exportedAt: null })),
        );

        await expect(accept(officerExport())).rejects.toBeInstanceOf(
          ConflictException,
        );
      });

      it('overwrites the buffer and stores nothing', async () => {
        repository.findOne.mockImplementation(() =>
          Promise.resolve(earlierImport({ exportTimezone: 'Asia/Tokyo' })),
        );
        const source = officerExport();

        await expect(accept(source)).rejects.toBeInstanceOf(ConflictException);

        expect(source.every(byte => byte === 0)).toBe(true);
        expect(fileAssetService.register).not.toHaveBeenCalled();
      });
    });
  });

  describe('two uploads of one file arriving together', () => {
    beforeEach(() => {
      repository.findOne
        .mockImplementationOnce(() => Promise.resolve(null))
        .mockImplementationOnce(() => Promise.resolve(earlierImport()));
      repository.save.mockImplementation(() => Promise.reject(duplicateKey()));
    });

    it('answers the one recorded second with the one recorded first', async () => {
      const accepted = await accept(officerExport());

      expect(accepted).toEqual({
        record: earlierImport(),
        asset: EARLIER_ASSET,
        traceId: null,
        repeated: true,
      });
    });

    it('gives back what the second one stored', async () => {
      await accept(officerExport());

      expect(fileAssetService.discard).toHaveBeenCalledWith(
        ASSET_ID,
        expect.any(String),
      );
      expect(quarantineStorage.remove).toHaveBeenCalledWith(
        `local/assets/${ASSET_ID}`,
      );
    });

    // The row is what decides whether anything could serve the bytes.
    it('discards the row before it removes the object', async () => {
      await accept(officerExport());

      expect(fileAssetService.discard.mock.invocationCallOrder[0]).toBeLessThan(
        quarantineStorage.remove.mock.invocationCallOrder[0],
      );
    });

    it('places nothing and scans nothing for the second one', async () => {
      await accept(officerExport());

      expect(placementService.placePending).not.toHaveBeenCalled();
      expect(scanRequestProducer.requestScan).not.toHaveBeenCalled();
    });

    it('still answers when the copy cannot be removed, and says so', async () => {
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      quarantineStorage.remove.mockImplementation(() =>
        Promise.reject(new Error('bucket unavailable')),
      );

      await expect(accept(officerExport())).resolves.toEqual(
        expect.objectContaining({ repeated: true }),
      );
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('Reason: bucket unavailable'),
      );

      logged.mockRestore();
    });

    it('logs a removal failure that is not an Error without its detail', async () => {
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      quarantineStorage.remove.mockImplementation(() =>
        Promise.reject('bucket unavailable'),
      );

      await accept(officerExport());

      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('Reason: unknown'),
      );

      logged.mockRestore();
    });

    it('refuses the second one when it read the file differently', async () => {
      repository.findOne
        .mockReset()
        .mockImplementationOnce(() => Promise.resolve(null))
        .mockImplementationOnce(() =>
          Promise.resolve(earlierImport({ exportTimezone: 'Asia/Tokyo' })),
        );

      await expect(accept(officerExport())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(fileAssetService.discard).toHaveBeenCalled();
    });

    it('lets through a failed insert that was not this race', async () => {
      const failure = duplicateKey('PK_roster_import_source');

      repository.save.mockImplementation(() => Promise.reject(failure));

      await expect(accept(officerExport())).rejects.toBe(failure);
      expect(repository.findOne).toHaveBeenCalledTimes(1);
      expect(fileAssetService.discard).not.toHaveBeenCalled();
    });

    it('lets through a failure that is not a database error', async () => {
      const failure = new Error('connection reset');

      repository.save.mockImplementation(() => Promise.reject(failure));

      await expect(accept(officerExport())).rejects.toBe(failure);
    });

    // The index says a winner exists; if it cannot be read back, answering
    // with anything would be a guess.
    it('lets the race through when the first one cannot be found', async () => {
      repository.findOne
        .mockReset()
        .mockImplementation(() => Promise.resolve(null));

      await expect(accept(officerExport())).rejects.toBeInstanceOf(
        QueryFailedError,
      );
      expect(fileAssetService.discard).not.toHaveBeenCalled();
    });
  });

  describe('recording when the export was taken', () => {
    it('records the zone, the stamp and the instant it read them as', async () => {
      await accept(officerExport());

      expect(saved).toEqual(
        expect.objectContaining({
          exportTimezone: 'Europe/London',
          filenameFleetLabel: 'Fixture Basic Fleet',
          exportLocalStamp: '2024-01-01T12:00:00',
          exportedAt: new Date('2024-01-01T12:00:00.000Z'),
          exportedAtAmbiguous: false,
          matchedAliasId: null,
        }),
      );
    });

    it('records the former name an export was filed under', async () => {
      // An import named for a name the Fleet no longer uses is worth being
      // able to find later, and the alias is the only thing that says the
      // label and the Fleet are the same Fleet.
      aliases.find.mockImplementationOnce(() =>
        Promise.resolve([
          {
            id: ALIAS_ID,
            fleetId: FLEET_ID,
            exactName: 'Fixture Former Fleet',
            validFrom: new Date('2020-01-01T00:00:00.000Z'),
            validTo: null,
          } as FleetNameAliasEntity,
        ]),
      );

      await accept(officerExport(), 'Fixture Former Fleet_20240101-120000.Csv');

      expect(saved?.matchedAliasId).toBe(ALIAS_ID);
      expect(saved?.filenameFleetLabel).toBe('Fixture Former Fleet');
    });

    it('records that an instant was chosen between two', async () => {
      await accept(officerExport(), AMBIGUOUS_FILENAME, SECOND_CANDIDATE);

      expect(saved?.exportedAt).toEqual(SECOND_CANDIDATE);
      expect(saved?.exportedAtAmbiguous).toBe(true);
    });

    it('reads the filename before it reads a byte of the file', async () => {
      // A file whose name proves neither which Fleet it is nor when it was
      // taken is not worth parsing, and a rejected upload is exactly the
      // upload somebody would otherwise be tempted to keep a sample of.
      await refusalOf(officerExport(), 'Someone Else_20240101-120000.Csv');

      expect(parser.sanitise).not.toHaveBeenCalled();
    });
  });

  describe('refusing a name that settles nothing', () => {
    it('refuses a Fleet label that is not this Fleet', async () => {
      expect(
        await refusalOf(officerExport(), 'Someone Else_20240101-120000.Csv'),
      ).toEqual(
        expect.objectContaining({
          code: RosterFilenameRejectionCode.FLEET_NAME_MISMATCH,
          line: null,
        }),
      );
    });

    it('refuses a name that is not the export grammar', async () => {
      expect(
        await refusalOf(officerExport(), 'Fixture Basic Fleet.Csv'),
      ).toEqual(
        expect.objectContaining({
          code: RosterFilenameRejectionCode.SHAPE_UNRECOGNISED,
        }),
      );
    });

    it('refuses an ambiguous stamp the upload did not settle', async () => {
      expect(await refusalOf(officerExport(), AMBIGUOUS_FILENAME)).toEqual(
        expect.objectContaining({
          code: RosterFilenameRejectionCode.STAMP_CHOICE_REQUIRED,
        }),
      );
    });

    it.each([
      [
        'a stamp that named only one',
        'Fixture Basic Fleet_20240101-120000.Csv',
      ],
      ['a stamp that named two', AMBIGUOUS_FILENAME],
    ])(
      'refuses an instant %s could not have meant',
      async (_description, filename) => {
        expect(
          await refusalOf(
            officerExport(),
            filename,
            new Date('1999-12-31T23:59:59.000Z'),
          ),
        ).toEqual(
          expect.objectContaining({
            code: RosterFilenameRejectionCode.STAMP_CHOICE_NOT_A_CANDIDATE,
          }),
        );
      },
    );

    it('accepts the other instant the stamp could have meant', async () => {
      await accept(officerExport(), AMBIGUOUS_FILENAME, FIRST_CANDIDATE);

      expect(saved?.exportedAt).toEqual(FIRST_CANDIDATE);
    });

    it('stores nothing when the name settles nothing', async () => {
      await refusalOf(officerExport(), 'Someone Else_20240101-120000.Csv');

      expect(fileAssetService.register).not.toHaveBeenCalled();
      expect(quarantineStorage.put).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
      expect(scanRequestProducer.requestScan).not.toHaveBeenCalled();
    });
  });

  describe('disposing of the received bytes', () => {
    it('overwrites the buffer once the parse has succeeded', async () => {
      const source = officerExport();

      await accept(source);

      expect(source.every(byte => byte === 0)).toBe(true);
    });

    it('overwrites the buffer when the parse fails', async () => {
      const source = Buffer.from('not a roster export at all\r\n', 'utf8');

      await expect(accept(source)).rejects.toBeInstanceOf(BadRequestException);
      expect(source.every(byte => byte === 0)).toBe(true);
    });

    it('overwrites the buffer when the filename is refused', async () => {
      const source = officerExport();

      await expect(accept(source, '')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(source.every(byte => byte === 0)).toBe(true);
    });

    it('overwrites the buffer when the name settles nothing', async () => {
      // The one refusal that happens before the file is read at all, which
      // makes it the one most easily written so that the bytes outlive it
      // — ADR-0001 says no raw failure sample, and a name this service
      // refused is not an exception to that.
      const source = officerExport();

      await expect(
        accept(source, 'Someone Else_20240101-120000.Csv'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(source.every(byte => byte === 0)).toBe(true);
    });

    it('overwrites the buffer when something unexpected goes wrong', async () => {
      const source = officerExport();

      parser.sanitise.mockImplementationOnce(() => {
        throw new TypeError('something unexpected');
      });

      await expect(accept(source)).rejects.toBeInstanceOf(TypeError);
      expect(source.every(byte => byte === 0)).toBe(true);
    });

    it('asks for no scan when the parse fails', async () => {
      await expect(
        accept(Buffer.from('not a roster export at all\r\n', 'utf8')),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(scanRequestProducer.requestScan).not.toHaveBeenCalled();
    });

    it('stores nothing when the parse fails', async () => {
      await expect(
        accept(Buffer.from('not a roster export at all\r\n', 'utf8')),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(fileAssetService.register).not.toHaveBeenCalled();
      expect(quarantineStorage.put).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('refusing an export', () => {
    it('answers with a structural code and a line, and no content', async () => {
      const source = Buffer.concat([
        officerExport(),
        Buffer.from('rubbish,row\r\n', 'utf8'),
      ]);

      let caught: BadRequestException | undefined;

      try {
        await accept(source);
      } catch (error) {
        caught = error as BadRequestException;
      }

      expect(caught?.getResponse()).toEqual({
        message:
          'This roster export could not be read. Nothing has been imported.',
        code: RosterCsvRejectionCode.ROW_PREFIX_MALFORMED,
        line: 3,
        problems: [],
      });
    });

    it('refuses a file whose values cannot be read, naming every row at fault', async () => {
      const source = Buffer.from(
        officerExport()
          .toString('utf8')
          .replace('@fixture001,65,', '@fixture001,sixty-five,'),
        'utf8',
      );

      expect(await refusalOf(source)).toEqual({
        message:
          'This roster export could not be read. Nothing has been imported.',
        code: RosterCsvRejectionCode.ROWS_UNREADABLE,
        line: null,
        problems: [
          {
            code: RosterRowRejectionCode.LEVEL_MALFORMED,
            line: 2,
            column: 'Level',
          },
        ],
      });
    });

    it('registers nothing and scans nothing when the values cannot be read', async () => {
      const source = Buffer.from(
        officerExport()
          .toString('utf8')
          .replace('@fixture001,65,', '@fixture001,sixty-five,'),
        'utf8',
      );

      await refusalOf(source);

      expect(fileAssetService.register).not.toHaveBeenCalled();
      expect(placementService.placePending).not.toHaveBeenCalled();
      expect(quarantineStorage.put).not.toHaveBeenCalled();
      expect(scanRequestProducer.requestScan).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('overwrites both the upload and its sanitised copy when the values cannot be read', async () => {
      const source = Buffer.from(
        officerExport()
          .toString('utf8')
          .replace('@fixture001,65,', '@fixture001,sixty-five,'),
        'utf8',
      );
      let sanitised: Buffer | undefined;

      parser.sanitise.mockImplementationOnce((bytes: unknown) => {
        const result = realParser.sanitise(bytes as Buffer);

        sanitised = result.csv;

        return result;
      });

      await refusalOf(source);

      expect(source.every(byte => byte === 0)).toBe(true);
      expect(sanitised?.every(byte => byte === 0)).toBe(true);
    });

    it('reads the values through the zone the uploader named', async () => {
      // 01:30 on 31 March 2024 never happened in London: the clocks went
      // from 01:00 straight to 02:00. The same text is an ordinary time in
      // UTC, so only the zone decides whether this row is readable.
      const source = Buffer.from(
        officerExport()
          .toString('utf8')
          .replace('1/1/2022 1:00:00am', '3/31/2024 1:30:00am'),
        'utf8',
      );

      expect(await refusalOf(source)).toEqual(
        expect.objectContaining({
          code: RosterCsvRejectionCode.ROWS_UNREADABLE,
          problems: [
            {
              code: RosterRowRejectionCode.DATE_NONEXISTENT,
              line: 2,
              column: 'Join Date',
            },
          ],
        }),
      );
    });

    it.each([
      ['an empty name', ''],
      ['a name of spaces', '   '],
      [
        'a name that is too long',
        `${'a'.repeat(ROSTER_FILENAME_MAX_LENGTH)}.Csv`,
      ],
      ['a forward slash', '../../etc/passwd'],
      ['a backslash', 'C:\\Users\\steve\\roster.Csv'],
    ])('refuses %s', async (_description, filename) => {
      let caught: BadRequestException | undefined;

      try {
        await accept(officerExport(), filename);
      } catch (error) {
        caught = error as BadRequestException;
      }

      expect(caught?.getResponse()).toEqual(
        expect.objectContaining({
          code: RosterCsvRejectionCode.FILENAME_UNUSABLE,
          line: null,
        }),
      );
    });

    it('refuses a name carrying a control character', async () => {
      let caught: BadRequestException | undefined;

      try {
        await accept(officerExport(), `roster\u000aInjected log line.Csv`);
      } catch (error) {
        caught = error as BadRequestException;
      }

      expect(caught?.getResponse()).toEqual(
        expect.objectContaining({
          code: RosterCsvRejectionCode.FILENAME_UNUSABLE,
        }),
      );
    });

    it('lets an unexpected failure through as itself', async () => {
      parser.sanitise.mockImplementationOnce(() => {
        throw new TypeError('something unexpected');
      });

      await expect(accept(officerExport())).rejects.toThrow(
        'something unexpected',
      );
    });
  });
});
