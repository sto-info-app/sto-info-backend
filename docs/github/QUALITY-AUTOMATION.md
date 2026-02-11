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

## See Also

- [SECURITY-AUTOMATION.md](SECURITY-AUTOMATION.md) for security-specific automation details.
