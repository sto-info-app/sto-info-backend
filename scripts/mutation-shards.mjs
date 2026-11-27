import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  globSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  matchesGlob,
  relative,
  sep,
} from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * Splits the weekly full mutation run into shards, and merges the shards'
 * reports back into one.
 *
 * A GitHub-hosted job stops at 6 hours, and a single full run outgrew that:
 * see "Weekly full run" in docs/github/QUALITY-AUTOMATION.md. Each shard is a
 * matrix job that mutates a fixed slice of the mutate set, then a merge job
 * combines the slices into one report and one score.
 *
 *   node scripts/mutation-shards.mjs list <shard> <total> [--chunks <n>]
 *   node scripts/mutation-shards.mjs run <shard> <total> [--chunks <n>] [--force]
 *   node scripts/mutation-shards.mjs merge <shards dir> <out dir> <total> [<chunks>]
 *
 * With --chunks, a shard runs Stryker once for each of n chunks of its files,
 * each with its own incremental results file. A shard stopped part way keeps
 * the chunks it finished, so the next run starts further on instead of from
 * nothing. The chunk count is 1 unless given.
 *
 * Shards and chunks are numbered from 1. This file is the same in the backend
 * and the frontend; keep the two copies in step.
 */

/** Stryker config read for the mutate globs and the break threshold. */
const BASE_CONFIGS = ['stryker.config.mjs', 'stryker.config.json'];
/** Config the shards run with: the base config without its break threshold. */
const SHARD_CONFIG = 'stryker.shard.config.mjs';
/** Where each shard keeps its incremental results between weekly runs. */
const INCREMENTAL_DIR = join('reports', 'stryker-incremental');
/** Where Stryker writes its reports (the reporters' default file names). */
const REPORT_DIR = join('reports', 'mutation');
/** Mutant statuses that count as detected and undetected in the score. */
const DETECTED = new Set(['Killed', 'Timeout']);
const UNDETECTED = new Set(['Survived', 'NoCoverage']);

/**
 * Loads the base Stryker config from the working directory.
 *
 * @returns {Promise<Record<string, unknown>>} The config object.
 */
export async function loadBaseConfig(cwd = process.cwd()) {
  for (const name of BASE_CONFIGS) {
    const path = join(cwd, name);
    if (!existsSync(path)) continue;
    if (name.endsWith('.json')) return JSON.parse(readFileSync(path, 'utf8'));
    return (await import(pathToFileURL(path).href)).default;
  }
  throw new Error(`No Stryker config found (${BASE_CONFIGS.join(', ')}).`);
}

/**
 * Expands the config's mutate globs into the files Stryker would mutate.
 * Patterns starting with `!` remove files, in order, as Stryker applies them.
 *
 * @param {string[]} patterns - The config's `mutate` list.
 * @returns {string[]} Sorted, forward-slashed paths relative to `cwd`.
 */
export function expandMutate(patterns, cwd = process.cwd()) {
  let files = new Set();
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      const exclude = pattern.slice(1);
      files = new Set([...files].filter(file => !matchesGlob(file, exclude)));
    } else {
      for (const file of globSync(pattern, { cwd })) {
        files.add(file.split(sep).join('/'));
      }
    }
  }
  return [...files].sort((a, b) => a.localeCompare(b));
}

/**
 * Picks the shard a file belongs to from a hash of its path. A file stays in
 * the same shard as others are added or removed, so its incremental results
 * stay in the cache that shard restores.
 *
 * @param {string} file - Forward-slashed path.
 * @param {number} total - Number of shards.
 * @returns {number} Shard number, from 1.
 */
export function shardOf(file, total) {
  const digest = createHash('sha256').update(file).digest();
  return (digest.readUInt32BE(0) % total) + 1;
}

/**
 * @param {string[]} files - The expanded mutate set.
 * @returns {string[]} The files in the given shard.
 */
export function filesForShard(files, shard, total) {
  return files.filter(file => shardOf(file, total) === shard);
}

/**
 * Picks the chunk of its shard a file belongs to, from a different part of
 * the same hash, so the chunks of a shard are independent of the shard split.
 * Like the shard, a file's chunk does not change as other files come and go.
 *
 * @param {string} file - Forward-slashed path.
 * @param {number} chunks - Number of chunks in each shard.
 * @returns {number} Chunk number, from 1.
 */
export function chunkOf(file, chunks) {
  const digest = createHash('sha256').update(file).digest();
  return (digest.readUInt32BE(4) % chunks) + 1;
}

/**
 * @param {string[]} files - A shard's files.
 * @returns {string[]} The files in the given chunk.
 */
