# Security Policy

## Supported Versions

We provide security updates for the following versions:

| Version         | Supported                           |
| --------------- | ----------------------------------- |
| `development`   | :white_check_mark: (Ongoing)        |
| Production Tags | :white_check_mark: (Latest release) |

The `development` branch is the primary target for all security fixes. Production releases are tagged and should be considered the latest stable state.

## Automated Security Testing

This repository employs multiple layers of automated security testing to identify vulnerabilities early in the development lifecycle.

### Property-based fuzz testing with fast-check

**What it does:**
Property-based fuzz testing generates thousands of random inputs to test code behaviour under unexpected conditions. This helps identify edge cases, crashes, and unhandled exceptions.

**When it runs:**

- **Pull requests**: Lightweight tests (~50 iterations per property) to provide fast feedback
- **Weekly schedule**: Comprehensive tests (~1000 iterations per property) for deep analysis
- **Manual trigger**: Available via workflow_dispatch with configurable iteration counts

**How to run locally:**

```bash
# Lightweight (fast feedback)
npm run test:fuzz

# Comprehensive (deep analysis)
npm run test:fuzz:full

# Custom iteration count
FUZZ_NUM_RUNS=500 npm run test:fuzz
```

**Current test coverage:**

- DTO validation (class-validator integration)
- String manipulation and parsing utilities
- JSON parsing robustness
- Type conversion edge cases

### OWASP ZAP DAST scanning

**What it does:**
ZAP (Zed Attack Proxy) performs Dynamic Application Security Testing by actively scanning the running API for common web vulnerabilities including:

- SQL injection
- Cross-site scripting (XSS)
- Security header misconfigurations
- Authentication/authorisation bypass
- Information disclosure
- Insecure API endpoints
- And 50+ other vulnerability types

**When it runs:**

- **Automated Version Bumps**: ZAP baseline scan against the dev API `/health` endpoint (fast, ~10 minutes). This runs after a successful version bump is merged into `development`.
- **Weekly schedule**: ZAP full scan against the dev API base URL (comprehensive, ~30 minutes, deep spider + active scan).
- **Manual trigger**: Available via workflow_dispatch with configurable scan type.

**Scan execution:**

- ZAP scans run against the development API environment.
- Scans are triggered by automated version bump commits or the weekly schedule. A 7-minute deployment wait is used to ensure the environment is ready.
- Reports stored as workflow artifacts for 30 days.

**Failure criteria:**

- Scan fails on Medium or High severity findings
- Low and Informational findings logged but do not fail the build

**Limitations:**

- **Authentication**: Scans run against unauthenticated endpoints only; authenticated endpoints requiring JWT tokens are not currently tested
- **Coverage**: Baseline scans target only `/health`; weekly/manual full scans spider from the base URL but may not discover all routes
- **Version matching**: On `development` pushes, the ZAP workflow checks that the deployed `/version` matches this repo's `package.json` version before scanning
- **False positives**: Some findings may be false positives; tune via `.zap/rules.tsv`

**Tuning false positives:**

Edit `.zap/rules.tsv` to suppress known false positives:

```tsv
# Format: <scanId>	<action>	<url>
10202	IGNORE	https://dev-api\\.sto-info\\.com/api/known-safe-endpoint
```

Common scan IDs are documented in `.zap/rules.tsv`.

**How to interpret results:**

1. Download ZAP report artifact from workflow run
2. Open `index.html` in browser
3. Review findings by severity
4. Investigate Medium/High findings first
5. Add legitimate false positives to `.zap/rules.tsv`

**Future enhancements:**

- Add authenticated scan context with JWT token
- Include OpenAPI/Swagger definition for better route discovery
- Add custom ZAP scripts for API-specific vulnerability tests

### Continuous updates

Both fast-check and ZAP are updated regularly via Dependabot to ensure the latest vulnerability signatures and testing capabilities.

## Reporting a Vulnerability

If you believe you have discovered a security vulnerability, please report it privately through one of the following channels:

- **GitHub Private Reporting**: Use the "Report a vulnerability" button on the [Security tab](https://github.com/sto-info-app/sto-info-backend/security/advisories/new).
- **Email**: Send a report to [security@startrekonline.info](mailto:security@startrekonline.info).

### What not to include publicly

Please do **not** create public issues for security vulnerabilities. Avoid including sensitive data such as:

- Production credentials or API keys.
- Personally Identifiable Information (PII).
- Detailed exploit code that could be used maliciously before a fix is available.

### What to expect

- We will acknowledge receipt of your report within 48 hours.
- We will provide an estimated timeline for a fix and keep you updated on progress.
- We follow a coordinated disclosure process; we ask that you do not disclose the vulnerability publicly until a fix has been released.
