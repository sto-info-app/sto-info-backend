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
import { Repository } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetService } from 'src/file-assets/services/file-asset.service';
import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';

import { FleetFeatureService } from '../../fleet-feature.service';
import { FleetPolicyService } from '../../fleet-policy.service';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterImportsController } from '../roster-imports.controller';
import { RosterCsvPrivacyParserService } from '../services/roster-csv-privacy-parser.service';
import { RosterImportIngressService } from '../services/roster-import-ingress.service';

/**
 * The officer canary sweep (FC-009, acceptance criterion 1).
 *
 * Every other test in this feature checks that the right things are present.
 * This one checks that one thing is absent, everywhere, and it drives the
 * whole ingress to do it rather than any single class.
 *
 * The sinks it watches are the five places officer text could plausibly end
 * up: the HTTP response, the log, the bytes written to quarantine, the
 * arguments handed to the registry and the row written to the database. Plus
 * the sixth, which is the one people forget — the error thrown when the
 * upload is *refused*, including its stack.
 *
 * It is paired with `officer-canary-containment.spec.ts`, which sweeps the
 * repository itself. This one proves today's code is clean; that one stops
 * tomorrow's from regressing.
 */

const CANARY = ['OFFICER', 'CANARY'].join('-');

const FIXTURE_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'test',
  'fixtures',
  'fleet-community',
);

const COMMUNITY_ID = '00000000-0000-4000-8000-000000000000';
const FLEET_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';

/**
 * Reads a committed corpus fixture.
 *
 * @param filename - The fixture's filename.
 * @returns Its bytes.
 */
function fixture(filename: string): Buffer {
  return readFileSync(join(FIXTURE_DIR, filename));
}

/**
 * Builds a Multer file carrying the given bytes.
 *
 * @param bytes - What the browser sent.
 * @param originalname - The filename it claimed.
 * @returns The file as Multer would present it.
 */
function multerFile(bytes: Buffer, originalname: string): Express.Multer.File {
  return {
    originalname,
    mimetype: 'text/csv',
    buffer: bytes,
  } as Express.Multer.File;
}

