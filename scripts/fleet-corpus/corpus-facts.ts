import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structural analysis of the STO roster CSV corpus.
 *
 * Reads only structure. Character names, account handles, public comments and
 * officer comments are matched but never returned, logged or written anywhere.
 * Nothing this module returns can reconstruct a roster row.
 *
 * See the Fleet Community implementation plan section 3 for the dialect this
 * encodes, and the implementation notes for the evidence it reproduces.
 */

export const NORMAL_HEADER =
  'Character Name,Account Handle,Level,Class,Guild Rank,' +
  'Contribution Total,Join Date,Rank Change Date,Last Active Date,' +
  'Status,Public Comment,Public Comment Last Edit Date';

export const OFFICER_HEADER_SUFFIX =
  ',Officer Comment,Officer Comment Author,Officer Comment Last Edit Date';

export const OFFICER_HEADER = NORMAL_HEADER + OFFICER_HEADER_SUFFIX;

/** Observed date shape: `M/D/YYYY h:mm:ssam`. Never `Date.parse`. */
export const STO_DATE_PATTERN = String.raw`\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}:\d{2}[apAP][mM]`;

/** The first nine fields are comma-free in this corpus (plan section 3.3). */
const PREFIX_NINE = Array<string>(9).fill('[^,]*').join(',');

/**
 * The 12-column shape: nine comma-free fields, quoted Status, quoted Public
 * Comment, then an optional date. Anchored at both ends.
 */
export const NO_TAIL_ROW = new RegExp(
  `^${PREFIX_NINE},"(?<status>.*)","(?<publicComment>.*)",` +
    `(?<publicCommentEditedAt>${STO_DATE_PATTERN}|)$`,
);

/**
 * The 15-column shape. The Officer Comment is quoted; the Officer Comment
 * Author and its date are NOT quoted. That asymmetry is load-bearing: treating
 * the author as a quoted field fails to match every officer row in the corpus.
 */
export const WITH_TAIL_ROW = new RegExp(
  `^${PREFIX_NINE},"(?<status>.*)","(?<publicComment>.*)",` +
    `(?<publicCommentEditedAt>${STO_DATE_PATTERN}|),` +
    `"(?<officerComment>.*)",(?<officerAuthor>[^,]*),` +
    `(?<officerEditedAt>${STO_DATE_PATTERN}|)$`,
);

/** Anchored at both ends; the Fleet label is captured before the FINAL stamp. */
export const STANDARD_FILENAME =
  /^(?<fleet>.+)_(?<date>\d{8})-(?<time>\d{6})\.[Cc][Ss][Vv]$/;

const BOM = '﻿';

export interface CorpusFacts {
  /** Deterministic digest over sorted (filename, content hash) pairs. */
  corpusDigest: string;
  csvFileCount: number;
  rosterRowCount: number;
  normalHeaderFiles: number;
  officerHeaderFiles: number;
  unknownHeaderFiles: string[];
  standardFilenames: number;
  nonStandardFilenames: string[];
  distinctFleetLabels: number;
  byteIdenticalDuplicates: number;
  bomFiles: number;
  undecodableFiles: string[];
  /** Rows that actually carry the officer tail under a 15-column header. */
  officerTailRows: number;
  /** Rows matching neither anchored shape. Must be zero. */
  unparsedRows: number;
  /** Rows matching BOTH shapes, i.e. a genuinely ambiguous tail. */
  ambiguousRows: number;
  rowsWithQuotesInPublicComment: number;
  rowsWithCommasInPublicComment: number;
  rowsWithCommasInStatus: number;
  rowsWithQuotesInStatus: number;
  distinctClassValues: number;
  distinctGuildRankLabels: number;
}

/** Hashes a file's bytes. Used for provenance only; contents are not retained. */
export function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listCsvFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.toLowerCase().endsWith('.csv')) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found.sort();
}

