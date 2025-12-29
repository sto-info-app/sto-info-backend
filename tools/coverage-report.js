const fs = require('fs');
const path = require('path');

const coveragePath = path.join(
  __dirname,
  '..',
  'src',
  'coverage',
  'coverage-final.json',
);
const outputPath = path.join(
  __dirname,
  '..',
  'coverage',
  'per-file-coverage.txt',
);

const data = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));

function pct(covered, total) {
  if (total === 0) return 100;
  return Math.round((covered / total) * 10000) / 100;
}

function summarizeFile(fileCov) {
  const statements = fileCov.s ?? {};
  const functions = fileCov.f ?? {};
  const branches = fileCov.b ?? {};

  const statementsTotal = Object.keys(statements).length;
  const statementsCovered = Object.values(statements).filter(v => v > 0).length;

  const functionsTotal = Object.keys(functions).length;
  const functionsCovered = Object.values(functions).filter(v => v > 0).length;

  const branchesTotal = Object.values(branches).reduce(
    (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
    0,
  );
  const branchesCovered = Object.values(branches).reduce(
    (acc, arr) =>
      acc + (Array.isArray(arr) ? arr.filter(v => v > 0).length : 0),
    0,
  );

  return {
    statements: {
      covered: statementsCovered,
      total: statementsTotal,
      pct: pct(statementsCovered, statementsTotal),
    },
    branches: {
      covered: branchesCovered,
      total: branchesTotal,
      pct: pct(branchesCovered, branchesTotal),
    },
    functions: {
      covered: functionsCovered,
      total: functionsTotal,
      pct: pct(functionsCovered, functionsTotal),
    },
  };
}

const rows = Object.entries(data)
  .map(([filePathKey, cov]) => {
    const rel = path.relative(path.join(__dirname, '..'), filePathKey);
    return { rel, ...summarizeFile(cov) };
  })
  .filter(r => r.rel.startsWith('src' + path.sep) || r.rel.startsWith('src/'))
  .sort((a, b) => a.rel.localeCompare(b.rel));

const header = [
  'file',
  'stmts%',
  'stmts',
  'branch%',
  'branch',
  'func%',
  'func',
].join('\t');
const lines = [header];
for (const r of rows) {
  lines.push(
    [
      r.rel,
      r.statements.pct.toFixed(2),
      r.statements.covered + '/' + r.statements.total,
      r.branches.pct.toFixed(2),
      r.branches.covered + '/' + r.branches.total,
      r.functions.pct.toFixed(2),
      r.functions.covered + '/' + r.functions.total,
    ].join('\t'),
  );
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');

const below = rows.filter(
  r => r.statements.pct < 100 || r.branches.pct < 100 || r.functions.pct < 100,
);

process.stdout.write(
  'Wrote ' +
    path.relative(path.join(__dirname, '..'), outputPath) +
    ' with ' +
    rows.length +
    ' files.\n',
);
process.stdout.write('Files below 100%: ' + below.length + '\n');
