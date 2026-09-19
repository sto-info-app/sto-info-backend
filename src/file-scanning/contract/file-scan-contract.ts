/**
 * The contract between the backend and the file scan worker.
 *
 * **This file is duplicated, byte for byte, in both repositories.** There is
 * no shared package, so the copies are held together by
 * {@link FILE_SCAN_CONTRACT_FIXTURE_DIGEST} and by a contract test on each
 * side that checks it. Changing the shape means changing the fixture, which
 * changes the digest, which has to be changed here — in both copies, or one
 * repository's test fails. Drift becomes a failing test rather than a
 * production surprise.
 *
 * It imports nothing, deliberately. An import would tie the file to one
 * repository's module layout and the copies could no longer be compared as
 * text.
 *
 * ADR-0006 fixes what may travel: an asset identifier, an immutable object
 * location and a hash. **No arbitrary URL, no credentials, no CSV rows.** The
 * worker resolves the bucket from its own configuration, so a message cannot
 * name somewhere to fetch from and there is no SSRF surface to defend.
 */

/** The version of the message shapes declared in this file. */
export const FILE_SCAN_CONTRACT_VERSION = 1;

/**
 * Every contract version this build understands.
 *
 * The worker refuses to start when its configured version is absent from this
 * list, rather than running against a shape it half-understands — ADR-0006
 * decision 3. A list rather than a single number so that a rollout can
 * support two versions at once while the other side catches up.
 */
export const SUPPORTED_FILE_SCAN_CONTRACT_VERSIONS: readonly number[] = [1];

/** The queue the backend asks for a scan on. */
export const FILE_SCAN_REQUEST_QUEUE = 'file-scan';

/** The queue the worker answers on. */
export const FILE_SCAN_VERDICT_QUEUE = 'file-scan-verdict';

/** The job name carried by a scan request. */
export const FILE_SCAN_REQUEST_JOB = 'scan-asset';

/** The job name carried by a verdict. */
export const FILE_SCAN_VERDICT_JOB = 'record-verdict';

/**
 * The SHA-256 of `__fixtures__/file-scan-contract-v1.json`, as lowercase hex.
 *
 * The one value that keeps the two copies of this file honest. It is checked
 * by a test in each repository against the bytes of that repository's own
 * fixture.
 */
export const FILE_SCAN_CONTRACT_FIXTURE_DIGEST =
  '7ebcbeefa64dffd534f27e55bc09c9d02c0a491769a1f9f970528e75bcc033d6';

/**
 * What a scan attempt concluded.
 *
 * Three outcomes and not two, because "the scanner did not answer" is not the
 * same as "the scanner said no". The first is worth trying again; the second
 * never is. Both are equally not clean in the meanwhile, which is
 * ADR-0005 decision 4.
 */
export const SCAN_OUTCOMES = ['CLEAN', 'REJECTED', 'RETRY'] as const;

/** What a scan attempt concluded. */
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number];

/**
 * Why an attempt refused, for an administrator.
 *
 * Never shown to a reader. A person who uploads a file that is refused is
 * told that it was refused, and nothing else — ADR-0005 decision 6. A
 * signature name tells an attacker which of their attempts got through.
 */
export const SCAN_REJECTION_CODES = [
  /** The scanner reported a match. */
  'INFECTED',
  /** The bytes fetched did not hash to the bytes the registry recorded. */
  'HASH_MISMATCH',
  /** The object was larger than this worker will read. */
  'SIZE_LIMIT_EXCEEDED',
  /** An archive, an encrypted payload or a format the scanner cannot open. */
  'UNSUPPORTED_PAYLOAD',
  /** The object named by the message is not in quarantine. */
  'OBJECT_MISSING',
  /** Attempts were retried until the budget ran out and none answered. */
  'RETRY_BUDGET_EXHAUSTED',
] as const;

/** Why an attempt refused, for an administrator. */
export type ScanRejectionCode = (typeof SCAN_REJECTION_CODES)[number];

/**
 * A request to scan one object.
 *
 * Everything here is server-derived. `objectKey` comes from the registry,
 * which built it from the asset's own identifier and never from a filename
 * somebody typed.
 */
export interface ScanRequestMessage {
  /** The contract version this message was written against. */
  readonly schemaVersion: number;
  /** The asset in the backend's registry. */
  readonly assetId: string;
  /** Where the bytes are, within the quarantine bucket. */
  readonly objectKey: string;
  /** The store's version of the object, when it has one. Null on R2. */
  readonly objectVersion: string | null;
  /** The SHA-256 the registry recorded when the bytes were stored. */
  readonly expectedSha256: string;
  /** Which scanning policy applies. */
  readonly policyVersion: number;
  /** The rescan campaign this belongs to, when it belongs to one. */
  readonly campaignId: string | null;
  /** Carried through to the verdict so one upload reads as one story. */
  readonly traceId: string;
}