function splitRows(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.map(line => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/**
 * Derives the structural facts of a corpus directory.
 *
 * @param corpusDir - Directory containing the STO roster CSV exports.
 * @returns Counts and shape statistics. No roster content is included.
 */
export function deriveCorpusFacts(corpusDir: string): CorpusFacts {
  const files = listCsvFiles(corpusDir);

  const seenDigests = new Map<string, string>();
  const digestParts: string[] = [];
  const classValues = new Set<string>();
  const rankLabels = new Set<string>();
  const fleetLabels = new Set<string>();

  const facts: CorpusFacts = {
    corpusDigest: '',
    csvFileCount: files.length,
    rosterRowCount: 0,
    normalHeaderFiles: 0,
    officerHeaderFiles: 0,
    unknownHeaderFiles: [],
    standardFilenames: 0,
    nonStandardFilenames: [],
    distinctFleetLabels: 0,
    byteIdenticalDuplicates: 0,
    bomFiles: 0,
    undecodableFiles: [],
    officerTailRows: 0,
    unparsedRows: 0,
    ambiguousRows: 0,
    rowsWithQuotesInPublicComment: 0,
    rowsWithCommasInPublicComment: 0,
    rowsWithCommasInStatus: 0,
    rowsWithQuotesInStatus: 0,
    distinctClassValues: 0,
    distinctGuildRankLabels: 0,
  };

  for (const path of files) {
    const base = path.split(/[\\/]/).pop() ?? path;
    const bytes = readFileSync(path);

    const digest = createHash('sha256').update(bytes).digest('hex');
    digestParts.push(`${base}:${digest}`);
    if (seenDigests.has(digest)) {
      facts.byteIdenticalDuplicates += 1;
    } else {
      seenDigests.set(digest, base);
    }

    const match = STANDARD_FILENAME.exec(base);
    if (match?.groups) {
      facts.standardFilenames += 1;
      fleetLabels.add(match.groups.fleet);
    } else {
      facts.nonStandardFilenames.push(base);
    }

    let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (Buffer.compare(Buffer.from(text, 'utf8'), bytes) !== 0) {
      facts.undecodableFiles.push(base);
      continue;
    }
    if (text.startsWith(BOM)) {
      facts.bomFiles += 1;
      text = text.slice(BOM.length);
    }

    const lines = splitRows(text);
    if (lines.length === 0) {
      facts.unknownHeaderFiles.push(base);
      continue;
    }

    const header = lines[0];
    const isOfficerFile = header === OFFICER_HEADER;
    if (isOfficerFile) {
      facts.officerHeaderFiles += 1;
    } else if (header === NORMAL_HEADER) {
      facts.normalHeaderFiles += 1;
    } else {
      facts.unknownHeaderFiles.push(base);
      continue;
    }

    for (const row of lines.slice(1)) {
      facts.rosterRowCount += 1;

      const withTail = isOfficerFile ? WITH_TAIL_ROW.exec(row) : null;
      const noTail = NO_TAIL_ROW.exec(row);

      if (withTail && noTail) {
        facts.ambiguousRows += 1;
      }

      const parsed = withTail ?? noTail;
      if (!parsed?.groups) {
        facts.unparsedRows += 1;
        continue;
      }
      if (withTail) {
        facts.officerTailRows += 1;
      }

      const { status, publicComment } = parsed.groups;
      if (publicComment.includes('"')) {
        facts.rowsWithQuotesInPublicComment += 1;
      }
      if (publicComment.includes(',')) {
        facts.rowsWithCommasInPublicComment += 1;
      }
      if (status.includes(',')) {
        facts.rowsWithCommasInStatus += 1;
      }
      if (status.includes('"')) {
        facts.rowsWithQuotesInStatus += 1;
      }

      // Class and Guild Rank are game data, not personal data. Only their
      // cardinality is reported.
      const prefix = row.split(',', 5);
      if (prefix.length === 5) {
        classValues.add(prefix[3]);
        rankLabels.add(prefix[4]);
      }
    }
  }

  facts.distinctFleetLabels = fleetLabels.size;
  facts.distinctClassValues = classValues.size;
  facts.distinctGuildRankLabels = rankLabels.size;
  facts.corpusDigest = createHash('sha256')
    .update(digestParts.sort().join('\n'))
    .digest('hex');

  return facts;
}