export function filesForChunk(files, chunk, chunks) {
  return files.filter(file => chunkOf(file, chunks) === chunk);
}

/**
 * Names the directory a chunk's report is kept in, which the merge uses to
 * tell which chunks reported.
 *
 * @returns {string} For example `shard-3-chunk-2`.
 */
export function chunkReportName(shard, chunk) {
  return `shard-${shard}-chunk-${chunk}`;
}

/**
 * Names a chunk's incremental results file. A single chunk keeps the name a
 * shard had before chunks existed, so its saved results still apply.
 *
 * @returns {string} The file name, without a directory.
 */
export function incrementalFileName(shard, total, chunk, chunks) {
  return chunks === 1
    ? `shard-${shard}-of-${total}.json`
    : `shard-${shard}-of-${total}-chunk-${chunk}-of-${chunks}.json`;
}

/**
 * Every chunk that has files, so has a report to wait for.
 *
 * @param {string[]} files - The expanded mutate set.
 * @returns {string[]} Their report names, as chunkReportName gives them.
 */
export function expectedChunkReports(files, total, chunks) {
  const names = new Set();
  for (const file of files) {
    names.add(chunkReportName(shardOf(file, total), chunkOf(file, chunks)));
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Keeps only the given files in a report or incremental results file.
 * Stryker carries results for files outside its mutate set over from the
 * incremental file into its report, so without this a chunk seeded from a
 * whole shard's results would report the other chunks' files as well.
 *
 * @param {object} report - Parsed mutation-testing-report-schema JSON.
 * @param {string[]} files - Forward-slashed paths relative to `cwd`.
 * @returns {object} The report with only those files.
 */
export function keepFiles(report, files, cwd = process.cwd()) {
  const wanted = new Set(files);
  const kept = Object.entries(report.files ?? {}).filter(([name]) => {
    const path = isAbsolute(name) ? relative(cwd, name) : name;
    return wanted.has(path.split(sep).join('/'));
  });
  return { ...report, files: Object.fromEntries(kept) };
}

/**
 * Reads the chunk count from `--chunks <n>` among the flags.
 *
 * @param {string[]} flags - The command line after the positional arguments.
 * @returns {number} The chunk count, 1 when not given.
 */
export function parseChunks(flags) {
  const at = flags.indexOf('--chunks');
  if (at === -1) return 1;
  return parseCount(flags[at + 1], 'Chunk count');
}

/** Reads a positive integer argument. */
function parseCount(arg, what) {
  const count = Number(arg);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`${what} must be a positive integer, got "${arg}".`);
  }
  return count;
}

/**
 * Reads and validates `<shard> <total>` from the command line.
 *
 * @returns {{ shard: number, total: number }}
 */
export function parseShard(shardArg, totalArg) {
  const shard = Number(shardArg);
  const total = Number(totalArg);
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(
      `Shard total must be a positive integer, got "${totalArg}".`,
    );
  }
  if (!Number.isInteger(shard) || shard < 1 || shard > total) {
    throw new Error(`Shard must be from 1 to ${total}, got "${shardArg}".`);
  }
  return { shard, total };
}

/**
 * Combines shard reports (mutation-testing-report-schema JSON) into one.
 *
 * @param {object[]} reports - One parsed mutation.json per shard.
 * @returns {object} A single report covering every shard's files.
 */
export function mergeReports(reports) {
  if (reports.length === 0) throw new Error('No shard reports to merge.');
  const [first] = reports;
  const merged = { ...first, files: {}, testFiles: {} };
  for (const report of reports) {
    for (const [name, file] of Object.entries(report.files ?? {})) {
      if (merged.files[name]) {
        throw new Error(`${name} appears in more than one shard report.`);
      }
      merged.files[name] = file;
    }
    // A spec covering files in two shards is reported by both; its tests are
    // the same either way, so the last copy is kept.
    Object.assign(merged.testFiles, report.testFiles ?? {});
  }
  if (Object.keys(merged.testFiles).length === 0) delete merged.testFiles;
  return merged;
}

/**
 * Counts mutants by status and works out Stryker's mutation score:
 * detected (killed or timed out) over detected plus undetected (survived or
 * not covered). Errors and ignored mutants are left out, as Stryker does.
 *
 * @param {object} report - A merged report.
 * @returns {{ counts: Record<string, number>, score: number | null, files: number }}
 */
