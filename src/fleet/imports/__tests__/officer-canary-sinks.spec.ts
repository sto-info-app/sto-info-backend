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
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetService } from 'src/file-assets/services/file-asset.service';
import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';
import { ScanRequestProducerService } from 'src/file-scanning/services/scan-request-producer.service';

import { FleetNameAliasEntity } from '../../entities/fleet-name-alias.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetFeatureService } from '../../fleet-feature.service';
import { FleetPolicyService } from '../../fleet-policy.service';
import { StoFleetService } from '../../services/sto-fleet.service';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterImportsController } from '../roster-imports.controller';
import { RosterCsvPrivacyParserService } from '../services/roster-csv-privacy-parser.service';
import { RosterExportIdentityService } from '../services/roster-export-identity.service';
import { RosterImportIngressService } from '../services/roster-import-ingress.service';
import { RosterImportPreviewService } from '../services/roster-import-preview.service';
import { RosterTypedParserService } from '../services/roster-typed-parser.service';

/**
 * The officer canary sweep (FC-009, acceptance criterion 1).
 *
 * Every other test in this feature checks that the right things are present.
 * This one checks that one thing is absent, everywhere, and it drives the
 * whole ingress to do it rather than any single class.
 *
 * The sinks it watches are the six places officer text could plausibly end
 * up: the HTTP response, the log, the bytes written to quarantine, the
 * arguments handed to the registry, the row written to the database and the
 * message put on the scan queue. Plus the seventh, which is the one people
 * forget — the error thrown when the upload is *refused*, including its
 * stack.
 *
 * FC-016 added an eighth, and the most exposed one yet: the preview, whose
 * whole purpose is to read roster values back to the uploader. It keeps
 * nothing and writes nothing, so its only sink is its own response — but
 * that response carries names, handles and comments by design, which makes it
 * exactly the place a fifteen-column file would show what it should not. It is
 * swept alongside the upload.
 *
 * The queue arrived with FC-010 and is the reason this list is worth
 * keeping. A sink sweep is only as good as its list of sinks, and a new one
 * is added by somebody who is thinking about something else.
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
 * Reads the Fleet a fixture's filename is an export of.
 *
 * The upload now refuses a file whose name is not this Fleet's, before it
 * reads a byte {DASH} so a sweep that did not line the two up would prove only
 * that a refusal leaks nothing, which is the easy half.
 *
 * @param filename - The fixture's filename.
 * @returns The Fleet label in it.
 */
function fleetNameIn(filename: string): string {
  return filename.slice(0, filename.lastIndexOf('_'));
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

  /** The Fleet the route resolves, set by each sweep from its fixture. */
  let fleetName: string;

  beforeEach(() => {
    watched = [];
    fleetName = 'Fixture Officer Fleet';

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
          objectKey: `local/assets/${assetId as string}`,
          objectVersion: null,
          sha256: (input as { sha256: string }).sha256,
          policyVersion: 1,
          retainUntil: null,
        } as FileAssetEntity);
      }),
      markScanning: jest.fn((assetId: unknown) =>
        Promise.resolve({
          id: assetId,
          state: FileAssetState.SCANNING,
        } as FileAssetEntity),
      ),
      markRetryPending: jest.fn(() => Promise.resolve({} as FileAssetEntity)),
    } as unknown as FileAssetService;

    const quarantineStorage = {
      buildObjectKey: jest.fn((assetId: unknown) => `local/assets/${assetId}`),
      put: jest.fn((objectKey: unknown, body: unknown) => {
        watched.push((body as Buffer).toString('utf8'));

        return Promise.resolve({ objectKey, objectVersion: null });
      }),
    } as unknown as QuarantineStorageService;

    // The queue is a sink like any other, and it is the newest one. The
    // real producer is used rather than a stand-in, so what is swept is the
    // message that would actually be sent rather than a test's idea of it.
    const scanQueue = {
      add: jest.fn((name: unknown, message: unknown) => {
        watched.push(String(name));
        watched.push(JSON.stringify(message));

        return Promise.resolve({});
      }),
    } as unknown as Queue;

    const identityService = new RosterExportIdentityService({
      find: jest.fn(() => Promise.resolve([])),
    } as unknown as Repository<FleetNameAliasEntity>);

    const ingressService = new RosterImportIngressService(
      repository,
      new RosterCsvPrivacyParserService(),
      identityService,
      fileAssetService,
      quarantineStorage,
      new ScanRequestProducerService(scanQueue, fileAssetService),
      { importSourceRetentionDays: 180 } as FleetPolicyService,
    );

    // On a platform the game exports rosters from, because this sweep is
    // about what happens to a file that is actually read. A console Fleet is
    // refused before the parser sees a byte, which proves nothing about the
    // parser.
    const fleetService = {
      findByIdOrFail: jest.fn(() =>
        Promise.resolve({
          id: FLEET_ID,
          exactGameName: fleetName,
          platform: { name: 'Windows', providesRosterExport: true },
        } as StoFleetEntity),
      ),
    } as unknown as StoFleetService;

    const previewService = new RosterImportPreviewService(
      new RosterCsvPrivacyParserService(),
      new RosterTypedParserService(),
      identityService,
    );

    controller = new RosterImportsController(
      ingressService,
      previewService,
      {
        assertFlagEnabled: jest.fn(() => Promise.resolve()),
      } as unknown as FleetFeatureService,
      fleetService,
    );
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

    fleetName = fleetNameIn(filename);

    try {
      const response = await controller.upload(
        COMMUNITY_ID,
        FLEET_ID,
        USER_ID,
        { timezone: 'Europe/London' },
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

  /**
   * Previews a fixture and returns everything the run produced.
   *
   * @param filename - The fixture to preview.
   * @returns Every string the run wrote to a watched sink.
   */
  async function sweepPreview(filename: string): Promise<string[]> {
    fleetName = fleetNameIn(filename);

    try {
      const response = await controller.preview(
        COMMUNITY_ID,
        FLEET_ID,
        USER_ID,
        { timezone: 'Europe/London' },
        multerFile(fixture(filename), filename),
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

  // The preview reads roster values back to whoever uploaded the file, which
  // is the point of it and also the reason it is worth sweeping hardest. A
  // fifteen-column export goes through the same privacy boundary first, so
  // there is nothing left for the preview to show — and this is how that
  // stays true.
  it.each([
    'Fixture Officer Fleet_20240102-120000.Csv',
    'Fixture Officer Fleet_20240103-120000.Csv',
    'Fixture Quoting Fleet_20240104-120000.Csv',
  ])('leaks nothing from %s into a preview', async filename => {
    const sinks = await sweepPreview(filename);

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
