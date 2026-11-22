import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  CorpusFacts,
  deriveCorpusFacts,
  hashFile,
} from './fleet-corpus/corpus-facts';
import { FIXTURES } from './fleet-corpus/fixture-definitions';

/**
 * Generates the committed Fleet Community CSV fixtures and re-verifies the
 * roster corpus baseline recorded in the implementation plan.
 *
 * Run with:
 *   NODE_ENV=local npm run fixtures:fleet-corpus
 *
 * The real corpus contains genuine officer notes and player identifiers. It is
 * never copied into this repository: the fixtures are entirely synthetic, and
 * the corpus is read only to confirm that those synthetic shapes still match
 * reality. The corpus path is supplied by environment variable and is never
 * committed.
 *
 * Environment:
 *   STO_ROSTER_CORPUS_DIR  Optional. Directory of real STO roster CSV exports.
 *                          When set, the structural baseline is re-derived and
 *                          compared with EXPECTED_BASELINE below.
 *   STO_ROSTER_CORPUS_ZIP  Optional. The archive those CSVs came from. Only its
 *                          bytes are hashed, to confirm provenance.
 */

const REQUIRED_NODE_ENV = 'local';

/** Provenance of the archive analysed for the v1 plan, section 3.1. */
const EXPECTED_ZIP_SHA256 =
  '040e289bb59f0b7bed4a1ee567cb3ded740c7da1e6254e12a90d7ca53cfe5d25';

/**
 * Structural facts asserted by the plan, independently reproduced on
 * 17 September 2026. A difference here means either the corpus changed or the
 * dialect contract in corpus-facts.ts drifted -- both need investigating
 * before the importer is trusted.
 */
const EXPECTED_BASELINE: Partial<Record<keyof CorpusFacts, number>> = {
  csvFileCount: 1199,
  rosterRowCount: 144713,
  normalHeaderFiles: 331,
  officerHeaderFiles: 868,
  standardFilenames: 1165,
  distinctFleetLabels: 38,
  byteIdenticalDuplicates: 0,
  bomFiles: 0,
  officerTailRows: 5700,
  unparsedRows: 0,
  ambiguousRows: 0,
  rowsWithQuotesInPublicComment: 4694,
  rowsWithCommasInPublicComment: 4207,
  rowsWithCommasInStatus: 4,
  distinctClassValues: 13,
  distinctGuildRankLabels: 117,
};

const FIXTURE_DIR = resolve(
  __dirname,
  '..',
  'test',
  'fixtures',
  'fleet-community',
);

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function writeFixtures(): void {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const manifest = FIXTURES.map(fixture => {
    const body = fixture.bom ? `﻿${fixture.content}` : fixture.content;
    writeFileSync(join(FIXTURE_DIR, fixture.filename), body, 'utf8');
    return {
      filename: fixture.filename,
      expectation: fixture.expectation,
      purpose: fixture.purpose,
      bom: fixture.bom === true,
      bytes: Buffer.byteLength(body, 'utf8'),
    };
  });

  const accepted = manifest.filter(f => f.expectation === 'accept').length;
  const rejected = manifest.length - accepted;

  writeFileSync(
    join(FIXTURE_DIR, 'manifest.json'),
    `${JSON.stringify(
      {
        description:
          'Synthetic STO roster CSV fixtures. No value is copied from the ' +
          'real corpus. Officer fields carry an OFFICER-CANARY token that ' +
          'must never appear outside these files.',
        generator: 'scripts/generate-fleet-corpus-fixtures.ts',
        fixtures: manifest,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(
    `  Wrote ${manifest.length} fixtures to test/fixtures/fleet-community`,
  );
  console.log(`    accept: ${accepted}   reject: ${rejected}`);
}

function verifyCorpus(): void {
  const zipPath = process.env.STO_ROSTER_CORPUS_ZIP;
  if (zipPath) {
    if (!existsSync(zipPath)) {
      fail(`STO_ROSTER_CORPUS_ZIP does not exist: ${zipPath}`);
    }
    const digest = hashFile(zipPath);
    const match = digest === EXPECTED_ZIP_SHA256;
    console.log(`\n  Archive SHA-256: ${digest}`);
    console.log(
      match
        ? '    matches the archive analysed for the plan'
        : `    DIFFERS from the plan's archive (${EXPECTED_ZIP_SHA256})`,
    );
  }

  const corpusDir = process.env.STO_ROSTER_CORPUS_DIR;
  if (!corpusDir) {
    console.log(
      '\n  STO_ROSTER_CORPUS_DIR not set: skipping the baseline recheck.\n' +
        '  Fixtures were still written. Set it to re-verify the dialect.',
    );
    return;
  }
  if (!existsSync(corpusDir)) {
    fail(`STO_ROSTER_CORPUS_DIR does not exist: ${corpusDir}`);
  }

  console.log(`\n  Re-deriving the corpus baseline from ${corpusDir} ...`);
  const facts = deriveCorpusFacts(corpusDir);

  let differences = 0;
  console.log('\n  Structural baseline:');
  for (const [key, expected] of Object.entries(EXPECTED_BASELINE)) {
    const actual = facts[key as keyof CorpusFacts] as number;
    const ok = actual === expected;
    if (!ok) {
      differences += 1;
    }
    console.log(
      `    ${ok ? 'ok  ' : 'DIFF'} ${key}: ${actual}` +
        (ok ? '' : ` (plan says ${expected})`),
    );
  }

  console.log(`\n  Corpus digest: ${facts.corpusDigest}`);
  console.log(`  Non-standard filenames: ${facts.nonStandardFilenames.length}`);
  console.log(`  Unknown headers: ${facts.unknownHeaderFiles.length}`);
  console.log(`  Undecodable files: ${facts.undecodableFiles.length}`);

  if (differences > 0) {
    fail(
      `${differences} structural difference(s) from the recorded baseline. ` +
        'Do not treat the importer contract as verified until these are ' +
        'explained.',
    );
  }
  console.log('\n  Baseline reproduced with no differences.');
}

function main(): void {
  if (process.env.NODE_ENV !== REQUIRED_NODE_ENV) {
    fail(
      `This script only runs with NODE_ENV=${REQUIRED_NODE_ENV} ` +
        `(saw ${process.env.NODE_ENV ?? 'unset'}). It reads a private roster ` +
        'corpus and must never run in CI or a deployed environment.',
    );
  }

  console.log('\n  Fleet Community corpus fixtures\n');
  writeFixtures();
  verifyCorpus();
  console.log('');
}

main();
