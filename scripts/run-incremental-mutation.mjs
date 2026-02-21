import { spawnSync } from 'node:child_process';

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
    '.module.ts',
    '.model.ts',
    '.models.ts',
    '.interface.ts',
    '.interfaces.ts',
    '.enum.ts',
    '.constant.ts',
    '.constants.ts',
  ];

  if (excludedSuffixes.some(suffix => filePath.endsWith(suffix))) return false;
  if (filePath.includes('environments/')) return false;
  if (filePath.endsWith('main.ts')) return false;

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

function main() {
  const baseRef = process.env.BASE_REF || 'origin/development';

  const changedFiles = computeChangedFiles(baseRef);
  if (changedFiles.length === 0) {
    process.stdout.write(
      'No relevant source files changed. Skipping mutation testing.\n',
    );
    process.exit(0);
  }

  const mutateArg = changedFiles.join(',');
  process.stdout.write(`Mutating files: ${mutateArg}\n`);

  const result = spawnSync(
    'npx',
    [
      'stryker',
      'run',
      '--mutate',
      mutateArg,
      '--concurrency',
      '2',
      '--incremental',
      '--force',
    ],
    { stdio: 'inherit' },
  );

  process.exit(result.status ?? 1);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
