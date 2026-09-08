# Contributing to sto-info-backend

Thank you for considering contributing to sto-info-backend! We welcome contributions from everyone. Below are some guidelines to help you get started.

## How to Contribute

1. **Fork the repository**: Click the "Fork" button at the top right of the repository page.
2. **Clone your fork**: Clone your forked repository to your local machine.

```sh
git clone https://github.com/steverobertsuk/sto-info-backend.git
```

3. **Create a branch**: Create a new branch for your changes.

```sh
git checkout -b my-feature-branch
```

4. **Make your changes**: Make your changes to the codebase.
5. **Commit your changes**: Commit your changes with a descriptive commit message.

```sh
git commit -m "Add new feature"
```

- Please use [conventional commit messages](https://www.conventionalcommits.org/en/v1.0.0/) for your commits. This helps in keeping the commit history clean and easy to understand.

6. **Push to your fork**: Push your changes to your forked repository.

```sh
git push origin my-feature-branch
```

7. **Create a Pull Request**: Open a pull request to the main repository.

## Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## Reporting Issues

If you find a bug or have a feature request, please open an issue on GitHub.

## Style Guide

- Follow the existing code style.
- Write clear and concise commit messages.
- Ensure your code passes all tests before submitting a pull request.

### Git hooks

[Husky](https://typicode.github.io/husky/) installs two hooks when you run
`npm install`:

- **`pre-commit`** ([.husky/pre-commit](.husky/pre-commit)) runs
  [lint-staged](https://github.com/lint-staged/lint-staged) over the files you
  have staged. Staged TypeScript gets `eslint --fix` and `prettier --write`, so
  formatting and import order are corrected in place and restaged. Import order
  is enforced rather than advisory — the lint-test workflow runs
  `npm run format:check` as its own step — so let the hook order your imports
  instead of arranging them by hand.
- **`commit-msg`** ([.husky/commit-msg](.husky/commit-msg)) requires a
  `Signed-off-by` trailer on every commit. Use `git commit -s`, or add the line
  yourself. DCO is also enforced in CI by the
  [DCO workflow](.github/workflows/dco.yml).

Write hook scripts as bare commands: no shebang, and no
`. "$(dirname "$0")/_/husky.sh"` line. Husky invokes them through `.husky/_/h`
with `sh -e` and already puts `node_modules/.bin` on `PATH`. Both lines are
deprecated in husky 9 and will break the hook in husky 10.

To skip the hooks for a single commit — rarely a good idea — use
`git commit --no-verify`.

### Formatting

Prettier owns the layout of the TypeScript sources, including import order. To
check or apply it without committing:

```sh
npm run format:check   # verify, changing nothing
npm run format         # apply
```

`format:check` runs as its own step in the
[lint-test workflow](.github/workflows/lint-test.yml), so unformatted code fails
the build rather than being quietly corrected.

## Testing

Please ensure that your changes do not break any existing tests and add new tests for new features.

Thank you for your contributions!

## Troubleshooting

### `npm install` or `npm audit` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

Some antivirus or internet-security software (e.g. Norton Web/Mail Shield, Avast, Kaspersky) performs HTTPS inspection — it intercepts SSL traffic and re-signs certificates with its own CA. That CA is trusted by Windows, but not by Node.js's built-in certificate bundle, so Node.js rejects the connection.

You can confirm this is the cause by running:

```sh
node -e "require('https').get('https://registry.npmjs.org', r => console.log(r.socket.getPeerCertificate().issuer))"
```

If the `CN` in the output is your security software (e.g. `Norton Web/Mail Shield Root`) rather than a standard CA (DigiCert, Let's Encrypt, etc.), apply the fix below.

**Fix:** Tell Node.js to use the Windows system certificate store, which already trusts your security software's CA. Set this once as a persistent user environment variable:

```powershell
[System.Environment]::SetEnvironmentVariable("NODE_OPTIONS", "--use-system-ca", "User")
```

Then open a new terminal — the setting takes effect immediately for all subsequent Node.js processes, including `npm`.

> This flag (`--use-system-ca`) requires Node.js 24 or later. GitHub Actions runners are unaffected because they connect to the npm registry directly without any SSL interception.
