import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  FILE_SCAN_CONTRACT_FIXTURE_DIGEST,
  FILE_SCAN_CONTRACT_VERSION,
  FileScanContractError,
  parseScanRequestMessage,
  parseScanVerdictMessage,
  SUPPORTED_FILE_SCAN_CONTRACT_VERSIONS,
} from './file-scan-contract';

const FIXTURE_PATH = join(
  __dirname,
  '__fixtures__',
  'file-scan-contract-v1.json',
);

const FIXTURE_BYTES = readFileSync(FIXTURE_PATH);
const FIXTURE = JSON.parse(FIXTURE_BYTES.toString('utf8'));

/**
 * Copies the fixture's request with one field changed.
 *
 * @param changes - The fields to override.
 * @returns The altered message.
 */
function request(changes: Record<string, unknown> = {}): unknown {
  return { ...FIXTURE.request, ...changes };
}

/**
 * Copies one of the fixture's verdicts with fields changed.
 *
 * @param name - Which verdict to start from.
 * @param changes - The fields to override.
 * @returns The altered message.
 */
function verdict(
  name: 'clean' | 'rejected' | 'retry',
  changes: Record<string, unknown> = {},
): unknown {
  return { ...FIXTURE.verdicts[name], ...changes };
}

describe('the file scan contract', () => {
  describe('keeping the two copies together', () => {
    it('matches the digest the contract declares', () => {
      // The whole mechanism, in one assertion. The file that declares this
      // digest is byte-identical in the backend and in this repository, and
      // so is the fixture it describes. Changing the shape in one place
      // without the other fails here or there, and either is enough.
      expect(createHash('sha256').update(FIXTURE_BYTES).digest('hex')).toBe(
        FILE_SCAN_CONTRACT_FIXTURE_DIGEST,
      );
    });

    it('declares a version the build supports', () => {
      expect(SUPPORTED_FILE_SCAN_CONTRACT_VERSIONS).toContain(
        FILE_SCAN_CONTRACT_VERSION,
      );
    });

    it('writes the fixture at the version it claims', () => {
      expect(FIXTURE.contractVersion).toBe(FILE_SCAN_CONTRACT_VERSION);
    });
  });

  describe('reading a scan request', () => {
    it('accepts the fixture', () => {
      expect(parseScanRequestMessage(FIXTURE.request)).toEqual(FIXTURE.request);
    });

    it('accepts a request that belongs to a campaign', () => {
      const campaignId = '5d2c1b0a-9e8f-4d7c-8b6a-5f4e3d2c1b0a';

      expect(parseScanRequestMessage(request({ campaignId }))).toEqual(
        expect.objectContaining({ campaignId }),
      );
    });

    it.each([
      ['a string', 'not a message'],
      ['null', null],
      ['an array', []],
    ])('refuses %s in place of a message', (_description, value) => {
      expect(() => parseScanRequestMessage(value)).toThrow(
        FileScanContractError,
      );
    });

    it.each([
      ['an unsupported version', { schemaVersion: 99 }, 'schemaVersion'],
      [
        'a version that is not a number',
        { schemaVersion: '1' },
        'schemaVersion',
      ],
      ['an identifier that is not a UUID', { assetId: 'nope' }, 'assetId'],
      [
        'an uppercase UUID',
        { assetId: '4F1A0E2C-8B3D-4A59-9C21-6F7E5D4C3B2A' },
        'assetId',
      ],
      ['an empty object key', { objectKey: '' }, 'objectKey'],
      [
        'an object key beyond the limit',
        { objectKey: 'a'.repeat(1025) },
        'objectKey',
      ],
      [
        'a missing object version',
        { objectVersion: undefined },
        'objectVersion',
      ],
      [
        'an uppercase hash',
        { expectedSha256: 'A'.repeat(64) },
        'expectedSha256',
      ],
      ['a short hash', { expectedSha256: 'a'.repeat(63) }, 'expectedSha256'],
      ['a negative policy version', { policyVersion: -1 }, 'policyVersion'],
      ['a fractional policy version', { policyVersion: 1.5 }, 'policyVersion'],
      ['a campaign that is not a UUID', { campaignId: 'nope' }, 'campaignId'],
      ['a trace that is not a UUID', { traceId: 'nope' }, 'traceId'],
    ])('refuses %s', (_description, changes, field) => {
      // Field-by-field rather than one blanket "it validates" test, because
      // each of these is a distinct way a message can be wrong and a guard
      // that quietly stopped checking one of them would still pass a test
      // that only asserted the good case.
      let caught: FileScanContractError | undefined;

      try {
        parseScanRequestMessage(request(changes));
      } catch (error) {
        caught = error as FileScanContractError;
      }

      expect(caught?.field).toBe(field);
    });

    it('refuses an absent object version rather than reading it as null', () => {
      const withoutIt = { ...FIXTURE.request };
      delete withoutIt.objectVersion;

      expect(() => parseScanRequestMessage(withoutIt)).toThrow(
        'File scan contract violated at: objectVersion',
      );
    });

    it('carries no field that names where to fetch from', () => {
      // The first acceptance criterion, as a test rather than as a comment.
      // A URL, a bucket or a credential appearing in this message is the
      // difference between a worker that reads one bucket and a worker that
      // can be told to read anything.
      expect(Object.keys(FIXTURE.request).sort()).toEqual([
        'assetId',
        'campaignId',
        'expectedSha256',
        'objectKey',
        'objectVersion',
        'policyVersion',
        'schemaVersion',
        'traceId',
      ]);
    });
  });

  describe('reading a verdict', () => {
    it.each(['clean', 'rejected', 'retry'] as const)(
      'accepts the %s fixture',
      name => {
        expect(parseScanVerdictMessage(FIXTURE.verdicts[name])).toEqual(
          FIXTURE.verdicts[name],
        );
      },
    );

    it('accepts a verdict from a scanner that named no versions', () => {
      const parsed = parseScanVerdictMessage(
        verdict('retry', { engineVersion: null, signatureVersion: null }),
      );

      expect(parsed).toEqual(
        expect.objectContaining({
          engineVersion: null,
          signatureVersion: null,
        }),
      );
    });

    it.each([
      [
        'an unsupported version',
        verdict('clean', { schemaVersion: 2 }),
        'schemaVersion',
      ],
      ['an unknown outcome', verdict('clean', { outcome: 'MAYBE' }), 'outcome'],
      [
        'an unknown rejection code',
        verdict('rejected', { rejectionCode: 'UNLUCKY' }),
        'rejectionCode',
      ],
      [
        'a refusal with no code',
        verdict('rejected', { rejectionCode: null }),
        'rejectionCode',
      ],
      [
        'a clean verdict carrying a code',
        verdict('clean', { rejectionCode: 'INFECTED' }),
        'rejectionCode',
      ],
      [
        'a retry carrying a code',
        verdict('retry', { rejectionCode: 'INFECTED' }),
        'rejectionCode',
      ],
      [
        'an attempt that is not a UUID',
        verdict('clean', { attemptId: 'nope' }),
        'attemptId',
      ],
      [
        'an empty definition epoch',
        verdict('clean', { definitionEpoch: '' }),
        'definitionEpoch',
      ],
      ['an empty engine name', verdict('clean', { engine: '' }), 'engine'],
      [
        'a timestamp without milliseconds',
        verdict('clean', { scannedAt: '2026-09-19T12:00:00Z' }),
        'scannedAt',
      ],
      [
        'a timestamp in local time',
        verdict('clean', { scannedAt: '2026-09-19T12:00:00.000+01:00' }),
        'scannedAt',
      ],
      [
        'an observed hash that is not a hash',
        verdict('clean', { observedSha256: 'nope' }),
        'observedSha256',
      ],
      [
        'an engine version that is not a string',
        verdict('clean', { engineVersion: 7 }),
        'engineVersion',
      ],
    ])('refuses %s', (_description, message, field) => {
      let caught: FileScanContractError | undefined;

      try {
        parseScanVerdictMessage(message);
      } catch (error) {
        caught = error as FileScanContractError;
      }

      expect(caught?.field).toBe(field);
    });

    it('refuses a clean verdict that measured nothing', () => {
      // The single most important line in this file. A clean answer about
      // bytes nobody hashed is not an answer, and the contract refuses to
      // carry one rather than leaving the backend to notice.
      let caught: FileScanContractError | undefined;

      try {
        parseScanVerdictMessage(verdict('clean', { observedSha256: null }));
      } catch (error) {
        caught = error as FileScanContractError;
      }

      expect(caught?.field).toBe('observedSha256');
    });

    it('refuses a message that is not an object', () => {
      expect(() => parseScanVerdictMessage(42)).toThrow(FileScanContractError);
    });
  });

  describe('the error it raises', () => {
    it('names the field and not the value', () => {
      const error = new FileScanContractError('assetId');

      expect(error.name).toBe('FileScanContractError');
      expect(error.field).toBe('assetId');
      expect(error.message).toBe('File scan contract violated at: assetId');
    });
  });
});
