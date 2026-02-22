# Security Automation

This repository uses automated tools to ensure high security standards and community recognition.

## OpenSSF Scorecard

We use the [OpenSSF Scorecard](https://scorecard.dev/) to automatically assess our security posture.

### What it does

- **Schedule**: Runs weekly (Sundays at 03:30 UTC) and on every push to the `development` and `production` branches.
- **Findings**: Results are uploaded to GitHub **Security** -> **Code scanning alerts**.
- **Badge**: A Scorecard badge is displayed in the main README, linking to the detailed report.

## GitHub Code Scanning

Code scanning is our central dashboard for security vulnerabilities found in the code.

- **Source**: Findings come from OpenSSF Scorecard and integrated SARIF reports.
- **Location**: View alerts in the repository's [Security tab](../../security/code-scanning).
- **Automation**: Alerts are automatically updated when a workflow completes.

## Snyk

Snyk is used for static analysis and dependency scanning.

- **Scans**: It checks for vulnerabilities in application code (SAST) and third-party dependencies.
- **Results**: Detailed findings appear in the Snyk dashboard and as PR checks.
- **Blocking**: Snyk can be configured to block PR merges if new high-severity vulnerabilities are introduced.
- **Fixing**: Use `snyk monitor` or the dashboard's "Fix this vulnerability" suggestions to update dependencies or refactor code.

## Property-based Fuzzing (fast-check)

Generic fuzzing generates random inputs to test code robustness. In this repo, it's used to discover edge cases in DTO validation, string parsing, and JWT handling.

- **PRs**: A lightweight pass (50 runs) is a **required check** for all PRs.
- **Schedule**: A deep pass (1000 runs) occurs weekly.
- **Smart Skip**: If a PR only modifies documentation, the fuzzing job is skipped to save CI credits, but still reports a "Success" to satisfy branch protection.
- **Reporting**: Detailed fuzzing results are included in the **Automated CI Summaries** posted to each PR.

## DAST Scanning (OWASP ZAP)

The development API is scanned for active runtime vulnerabilities by OWASP ZAP.

- **Trigger**: Runs automatically after automated version bumps are merged to `development`.
- **Wait Time**: The workflow waits 7 minutes for the deployment to settle before starting.
- **Reports**: HTML reports are uploaded as workflow artifacts.

## SonarCloud

SonarCloud provides continuous inspection of code quality and security.

- **Security Hotspots**: Focuses on potential security risks that require human review.
- **Rules**: Checks against a wide range of security rules (OWASP Top 10, CWE, etc.).
- **Results**: Integrated with the SonarCloud dashboard and reported as a status check on PRs.

## Workflow Security

We enforce the principle of least privilege for our GitHub Actions workflows.

- **Default Permissions**: All workflows default to `permissions: {}` at the top level.
- **Job-Level Granularity**: Permissions are only granted at the job level for specific tasks (e.g., `contents: read` for fetching code, `security-events: write` for uploading CodeQL scans).
- **Hardened Runners**: Workflows run on standard GitHub-hosted runners with automated smart-skipping to minimize the attack surface of continuous integration.

## Where to see results

- To see the latest security alerts, go to the [Security tab](../../security/code-scanning).
- To view the detailed Scorecard report, click on the Scorecard badge in the README or visit [scorecard.dev](https://scorecard.dev/viewer/?uri=github.com/sto-info-app/sto-info-backend).