/**
 * What a scan attempt concluded about one object.
 *
 * A verdict is a statement about bytes and nothing more. It does not publish
 * anything and it cannot: the backend decides that separately, against
 * current permissions and a fresh look at the registry — ADR-0015 decision 3.
 *
 * It carries no byte count and no detected content type, although the worker
 * observes both. Those are answers to "what did a scanner see", which
 * ADR-0015 puts in the scan record and not in the registry, and the registry
 * already recorded a size of its own when the bytes were stored. A field
 * nothing reads is a field that goes wrong quietly.
 */
export interface ScanVerdictMessage {
  /** The contract version this message was written against. */
  readonly schemaVersion: number;
  /** The asset in the backend's registry. */
  readonly assetId: string;
  /** The worker's own record of this attempt. */
  readonly attemptId: string;
  /** The object that was read. */
  readonly objectKey: string;
  /** The store's version of the object, when it had one. */
  readonly objectVersion: string | null;
  /** The hash the request carried. */
  readonly expectedSha256: string;
  /**
   * The hash of the bytes the scanner actually read.
   *
   * Null when they were never fully read — the object was missing, too large
   * or the read failed part way. A verdict with no observed hash can never be
   * clean, and the backend refuses to treat it as one.
   */
  readonly observedSha256: string | null;
  /** Which scanning policy was applied. */
  readonly policyVersion: number;
  /**
   * Which signature database answered.
   *
   * Part of the idempotency key, so the same bytes scanned again after an
   * update are a new attempt rather than a duplicate of the old one.
   */
  readonly definitionEpoch: string;
  /** What the attempt concluded. */
  readonly outcome: ScanOutcome;
  /** Why it refused. Set when, and only when, the outcome is `REJECTED`. */
  readonly rejectionCode: ScanRejectionCode | null;
  /** The scanner's name. */
  readonly engine: string;
  /** The scanner's version, or null when it did not say. */
  readonly engineVersion: string | null;
  /** The signature database's version, or null when it did not say. */
  readonly signatureVersion: string | null;
  /** When the attempt finished, as an ISO 8601 instant in UTC. */
  readonly scannedAt: string;
  /** The identifier the request carried. */
  readonly traceId: string;
}

/** A UUID, in the canonical lowercase form. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A SHA-256 as sixty-four lowercase hexadecimal characters. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** An ISO 8601 instant in UTC, to millisecond precision. */
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The longest object key the contract will carry. */
const MAX_OBJECT_KEY_LENGTH = 1024;

/** The longest free-text value the contract will carry. */
const MAX_LABEL_LENGTH = 255;

/**
 * Raised when a message does not match the contract.
 *
 * Carries the field rather than the value. A malformed message is still
 * untrusted input, and echoing it into a log is how untrusted input reaches a
 * place somebody reads.
 */
export class FileScanContractError extends Error {
  /**
   * Creates an instance of FileScanContractError.
   *
   * @param field - Which part of the message was wrong.
   */
  constructor(public readonly field: string) {
    super(`File scan contract violated at: ${field}`);
    this.name = 'FileScanContractError';
  }
}

/**
 * Narrows an unknown value to an object with string keys.
 *
 * @param value - The value.
 * @param field - The field to name if it is not one.
 * @returns The value, as a record.
 * @throws FileScanContractError when it is not an object.
 */
function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FileScanContractError(field);
  }

  return value as Record<string, unknown>;
}

/**
 * Reads a string matching a pattern.
 *
 * @param source - The message.
 * @param field - The field to read.
 * @param pattern - The shape it must have.
 * @returns The value.
 * @throws FileScanContractError when it is absent or the wrong shape.
 */
function readPattern(
  source: Record<string, unknown>,
  field: string,
  pattern: RegExp,
): string {
  const value = source[field];

  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new FileScanContractError(field);
  }

  return value;
}

/**
 * Reads a non-empty string no longer than a limit.
 *
 * @param source - The message.
 * @param field - The field to read.
 * @param maxLength - The longest it may be.
 * @returns The value.
 * @throws FileScanContractError when it is absent, empty or too long.
 */
function readText(
  source: Record<string, unknown>,
  field: string,
  maxLength: number,
): string {
  const value = source[field];

  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new FileScanContractError(field);
  }

  return value;
}

/**
 * Reads a value that is either a bounded string or explicitly null.
 *
 * Explicitly: an absent field is a violation and not a null. The difference
 * between "the store gave no version" and "somebody forgot to send one" is
 * the difference between a verdict bound to known bytes and a verdict bound
 * to nothing.
 *
 * @param source - The message.
 * @param field - The field to read.
 * @param maxLength - The longest it may be.
 * @returns The value, or null.
 * @throws FileScanContractError when it is absent or the wrong type.
 */
function readNullableText(
  source: Record<string, unknown>,
  field: string,
  maxLength: number,
): string | null {
  if (!(field in source)) {
    throw new FileScanContractError(field);
  }

  const value = source[field];

  if (value === null) {
    return null;
  }

  return readText(source, field, maxLength);
}