describe('Officer canary sinks', () => {
  let controller: RosterImportsController;
  let watched: string[];
  let logSpies: jest.SpiedFunction<(message: unknown) => void>[];

  beforeEach(() => {
    watched = [];

    // Every level, because the one that leaks is always the one nobody
    // expected to be called.
    logSpies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
      level =>
        jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => {
            watched.push(args.map(argument => String(argument)).join(' '));
          }),
    );

    const repository = {
      create: jest.fn((values: unknown) => values),
      save: jest.fn((values: unknown) => {
        watched.push(JSON.stringify(values));

        return Promise.resolve({ id: 'record-1', ...(values as object) });
      }),
    } as unknown as Repository<RosterImportSourceEntity>;

    const fileAssetService = {
      register: jest.fn((input: unknown) => {
        watched.push(JSON.stringify(input));

        return Promise.resolve({
          id: ASSET_ID,
          state: FileAssetState.RECEIVING,
        } as FileAssetEntity);
      }),
      recordStored: jest.fn((assetId: unknown, input: unknown) => {
        watched.push(JSON.stringify(input));

        return Promise.resolve({
          id: assetId,
          state: FileAssetState.QUARANTINED,
          retainUntil: null,
        } as FileAssetEntity);
      }),
    } as unknown as FileAssetService;

    const quarantineStorage = {
      buildObjectKey: jest.fn((assetId: unknown) => `local/assets/${assetId}`),
      put: jest.fn((objectKey: unknown, body: unknown) => {
        watched.push((body as Buffer).toString('utf8'));

        return Promise.resolve({ objectKey, objectVersion: null });
      }),
    } as unknown as QuarantineStorageService;

    const ingressService = new RosterImportIngressService(
      repository,
      new RosterCsvPrivacyParserService(),
      fileAssetService,
      quarantineStorage,
      { importSourceRetentionDays: 180 } as FleetPolicyService,
    );

    controller = new RosterImportsController(ingressService, {
      assertFlagEnabled: jest.fn(() => Promise.resolve()),
    } as unknown as FleetFeatureService);
  });

  afterEach(() => {
    for (const spy of logSpies) {
      spy.mockRestore();
    }
  });

  /**
   * Uploads a fixture and returns everything the run produced.
   *
   * @param filename - The fixture to upload.
   * @param mutate - An optional edit to the fixture's bytes.
   * @returns Every string the run wrote to a watched sink.
   */
  async function sweep(
    filename: string,
    mutate: (text: string) => string = text => text,
  ): Promise<string[]> {
    const bytes = Buffer.from(
      mutate(fixture(filename).toString('utf8')),
      'utf8',
    );

    try {
      const response = await controller.upload(
        COMMUNITY_ID,
        FLEET_ID,
        USER_ID,
        multerFile(bytes, filename),
      );

      watched.push(JSON.stringify(response));
    } catch (error) {
      const failure = error as Error & { getResponse?: () => unknown };

      watched.push(failure.message);
      watched.push(failure.stack ?? '');
      watched.push(JSON.stringify(failure.getResponse?.() ?? null));
    }

    return watched;
  }

  it.each([
    'Fixture Officer Fleet_20240102-120000.Csv',
    'Fixture Officer Fleet_20240103-120000.Csv',
    'Fixture Quoting Fleet_20240104-120000.Csv',
  ])('leaks nothing from %s into any sink', async filename => {
    const sinks = await sweep(filename);

    // The fixture really does carry the canary, so a pass means the sweep
    // worked rather than that there was nothing to find.
    expect(fixture(filename).toString('utf8')).toContain(CANARY);
    expect(sinks.length).toBeGreaterThan(0);

    for (const sink of sinks) {
      expect(sink).not.toContain(CANARY);
    }
  });

  it('leaks nothing when the header is refused', async () => {
    const sinks = await sweep(
      'Fixture Officer Fleet_20240102-120000.Csv',
      text => `Not,A,Header\r\n${text.split('\r\n').slice(1).join('\r\n')}`,
    );

    expect(sinks.join('\n')).toContain('HEADER_UNRECOGNISED');

    for (const sink of sinks) {
      expect(sink).not.toContain(CANARY);
    }
  });

  it('leaks nothing when a row cannot be read', async () => {
    const sinks = await sweep(
      'Fixture Officer Fleet_20240102-120000.Csv',
      text => text.replace('Kell Marr,@fixture003,', 'Kell Marr @fixture003 '),
    );

    expect(sinks.join('\n')).toContain('ROW_UNPARSEABLE');

    for (const sink of sinks) {
      expect(sink).not.toContain(CANARY);
    }
  });

  it('leaks nothing when a row is ambiguous', async () => {
    const sinks = await sweep(
      'Fixture Officer Fleet_20240102-120000.Csv',
      text =>
        text.replace(
          '"Offline","Engineering main",2/2/2023 3:00:00pm',
          '"Offline","a","b",',
        ),
    );

    expect(sinks.join('\n')).toContain('ROW_AMBIGUOUS');

    for (const sink of sinks) {
      expect(sink).not.toContain(CANARY);
    }
  });

  it('does not put the uploader-supplied filename in the log', async () => {
    await sweep('Fixture Officer Fleet_20240102-120000.Csv');

    // The filename is recorded on the row and returned to its uploader. It is
    // not written to the log: it is text somebody supplied, it is not subject
    // to the parser's control-character rule, and a log line is a sink.
    const logLines = watched.filter(entry => entry.startsWith('[accept]'));

    expect(logLines.length).toBeGreaterThan(0);

    for (const line of logLines) {
      expect(line).not.toContain('Fixture Officer Fleet');
    }
  });
});