export function scoreReport(report) {
  const counts = {};
  let detected = 0;
  let undetected = 0;
  const files = Object.values(report.files ?? {});
  for (const file of files) {
    for (const mutant of file.mutants ?? []) {
      counts[mutant.status] = (counts[mutant.status] ?? 0) + 1;
      if (DETECTED.has(mutant.status)) detected += 1;
      if (UNDETECTED.has(mutant.status)) undetected += 1;
    }
  }
  const valid = detected + undetected;
  return {
    counts,
    files: files.length,
    score: valid === 0 ? null : (detected / valid) * 100,
  };
}

/**
 * Builds the same single-page report Stryker's html reporter writes.
 *
 * @param {object} report - The merged report.
 * @param {string} elementsScript - Source of mutation-test-elements.js.
 * @returns {string} The HTML page.
 */
export function renderHtml(report, elementsScript) {
  // Stop a "</script>" inside source code or test names closing the tag.
  const backslash = String.fromCodePoint(92);
  const json = JSON.stringify(report).replaceAll('<', `${backslash}u003c`);
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>Mutation report (all shards)</title></head>',
    '<body>',
    '<mutation-test-report-app title-postfix="Stryker (all shards)"></mutation-test-report-app>',
    `<script>${elementsScript.replaceAll('</script', `<${backslash}/script`)}</script>`,
    `<script>document.querySelector('mutation-test-report-app').report = ${json};</script>`,
    '</body>',
    '</html>',
  ].join('\n');
}

/** Finds every mutation.json below a directory. */
function findReports(dir) {
  return readdirSync(dir, { recursive: true })
    .map(entry => String(entry))
    .filter(entry => entry.endsWith('mutation.json'))
    .map(entry => join(dir, entry))
    .sort((a, b) => a.localeCompare(b));
}

async function list(shardArg, totalArg, flags) {
  const { shard, total } = parseShard(shardArg, totalArg);
  const chunks = parseChunks(flags);
  const config = await loadBaseConfig();
  const files = filesForShard(expandMutate(config.mutate), shard, total);
  for (let chunk = 1; chunk <= chunks; chunk += 1) {
    const chunkFiles = filesForChunk(files, chunk, chunks);
    if (chunks > 1) process.stdout.write(`# chunk ${chunk} of ${chunks}\n`);
    if (chunkFiles.length > 0) {
      process.stdout.write(`${chunkFiles.join('\n')}\n`);
    }
  }
}

/**
 * Gives a chunk with no results file of its own the results its whole shard
 * had before chunks existed, cut down to the chunk's files, so turning chunks
 * on does not throw away a shard's saved work.
 */
function seedFromShard(shard, total, chunkFiles, incrementalFile) {
  const shardFile = join(
    INCREMENTAL_DIR,
    incrementalFileName(shard, total, 1, 1),
  );
  if (existsSync(incrementalFile) || !existsSync(shardFile)) return;
  const seed = keepFiles(
    JSON.parse(readFileSync(shardFile, 'utf8')),
    chunkFiles,
  );
  writeFileSync(incrementalFile, JSON.stringify(seed));
  process.stdout.write(
    `Seeded ${basename(incrementalFile)} from ${basename(shardFile)}.\n`,
  );
}

/**
 * Moves a chunk's reports into a directory of their own, keeping only its
 * files, so the next chunk's reports do not overwrite them and the merge
 * can tell which chunks finished.
 */
function keepChunkReports(shard, chunk, chunkFiles) {
  const json = join(REPORT_DIR, 'mutation.json');
  if (!existsSync(json)) return false;
  const dir = join(REPORT_DIR, chunkReportName(shard, chunk));
  mkdirSync(dir, { recursive: true });
  const report = keepFiles(JSON.parse(readFileSync(json, 'utf8')), chunkFiles);
  writeFileSync(join(dir, 'mutation.json'), JSON.stringify(report));
  rmSync(json);
  const html = join(REPORT_DIR, 'mutation.html');
  if (existsSync(html)) renameSync(html, join(dir, 'mutation.html'));
  return true;
}

