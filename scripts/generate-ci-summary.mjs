import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SUMMARY_FILE = process.env.GITHUB_STEP_SUMMARY;
const PR_COMMENT_FILE = process.env.CI_SUMMARY_FILE;

function appendToSummary(text) {
  if (SUMMARY_FILE) {
    appendFileSync(SUMMARY_FILE, text + '\n');
  }
  if (PR_COMMENT_FILE) {
    appendFileSync(PR_COMMENT_FILE, text + '\n');
  }
  console.log(text);
}

// --- 1. Unit Test Results (JUnit XML) ---
function getTestSummary() {
  const junitPath = join('reports', 'junit', 'junit.xml');
  if (!existsSync(junitPath)) return null;

  const content = readFileSync(junitPath, 'utf8');
  // Simple regex extraction for JUnit
  const tests = content.match(/tests="(\d+)"/) || [0, 0];
  const failures = content.match(/failures="(\d+)"/) || [0, 0];
  const errors = content.match(/errors="(\d+)"/) || [0, 0];
  const skipped = content.match(/skipped="(\d+)"/) || [0, 0];

  return {
    total: parseInt(tests[1]),
    failed: parseInt(failures[1]) + parseInt(errors[1]),
    skipped: parseInt(skipped[1]),
    passed:
      parseInt(tests[1]) -
      (parseInt(failures[1]) + parseInt(errors[1]) + parseInt(skipped[1])),
  };
}

// --- 2. Code Coverage (JSON Summary) ---
function getCoverageSummary() {
  const covPath = join('reports', 'coverage', 'coverage-summary.json');
  if (!existsSync(covPath)) return null;

  try {
    const data = JSON.parse(readFileSync(covPath, 'utf8'));
    return data.total;
  } catch {
    return null;
  }
}

// --- Main execution ---

appendToSummary('## 🚀 Backend CI Pipeline Summary');

// Unit Tests
const tests = getTestSummary();
if (tests) {
  const status = tests.failed > 0 ? '❌' : '✅';
  appendToSummary(`### ${status} Unit Tests`);
  appendToSummary(`- **Total**: ${tests.total}`);
  appendToSummary(`- **Passed**: ${tests.passed}`);
  appendToSummary(`- **Failed**: ${tests.failed}`);
  if (tests.skipped > 0) appendToSummary(`- **Skipped**: ${tests.skipped}`);
}

// Coverage
const cov = getCoverageSummary();
if (cov) {
  const getIcon = pct => (pct >= 99 ? '🟢' : pct >= 80 ? '🟡' : '🔴');
  appendToSummary('### 📊 Code Coverage');
  appendToSummary('| Category | Percentage | Status |');
  appendToSummary('| :--- | :---: | :---: |');
  appendToSummary(
    `| Statements | ${cov.statements.pct}% | ${getIcon(cov.statements.pct)} |`,
  );
  appendToSummary(
    `| Branches | ${cov.branches.pct}% | ${getIcon(cov.branches.pct)} |`,
  );
  appendToSummary(
    `| Functions | ${cov.functions.pct}% | ${getIcon(cov.functions.pct)} |`,
  );
  appendToSummary(`| Lines | ${cov.lines.pct}% | ${getIcon(cov.lines.pct)} |`);
}

appendToSummary('\n_Full reports available as workflow artifacts._');