/**
 * Reads a non-negative safe integer.
 *
 * @param source - The message.
 * @param field - The field to read.
 * @returns The value.
 * @throws FileScanContractError when it is absent or not one.
 */
function readCount(source: Record<string, unknown>, field: string): number {
  const value = source[field];

  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new FileScanContractError(field);
  }

  return value as number;
}

/**
 * Reads a value from a fixed set.
 *
 * @param source - The message.
 * @param field - The field to read.
 * @param allowed - The permitted values.
 * @returns The value.
 * @throws FileScanContractError when it is absent or not permitted.
 */
function readEnum<TValue extends string>(
  source: Record<string, unknown>,
  field: string,
  allowed: readonly TValue[],
): TValue {
  const value = source[field];

  if (typeof value !== 'string' || !allowed.includes(value as TValue)) {
    throw new FileScanContractError(field);
  }

  return value as TValue;
}

/**
 * Reads a scan request from an untrusted message body.
 *
 * @param value - Whatever arrived on the queue.
 * @returns The request.
 * @throws FileScanContractError when the message does not match the contract.
 */
export function parseScanRequestMessage(value: unknown): ScanRequestMessage {
  const source = asRecord(value, 'message');
  const schemaVersion = readCount(source, 'schemaVersion');

  if (!SUPPORTED_FILE_SCAN_CONTRACT_VERSIONS.includes(schemaVersion)) {
    throw new FileScanContractError('schemaVersion');
  }

  return {
    schemaVersion,
    assetId: readPattern(source, 'assetId', UUID_PATTERN),
    objectKey: readText(source, 'objectKey', MAX_OBJECT_KEY_LENGTH),
    objectVersion: readNullableText(source, 'objectVersion', MAX_LABEL_LENGTH),
    expectedSha256: readPattern(source, 'expectedSha256', SHA256_PATTERN),
    policyVersion: readCount(source, 'policyVersion'),
    campaignId:
      source.campaignId === null
        ? null
        : readPattern(source, 'campaignId', UUID_PATTERN),
    traceId: readPattern(source, 'traceId', UUID_PATTERN),
  };
}

/**
 * Reads a verdict from an untrusted message body.
 *
 * Two rules are enforced here rather than left to the reader, because both of
 * them are the difference between a safe file and an unsafe one. A `REJECTED`
 * verdict must say why, and a `CLEAN` verdict must carry the hash of the
 * bytes that were actually read — a clean answer about bytes nobody measured
 * is not an answer at all.
 *
 * @param value - Whatever arrived on the queue.
 * @returns The verdict.
 * @throws FileScanContractError when the message does not match the contract.
 */
export function parseScanVerdictMessage(value: unknown): ScanVerdictMessage {
  const source = asRecord(value, 'message');
  const schemaVersion = readCount(source, 'schemaVersion');

  if (!SUPPORTED_FILE_SCAN_CONTRACT_VERSIONS.includes(schemaVersion)) {
    throw new FileScanContractError('schemaVersion');
  }

  const outcome = readEnum(source, 'outcome', SCAN_OUTCOMES);
  const rejectionCode =
    source.rejectionCode === null
      ? null
      : readEnum(source, 'rejectionCode', SCAN_REJECTION_CODES);

  if ((outcome === 'REJECTED') !== (rejectionCode !== null)) {
    throw new FileScanContractError('rejectionCode');
  }

  const observedSha256 =
    source.observedSha256 === null
      ? null
      : readPattern(source, 'observedSha256', SHA256_PATTERN);

  if (outcome === 'CLEAN' && observedSha256 === null) {
    throw new FileScanContractError('observedSha256');
  }

  return {
    schemaVersion,
    assetId: readPattern(source, 'assetId', UUID_PATTERN),
    attemptId: readPattern(source, 'attemptId', UUID_PATTERN),
    objectKey: readText(source, 'objectKey', MAX_OBJECT_KEY_LENGTH),
    objectVersion: readNullableText(source, 'objectVersion', MAX_LABEL_LENGTH),
    expectedSha256: readPattern(source, 'expectedSha256', SHA256_PATTERN),
    observedSha256,
    policyVersion: readCount(source, 'policyVersion'),
    definitionEpoch: readText(source, 'definitionEpoch', MAX_LABEL_LENGTH),
    outcome,
    rejectionCode,
    engine: readText(source, 'engine', MAX_LABEL_LENGTH),
    engineVersion: readNullableText(source, 'engineVersion', MAX_LABEL_LENGTH),
    signatureVersion: readNullableText(
      source,
      'signatureVersion',
      MAX_LABEL_LENGTH,
    ),
    scannedAt: readPattern(source, 'scannedAt', INSTANT_PATTERN),
    traceId: readPattern(source, 'traceId', UUID_PATTERN),
  };
}
