# Quality Automation

This document outlines the automated tools and processes used to maintain high code quality standards.

## Semantic PRs

We enforce the [Conventional Commits](https://www.conventionalcommits.org/) specification for pull request titles.

- **What it enforces**: PR titles must follow a specific format (e.g. `feat: add character search`, `fix: resolve auth timeout`).
- **Why**: This enables automated versioning, changelog generation, and better commit history readability.
- **How to fix**: If a check fails, update the PR title to follow the pattern `<type>: <description>`. Valid types include `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, and `ci`.

## Codecov

Codecov provides analysis of our test coverage.

- **Measurement**: It measures what percentage of the codebase is covered by unit tests.
- **Status Checks**: Coverage reports appear directly in PR comments and as a status check.
- **Blocking**: PR merges may be blocked if coverage drops below the required threshold or if new code is not adequately tested.

CI uploads both coverage (`reports/coverage/lcov.info`) and JUnit test results (`reports/junit/junit.xml`) to Codecov.

## Jest coverage thresholds

In addition to Codecov reporting, Jest enforces coverage thresholds during CI.

- **Local**: `npm run test:cov` runs tests and enforces configured thresholds.
- **CI**: `npm run verify` runs `test:cov` as part of the lint/test pipeline.

If the test suite passes but the job fails, check the per-file coverage output in the Jest summary and the generated report in `reports/coverage/`.

## Mutation testing (Stryker)

Mutation testing is used to validate the effectiveness of tests (i.e., tests should fail when the code is mutated).

- **Full run**: `npm run test:mutation`
- **Incremental (PRs)**: The `lint-test` workflow runs incremental mutation testing on pull requests.
  - It computes relevant changed files under `src/**/*.ts` (excluding specs, modules, and other non-runtime files) and mutates only those.
  - It uses Stryker incremental mode to cache results between runs.
  - You can reproduce locally with: `BASE_REF=origin/<base-branch> npm run test:mutation:incremental`

## SonarCloud Quality Gate

SonarCloud enforces a "Quality Gate" that must pass for all changes.

- **Metrics**: It checks for bugs, code smells, vulnerabilities, and duplication.
- **Feedback**: A passing Quality Gate is required for merging to the `development` branch.
- **Action**: Detailed reports are available on the SonarCloud dashboard (linked via badges in README).

## Sentry Runtime Monitoring

Sentry is used for error tracking and performance monitoring in production and staging.

- **Monitoring**: It captures unhandled exceptions and performance bottlenecks in real-time.
- **Privacy**: The configuration for Sentry has `sendDefaultPii` set to `false` to ensure no sensitive personal data is sent to the monitoring service.
- **Usage**: Developers use Sentry alerts to identify and resolve issues as they occur in the live environment.

## Required Status Checks & "Smart Skips"

To maintain high standards without making the development process frustrating, we use a "Smart Skip" strategy for our required PR checks.

- **Behavior**: All required workflows (`Lint and Test`, `Audit`, `CodeQL`, etc.) trigger on every PR to `development` and `production` to ensure status checks are never "stuck."
- **Efficiency**: A lightweight filter job identifies if relevant code was changed. If only documentation, READMEs, or configs were updated, the heavy jobs are skipped.
- **Compliance**: This ensures that even "Skipped" jobs report as a success to GitHub, preserving the green "All checks passed" status while saving significant CI minutes.

## Automated CI Summaries

To provide fast and actionable feedback, the CI pipeline automatically generates a summary of test results and code coverage.

- **Location**: Summaries are posted as a **GitHub Step Summary** in the Actions tab and as a **PR comment** on every pull request.
- **Content**: The summary includes pass/fail counts for unit tests and a tabular breakdown of code coverage (Statements, Branches, Functions, Lines).
- **Automation**: This is handled by a custom script (`scripts/generate-ci-summary.mjs`) that parses JUnit and JSON coverage reports.

## See Also

- [SECURITY-AUTOMATION.md](SECURITY-AUTOMATION.md) for security-specific automation details.
