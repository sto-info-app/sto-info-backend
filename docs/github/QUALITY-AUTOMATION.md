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
- **ESM packages**: Jest scripts set `NODE_OPTIONS=--experimental-vm-modules` so Jest 30 can `require()` native ESM packages such as `@nestjs/jwt@12`. Run tests through the npm scripts rather than invoking `jest` directly.

If the test suite passes but the job fails, check the per-file coverage output in the Jest summary and the generated report in `reports/coverage/`.

## Mutation testing (Stryker)

Mutation testing is used to validate the effectiveness of tests (i.e., tests should fail when the code is mutated).

- **Full run**: `npm run test:mutation` locally. In CI it runs weekly, split into shards: see [Weekly full run](#weekly-full-run).
- **Incremental (PRs)**: `.github/workflows/mutation-testing-incremental.yml` runs incremental mutation testing on pull requests to `development`, `production` and `epic/*`.
  - It computes relevant changed files under `src/**/*.ts` (excluding specs, modules, and other non-runtime files) and mutates only those.
  - It does not use Stryker's incremental mode: restricting `--mutate` to the changed files would overwrite a shared cache with results for those files alone (see the comment in `scripts/run-incremental-mutation.mjs`).
  - A PR that changes more than 150 mutatable files (`MUTATION_MAX_FILES` in the workflow) skips it and is left to the weekly run. A diff that wide cannot finish inside the job's 240 minutes: PR #975's 164 files were tracking at about 3 hours 45 minutes.
  - You can reproduce locally with: `BASE_REF=origin/<base-branch> npm run test:mutation:incremental`

### Weekly full run

`.github/workflows/mutation-testing.yml` runs every Sunday at midnight UTC, and can be started by hand from the Actions tab.

**Why it is split.** A GitHub-hosted job is stopped at 6 hours, whatever its `timeout-minutes` says. As a single job the run was cancelled at 6 hours every week from October 2026 (12,364 mutants, 76% done at best), and on 22 November 2026 the runner ran out of memory at 52%. The Fleet Community merge takes the mutate set from ~240 to ~540 files (about 33,000 mutants).

**How it is split.**

- `scripts/mutation-shards.mjs` expands the `mutate` globs in `stryker.config.mjs` and puts each file in one of `SHARD_TOTAL` shards (16) by a hash of its path. A file stays in the same shard as other files are added or removed, so its saved results stay with it. The hash does not balance sizes: at 16 shards they run from about 750 to 2,750 mutants.
- Each shard is a matrix job (`Full Mutation Analysis (shard N)`), with its own 6-hour limit and 16 GB runner. It runs Stryker with `stryker.shard.config.mjs`, which is the base config without the `break` threshold and with a smaller test runner heap (see Memory), at `--concurrency 2` for the dry run's memory. The Stryker step stops at 330 minutes, so the save and upload steps still run if it overruns.
- **Chunks.** A shard does not run Stryker once over all its files. It splits them into `CHUNK_TOTAL` chunks (4), by another part of the same hash, and runs Stryker on each chunk in turn. Each chunk keeps its own incremental results and its own report (`reports/mutation/shard-N-chunk-C/`). Speed varies about threefold between shards with how slow their covering tests are (on 27 November 2026, from about 340 to 880 mutants an hour), so a shard's size does not predict whether it fits in 330 minutes. With chunks a shard that overruns still keeps the chunks it finished, and the next run starts further on, so a slow shard finishes over two or three runs instead of failing every week.
- **Memory.** The step's `NODE_OPTIONS` gives the parent Stryker process a 3 GB heap, and the TypeScript checker inherits it. The Jest test runner gets 6 GB from `testRunnerNodeArgs` in `stryker.shard.config.mjs`, which takes precedence over `NODE_OPTIONS`; the base config's 8 GB is for a dry run over the whole mutate set. A process uses more memory than its heap, so keep the three well under the runner's 16 GB: with 8 + 8 + 8 GB three shards lost their runner on 26 November 2026, and with 3 + 3 + 8 GB four did on 27 November. A runner lost this way keeps no logs and saves nothing. A test runner that runs out of heap is only restarted by Stryker, costing time.
- The `Full Mutation Analysis` job then merges the chunk reports into one `mutation.json` and `mutation.html`, writes the score and mutant counts to the run summary, and fails if a chunk's report is missing (it lists which) or the combined score is below the `break` threshold (currently 0, so only a missing chunk fails it). It works out which chunks to expect from the mutate set, so an empty chunk is not counted as missing.

**Incremental results.** Each chunk runs Stryker with `--incremental` and keeps its results file (`reports/stryker-incremental/shard-N-of-T-chunk-C-of-K.json`) in the shard's Actions cache. The next run re-tests only mutants whose source or covering tests changed, so a quiet week is quick. The cache is saved whenever the Stryker step succeeds, fails or times out, so finished chunks are kept; a lost runner saves nothing. Stryker carries results for files outside `--mutate` over from the incremental file into its report, so the script keeps each chunk's results and report to the chunk's own files. A chunk with no results file yet is seeded from the shard's `shard-N-of-T.json` from before chunks. To test every mutant again, for example after changing mutators or Stryker's version, start the workflow by hand with **force** ticked.

**Changing the shard or chunk count.** Change `SHARD_TOTAL` and the matrix's `shard` list together; a matrix cannot read `env`. The cache key includes the shard total, so every shard starts afresh and the next run is a cold one. Changing `CHUNK_TOTAL` moves files between chunks and starts their results afresh too. Each chunk has to fit in 330 minutes on its own, and each adds a few minutes of start-up and dry run. The Free plan runs 20 jobs at once across the organisation, so the frontend's weekly run is on Monday rather than Sunday. The frontend runs one chunk a shard, the default.

**Locally.**

```sh
npm run test:mutation:shard -- list 2 16 --chunks 4   # files in shard 2 of 16, by chunk
npm run test:mutation:shard -- run 2 16 --chunks 4    # run shard 2 of 16 (add --force to ignore saved results)
npm run test:mutation:shard -- merge <dir with shard reports> reports/mutation 16 4
npm run test:scripts                                  # tests for the shard script
```

`scripts/mutation-shards.mjs` and its tests are the same in the backend and the frontend. Change them in both.

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
