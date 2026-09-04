import { spawnSync } from 'node:child_process';

/**
 * Optional upper bound on how many mutatable source files a run will accept.
 *
 * Off by default: the workflow's 240 minute budget is sized to let even a
 * wide-touching PR finish, so a PR is gated on a real result rather than on a
 * skipped job. Set MUTATION_MAX_FILES to a positive integer to make the run
 * bail out above that many files and defer to the scheduled full run instead,
 * should a diff ever turn out to be too wide even for that budget.
 *
 * For scale: the repository has ~184 files in the mutate set, and PR #975
 * changed 610 files of which 164 were mutatable, producing ~8,800 mutants.
 */
const DEFAULT_MAX_MUTATE_FILES = 0;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });
}

function runOrThrow(command, args) {
  const result = run(command, args);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const output = [stdout, stderr].filter(Boolean).join('\n');
    const outputSuffix = output ? `\n${output}` : '';
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status}${outputSuffix}`,
    );
  }

  return result.stdout;
}

function isRelevantMutationFile(filePath) {
  if (!filePath.startsWith('src/') || !filePath.endsWith('.ts')) return false;

  const excludedSuffixes = [
    '.d.ts',
    '.spec.ts',
    '.fuzz.spec.ts',
    '.module.ts',
    '.dto.ts',
    '.entity.ts',
    '.entities.ts',
    '.interface.ts',
    '.interfaces.ts',
    '.enum.ts',
    '.constant.ts',
    '.constants.ts',
  ];

  if (excludedSuffixes.some(suffix => filePath.endsWith(suffix))) return false;
  if (filePath.includes('environments/')) return false;
  if (filePath.includes('database/migrations/')) return false;
  if (filePath.includes('views/')) return false;
  if (filePath.endsWith('main.ts')) return false;
  if (filePath.endsWith('index.ts')) return false;
  if (filePath.endsWith('express.d.ts')) return false;

  return true;
}

function computeChangedFiles(baseRef) {
  const stdout = runOrThrow('git', [
    'diff',
    '--name-only',
    `${baseRef}...HEAD`,
  ]);
  return stdout
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(isRelevantMutationFile);
}

function resolveMaxFiles() {
  const raw = process.env.MUTATION_MAX_FILES;
  if (!raw) return DEFAULT_MAX_MUTATE_FILES;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `MUTATION_MAX_FILES must be a positive integer, received "${raw}".`,
    );
  }

  return parsed;
}

function exceedsLimit(fileCount, maxFiles) {
  return maxFiles > 0 && fileCount > maxFiles;
}

function main() {
  const baseRef = process.env.BASE_REF || 'origin/development';

  const changedFiles = computeChangedFiles(baseRef);
  if (changedFiles.length === 0) {
    process.stdout.write(
      'No relevant source files changed. Skipping mutation testing.\n',
    );
    process.exit(0);
  }

  const maxFiles = resolveMaxFiles();
  if (exceedsLimit(changedFiles.length, maxFiles)) {
    process.stdout.write(
      `${changedFiles.length} mutatable files changed, above the ` +
        `MUTATION_MAX_FILES limit of ${maxFiles}. Leaving this diff to the ` +
        'scheduled full run (Mutation Testing (Full)).\n',
    );
    process.exit(0);
  }

  const mutateArg = changedFiles.join(',');
  process.stdout.write(
    `Mutating ${changedFiles.length} file(s): ${mutateArg}\n`,
  );

  // `shell` is required on Windows, where `npx` resolves to `npx.cmd` and a
  // shell-less spawn fails with ENOENT, so the script cannot be run locally.
  const result = spawnSync('npx', ['stryker', 'run', '--mutate', mutateArg], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
