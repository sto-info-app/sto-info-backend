import { createHash } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Repository } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetAudience } from 'src/file-assets/enums/file-asset-audience.enum';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetService } from 'src/file-assets/services/file-asset.service';
import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';
import { ScanRequestProducerService } from 'src/file-scanning/services/scan-request-producer.service';

import { FleetPolicyService } from '../../fleet-policy.service';
import { ROSTER_OFFICER_HEADER_LINE } from '../constants/roster-csv.constants';
import {
  ROSTER_FILENAME_MAX_LENGTH,
  SANITISED_ROSTER_CONTENT_TYPE,
} from '../constants/roster-upload.constants';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterCsvRejectionCode } from '../enums/roster-csv-rejection-code.enum';
import { RosterSourceHeaderShape } from '../enums/roster-source-header-shape.enum';
import { RosterCsvPrivacyParserService } from './roster-csv-privacy-parser.service';
import { RosterImportIngressService } from './roster-import-ingress.service';

const CANARY = ['OFFICER', 'CANARY'].join('-');
const FLEET_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';
const RETENTION_DAYS = 180;

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
  let repository: { create: jest.Mock; save: jest.Mock };
  let fileAssetService: { register: jest.Mock; recordStored: jest.Mock };
  let quarantineStorage: { buildObjectKey: jest.Mock; put: jest.Mock };
  let scanRequestProducer: { requestScan: jest.Mock };
  let saved: Partial<RosterImportSourceEntity> | undefined;

  beforeEach(() => {
    saved = undefined;

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
    };

    quarantineStorage = {
      buildObjectKey: jest.fn((assetId: unknown) => `local/assets/${assetId}`),
      put: jest.fn((objectKey: unknown) =>
        Promise.resolve({ objectKey, objectVersion: null }),
      ),
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
      fileAssetService as unknown as FileAssetService,
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
   * @returns Whatever the service returns.
   */
  async function accept(
    source: Buffer,
    filename = 'Fixture Basic Fleet_20240101-120000.Csv',
  ) {
    return service.accept({
      fleetId: FLEET_ID,
      uploadedByUserId: USER_ID,
      originalFilename: filename,
      declaredContentType: 'application/vnd.ms-excel',
      source,
    });
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
      });
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