async function run(shardArg, totalArg, flags) {
  const { shard, total } = parseShard(shardArg, totalArg);
  const chunks = parseChunks(flags);
  const force = flags.includes('--force');
  const config = await loadBaseConfig();
  const all = expandMutate(config.mutate);
  const files = filesForShard(all, shard, total);
  process.stdout.write(
    `Shard ${shard} of ${total}: ${files.length} of ${all.length} file(s), in ${chunks} chunk(s).\n`,
  );
  if (files.length === 0) {
    process.stdout.write('Nothing in this shard. Skipping.\n');
    return 0;
  }

  mkdirSync(INCREMENTAL_DIR, { recursive: true });
  let failed = 0;
  for (let chunk = 1; chunk <= chunks; chunk += 1) {
    const chunkFiles = filesForChunk(files, chunk, chunks);
    process.stdout.write(
      `\nChunk ${chunk} of ${chunks}: ${chunkFiles.length} file(s).\n`,
    );
    if (chunkFiles.length === 0) continue;

    const incrementalFile = join(
      INCREMENTAL_DIR,
      incrementalFileName(shard, total, chunk, chunks),
    );
    if (chunks > 1 && !force) {
      seedFromShard(shard, total, chunkFiles, incrementalFile);
    }
    // A report left by an earlier chunk that stopped part way would
    // otherwise be taken for this one's.
    rmSync(join(REPORT_DIR, 'mutation.json'), { force: true });
    rmSync(join(REPORT_DIR, 'mutation.html'), { force: true });

    const args = [
      join('node_modules', '@stryker-mutator', 'core', 'bin', 'stryker'),
      'run',
      SHARD_CONFIG,
      '--mutate',
      chunkFiles.join(','),
      '--incremental',
      '--incrementalFile',
      incrementalFile,
      '--reporters',
      'json,html,clear-text,progress',
      // One checker and one test runner: see the full workflow for why.
      '--concurrency',
      '2',
    ];
    if (force) args.push('--force');
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    const reported = keepChunkReports(shard, chunk, chunkFiles);
    // Carry on with the other chunks: their results are worth keeping even
    // when this one fails.
    if ((result.status ?? 1) !== 0 || !reported) {
      failed += 1;
      process.stderr.write(`Chunk ${chunk} of ${chunks} did not finish.\n`);
    }
  }
  return failed === 0 ? 0 : 1;
}

async function merge(shardsDir, outDir, totalArg, chunksArg) {
  const total = parseCount(totalArg, 'Shard total');
  const chunks =
    chunksArg === undefined ? 1 : parseCount(chunksArg, 'Chunk count');
  const config = await loadBaseConfig();
  const expected = expectedChunkReports(
    expandMutate(config.mutate),
    total,
    chunks,
  );
  const paths = existsSync(shardsDir) ? findReports(shardsDir) : [];
  const found = new Set(paths.map(path => basename(dirname(path))));
  const missing = expected.filter(name => !found.has(name));
  const report = mergeReports(
    paths.map(path => JSON.parse(readFileSync(path, 'utf8'))),
  );
  const { counts, files, score } = scoreReport(report);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'mutation.json'), JSON.stringify(report));
  const elements = join(
    'node_modules',
    'mutation-testing-elements',
    'dist',
    'mutation-test-elements.js',
  );
  if (existsSync(elements)) {
    writeFileSync(
      join(outDir, 'mutation.html'),
      renderHtml(report, readFileSync(elements, 'utf8')),
    );
  } else {
    process.stdout.write(`No ${elements}; skipping the HTML report.\n`);
  }

  const breakAt = config.thresholds?.break ?? null;
  const scoreText = score === null ? 'n/a' : `${score.toFixed(2)}%`;
  const lines = [
    '## Mutation testing (full, all shards)',
    '',
    `- Chunk reports: ${expected.length - missing.length} of ${expected.length} (${total} shard(s), ${chunks} chunk(s) each)`,
    ...(missing.length > 0 ? [`- Missing: ${missing.join(', ')}`] : []),
    `- Files: ${files}`,
    `- Mutation score: ${scoreText}${breakAt === null ? '' : ` (break at ${breakAt}%)`}`,
    ...Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => `- ${status}: ${count}`),
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }
  process.stdout.write(
    `Wrote ${relative(process.cwd(), join(outDir, 'mutation.json'))}.\n`,
  );

  if (missing.length > 0) {
    process.stderr.write(
      `${missing.length} chunk report(s) missing: the score covers only part of the mutate set.\n`,
    );
    return 1;
  }
  if (breakAt !== null && score !== null && score < breakAt) {
    process.stderr.write(`Mutation score ${scoreText} is below ${breakAt}%.\n`);
    return 1;
  }
  return 0;
}

async function main([command, ...args]) {
  switch (command) {
    case 'list':
      await list(args[0], args[1], args.slice(2));
      return 0;
    case 'run':
      return run(args[0], args[1], args.slice(2));
    case 'merge':
      return merge(args[0], args[1], args[2], args[3]);
    default:
      throw new Error(
        'Usage: mutation-shards.mjs list|run <shard> <total> [--chunks <n>] [--force] | merge <shards dir> <out dir> <total> [<chunks>]',
      );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
