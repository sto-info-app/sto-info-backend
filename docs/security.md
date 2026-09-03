# Security Documentation

This document outlines the security architecture and procedures for the `sto-info-backend`. The project aims to meet **OpenSSF Best Practices Silver** level (and Gold where practical) to ensure high standards of software supply chain security and application hardening.

### Dependency Overrides

This repository uses `npm overrides` in `package.json` to address security issues that originate in transitive dependencies where upgrading a top-level package is not yet possible or would require a breaking change.

**General removal checklist** (apply to any override before removing it):

1. Remove the entry from the `overrides` block in `package.json`.
2. Run `npm install --legacy-peer-deps` to regenerate `package-lock.json`. CI installs with `npm ci --ignore-scripts --legacy-peer-deps`, so the lockfile must be produced with the same peer-resolution mode.
3. Run `npm audit --omit=dev --audit-level=high` — this is the same gate used by `npm run verify` in CI.
4. Run `npm run test:cov` to confirm coverage tooling is unaffected.
5. If either check fails, restore the override and track the upstream fix instead.

Overrides reduce exposure to known vulnerabilities quickly, but they change the dependency tree independently of what upstream packages tested against. Keep them minimal and prefer removing them as soon as upstream dependencies have caught up.

Current overrides in `package.json`:

```json
"overrides": {
  "qs": "^6.16.0"
}
```

As of **2026-09-03** `qs` is the only override the backend still needs. The
`mailparser`, `nanoid`, `js-yaml`, and `typeorm.ioredis` entries were all
verified redundant against the removal checklist above and dropped — see
[Recently Removed Overrides](#recently-removed-overrides).

#### `qs`

- **Vulnerabilities**: [GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26) — remotely triggerable DoS (`qs.stringify` crashes on null/undefined entries in comma-format arrays); [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) — array-limit bypass via bracket-key comma parsing; [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) — DoS via attacker-controlled `isBuffer`. Together these cover `qs 2.2.5 - 6.15.3`; `6.16.0` is the first release patched against all three.
- **Root cause**: `typed-rest-client@2.3.1` (via `@stryker-mutator/core`) pins `qs@6.15.1` exactly.
- **Override**: `"qs": "^6.16.0"` — global pin; the whole tree dedupes to a single patched `qs` (currently `6.16.0`). A nested `"typed-rest-client": { "qs": ... }` form was tried first but npm did not reify it reliably, so the global form is used.
- **Raised from `^6.15.2` on 2026-09-03**: the two later advisories extended the vulnerable range up to and including `6.15.3`, which the old caret range still permitted.

**When it can be removed**: When `typed-rest-client` raises its `qs` pin to `>= 6.16.0` (or Stryker moves to `typed-rest-client@3`). Check with:

```sh
npm view typed-rest-client@latest dependencies.qs
```

#### `html-to-text`

- **Vulnerability**: [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) — `deepmerge-ts` can stack-exhaust when recursively merging object graphs. Affected `deepmerge-ts` versions are patched from `8.0.0`.
- **Current project state (2026-08-31)**: the app and `mailparser@3.9.18` both resolve `html-to-text@10.0.1`, which depends on `deepmerge-ts@^8.0.1` (currently `8.0.2`). No override is required.
- **Previously**: the app pinned `html-to-text@^9.0.5` and left a nested `10.0.0` copy under `preview-email`. That nested copy is gone after the mailparser / preview-email refresh.

**When it can be re-checked**: If `html-to-text` or `mailparser` regresses onto `deepmerge-ts < 8`. Check with:

```sh
npm ls deepmerge-ts html-to-text
```

#### Babel 7 (Jest) and Babel 8 (Stryker)

- **Issue**: `@jest/transform` and related Jest packages depend on `@babel/core@^7.27.4`. `@stryker-mutator/core@10` instruments through Babel 8. `ts-jest@29` still declares an optional Babel 7 peer. CI installs with `npm ci --legacy-peer-deps`, which keeps both lines: Babel 7 at the top of the tree for Jest, Babel 8 nested under `@stryker-mutator/instrumenter`.
- **No override**: forcing `ts-jest` onto Babel 8 drops `@babel/core@7.29.7` from the lockfile. `npm ci --legacy-peer-deps` then fails with "Missing: @babel/core@7.29.7 from lock file".
- **How to refresh the lockfile**: `npm install --legacy-peer-deps` (never a plain `npm install` / `npm update`). Confirm with `npm ci --ignore-scripts --legacy-peer-deps` and `npm ls @babel/core`.

##### `.npmrc` — `legacy-peer-deps=true` (added 2026-09-03)

Until 2026-09-03 this repo had no `.npmrc`, so a plain `npm install` failed
outright with `ERESOLVE could not resolve`:

```
While resolving: ts-jest@29.4.12
Found: @babel/core@8.0.1
Could not resolve dependency:
peerOptional @babel/core@">=7.0.0-beta.0 <8" from ts-jest@29.4.12
```

CI already installs with `npm ci --ignore-scripts --legacy-peer-deps`
(see [.github/actions/cached-dependencies/action.yml](../.github/actions/cached-dependencies/action.yml)),
and the frontend repo already carried the matching `.npmrc`, so local installs
were the only place the flag was missing. The committed `.npmrc`:

```ini
legacy-peer-deps=true
```

makes a bare `npm install` / `npm update` resolve the same way CI does, which
keeps the lockfile reproducible. **Do not remove it** while the Babel 7 / Babel 8
split above persists.

#### NestJS 12 — still deferred (re-checked 2026-09-03)

`@nestjs/*` 12.x is available for every package the backend uses directly, but
the upgrade remains blocked by **two ecosystem packages whose latest releases
still refuse Nest 12 in their peer ranges**:

| Package          | Latest    | Declared `@nestjs/core` peer range | Used by                                                  |
| ---------------- | --------- | ---------------------------------- | -------------------------------------------------------- |
| `nestjs-cls`     | `6.2.2`   | `>= 10 < 12`                       | `ClsModule` in [src/app.module.ts](../src/app.module.ts) |
| `@sentry/nestjs` | `10.73.0` | `^8 \|\| ^9 \|\| ^10 \|\| ^11`     | Error reporting throughout `src/`                        |

Two packages previously listed here are no longer blockers:

- **`@nestjs/terminus`** now publishes `12.0.0` with `@nestjs/core: ^11 || ^12`.
  It is still used (`TerminusModule` in `src/health/health.module.ts`) but no
  longer constrains the upgrade.
- **`@nestjs/throttler`** was **removed from the project on 2026-09-03** — it was
  declared in `dependencies` but never imported anywhere in `src/`. Request
  throttling is done by the `express-rate-limit` + `rate-limit-redis` stack
  configured in [src/main.ts](../src/main.ts), not by Nest's throttler. Earlier
  revisions of this document described it as load-bearing; that was incorrect.

The other reasons recorded on 2026-08-31 still stand:

1. **Isolated ESM majors need Node VM modules.** Nest 12 packages are native
   ESM. Jest 30 can `require()` ESM on Node 24.9+, but that path needs
   `vm.SourceTextModule` (`--experimental-vm-modules`). The test scripts already
   set that flag so `@nestjs/jwt@12` loads; a whole-framework ESM cutover is a
   separate Jest/Vitest piece of work, not a lockfile bump.
2. **CLI 12 is the Nest 12 toolchain.** `@nestjs/cli@12` stops bundling webpack,
   defaults new apps to ESM / Vitest / oxlint / Rspack, and ships `nest upgrade`.
   It belongs with the Nest 12 cutover, not a Nest 11 runtime.

Take Nest 12 as its own change once `nestjs-cls` and `@sentry/nestjs` publish
Nest 12-compatible peer ranges, then upgrade every `@nestjs/*` package together
(the CLI's `nest upgrade` command is the intended path) and rework the Jest
config for ESM.

`@nestjs/jwt@12.0.1` is already on the Nest 11 tree (its peer range includes Nest 8–12). It is a native ESM package with no `require` export condition. Jest 30's `require(esm)` support is gated on `vm.SourceTextModule.prototype.hasAsyncGraph`, which on Node 24.15 still needs `--experimental-vm-modules`. The Jest npm scripts and Stryker `testRunnerNodeArgs` therefore set that flag so auth specs can load `@nestjs/jwt`. Runtime (`node dist/src/main`) does not need the flag: Node 24 can `require()` the ESM build via the `default` export condition.

**When it can be retried**:

```sh
npm view nestjs-cls@latest peerDependencies
npm view @sentry/nestjs@latest peerDependencies
```

#### TypeScript compatibility gate (re-checked 2026-09-03)

`typescript@7.0.2` is published, but the backend stays on `^6.0.3`. Two hard
constraints block it:

| Blocker              | Declared constraint            | Effect                                                                               |
| -------------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| `ts-jest@29.4.12`    | peer `typescript >=4.3 <7`     | The Jest transform chain excludes TypeScript 7 outright; `ts-jest` has no 30.x line. |
| `@nestjs/cli@12.0.0` | dependency `typescript ~6.0.2` | Even the newest Nest CLI still installs a TypeScript 6 compiler for itself.          |

The Nest CLI also fails at runtime under TypeScript 7 with
`The installed TypeScript version (7.0.2) does not expose the programmatic
compiler API that the Nest CLI requires.`

**When it can be retried**: when `ts-jest` publishes a release whose peer range
admits TypeScript 7 (or the project moves off `ts-jest`), and the Nest CLI
depends on a TypeScript 7 compiler. Check with:

```sh
npm view ts-jest@latest peerDependencies.typescript
npm view @nestjs/cli@latest dependencies.typescript
```

#### Unused dependencies removed (2026-09-03)

A dependency audit (`depcheck`, then a manual check of every candidate against
the source, the npm scripts, and every config file) removed ten packages that
nothing in the project referenced. Each removal was confirmed by reinstalling
and re-running `npm run lint`, `npm run format:check`, `npm run build`,
`npm run test:cov`, and `npm run test:fuzz`.

| Removed                  | Section | Why it was safe                                                                                                                                                       |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/throttler`      | prod    | Never imported. Throttling is the `express-rate-limit` + `rate-limit-redis` stack in `src/main.ts`. Removing it also cleared one NestJS 12 blocker.                   |
| `crypto`                 | prod    | Dead npm placeholder that shadows Node's builtin — see below.                                                                                                         |
| `superagent`             | prod    | Not imported. `supertest` (dev) pulls the same `10.3.0` for e2e tests, so the tree is unchanged.                                                                      |
| `swagger-ui-express`     | prod    | Not imported, and `@nestjs/swagger@11` neither depends on nor peers on it — it bundles `swagger-ui-dist` and serves the UI itself. `SwaggerModule.setup` still works. |
| `uuid`                   | prod    | Not imported. Every id in the codebase comes from `randomUUID` in `node:crypto` or from Postgres.                                                                     |
| `@eslint/config-array`   | dev     | Not referenced by `eslint.config.mjs`; leftover from an old transitive-deprecation workaround.                                                                        |
| `@eslint/object-schema`  | dev     | Same.                                                                                                                                                                 |
| `eslint-config-prettier` | dev     | An **optional** peer of `eslint-plugin-prettier` and never referenced by the flat config, which spreads only `prettierPlugin.configs.recommended.rules`.              |
| `source-map-support`     | dev     | Not imported. `tsconfig.json` sets `"sourceMap": true`, which only controls emit; Node 24 reads source maps natively.                                                 |
| `ts-loader`              | dev     | Only needed for webpack builds. `nest-cli.json` declares no builder, so `nest build` uses `tsc`. The project already omitted `webpack` and its other webpack peers.   |

**Verified against CI**: no workflow in `.github/` references any removed
package, and none of the removals touch a command the workflows run.

Two pieces of dead configuration went with them:

- **`eslintConfig` in `package.json`** — a legacy `.eslintrc`-style block naming
  `eslint:recommended`, `plugin:@typescript-eslint/recommended`, and
  `plugin:prettier/recommended`. ESLint 10 uses flat config exclusively and never
  reads it, so it described rules that were not being applied.
- **`arrayBracketSpacing` in `.prettierrc`** — not a Prettier option at all (it is
  an ESLint rule name). Prettier logged `Ignored unknown option` for it on every
  run. Also removed from the frontend's `.prettierrc`, which carried the same key.

#### Import ordering is now actually enforced (2026-09-03)

`.prettierrc` had declared an `importOrder` for some time, but **it never ran**.
Three separate faults:

1. **The plugin was never loaded.** `@ianvs/prettier-plugin-sort-imports` was
   installed but `.prettierrc` had no `plugins` key, so Prettier logged
   `Ignored unknown option { importOrder: ... }` and formatted without it.
2. **Two options had been removed upstream.** `importOrderSeparation` and
   `importOrderSortSpecifiers` are v3 options; the project is on v4, where
   separation is expressed with `""` entries in `importOrder` and specifier
   sorting is unconditional.
3. **Two of the five groups matched nothing.** `^@sto/` and `^@/` are not
   TypeScript path aliases in this project — `tsconfig.json` defines only
   `"src/*"`, and 139 files import through it.

`eslint-plugin-simple-import-sort` was not covering the gap either: it is
registered as a plugin in `eslint.config.mjs` but none of its rules are enabled.
So import order was unenforced by both tools.

The working configuration:

```json
"plugins": ["@ianvs/prettier-plugin-sort-imports"],
"importOrder": [
  "^node:",
  "",
  "^@nestjs/(.*)$",
  "",
  "<THIRD_PARTY_MODULES>",
  "",
  "^src/(.*)$",
  "",
  "^[./]"
],
"importOrderParserPlugins": ["typescript", "decorators-legacy"]
```

`importOrderParserPlugins` is required: without `decorators-legacy` the plugin's
Babel parser aborts on every decorated Nest class with
`This experimental syntax requires enabling one of the following parser plugin(s): "decorators", "decorators-legacy"`.

Turning it on reformatted the imports of **588 files**. That is a one-off cost,
not optional: CI runs `npm run format:check` (`prettier --check "src/**/*.ts"`)
in [lint-test.yml](../.github/workflows/lint-test.yml), and `eslint-plugin-prettier`
surfaces the same formatting through `npm run lint`, so the tree has to match the
config either way. VS Code picks the plugin up automatically through
`esbenp.prettier-vscode` with the existing `editor.formatOnSave`.

#### `crypto` package removed (2026-09-03)

The backend declared a direct dependency on the npm package `crypto@1.0.1`. That
package is a long-dead placeholder — npm marks it
`This package is no longer supported. It's now a built-in Node module.` — and
having it in `node_modules` risks shadowing Node's real `crypto` builtin in any
resolver that prefers `node_modules` over builtins.

It has been removed from `dependencies`, and the two files that imported the
bare specifier now use the explicit builtin form, matching the other eight
`node:crypto` call sites already in `src/`:

```ts
import { randomUUID } from 'node:crypto';
```

Affected files: [src/common/http/request-id.middleware.ts](../src/common/http/request-id.middleware.ts)
and its spec (whose `jest.mock('crypto', ...)` became `jest.mock('node:crypto', ...)`).

#### Recently Removed Overrides

Overrides removed on **2026-09-03** during dependency and audit maintenance. Each
was verified against the removal checklist above: with the override deleted and
the lockfile regenerated, `npm audit` reports **0 vulnerabilities** at every
severity, and `npm run lint`, `npm run test:cov`, `npm run test:fuzz`, and
`npm run build` all pass.

| Override          | Previously forced                            | Resolves to without the override            | Reason for removal                                                                                                                                                                       |
| ----------------- | -------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nanoid`          | `3.3.18`                                     | `nanoid@3.3.18`                             | `postcss@8.5.26` accepts `^3.3.16` and npm now selects the patched `3.3.18` on its own, so the pin no longer changes the tree.                                                           |
| `js-yaml`         | `>=5.2.2`                                    | `js-yaml@3.15.2`, `4.3.2`, `5.3.0`, `5.4.1` | Every installed copy is at or above its advisory's patched version, so audit is clean. Dropping the global force also returns each consumer to the `js-yaml` line it was tested against. |
| `mailparser`      | `{ ".": "^3.9.10", "nodemailer": "^9.0.1" }` | `mailparser@3.9.17`, `nodemailer@9.1.1`     | `preview-email@3.4.0` now resolves a patched `mailparser`, and no nested `nodemailer` copy is installed anywhere in the tree.                                                            |
| `typeorm.ioredis` | `^6.0.0`                                     | `ioredis@6.0.0`                             | `typeorm@1.1.1` resolves `ioredis@6.0.0` natively; the nested override no longer has any effect.                                                                                         |

The postinstall patches in `scripts/patch-nested-packages.js` were **kept** —
they are already no-ops (see below) and remain a cheap safety net if upstream
re-resolution regresses.

The `preview-email/node_modules/uuid` postinstall patch was removed on **2026-08-31**: `preview-email@3.4.0` no longer installs a nested `uuid`, and the top-level `uuid@14.0.2` is the only copy.

Overrides removed on **2026-08-15** during dependency and audit maintenance:

| Override  | Previously forced | Reason for removal                                                                                        |
| --------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `ioredis` | `^5.11.1`         | Direct dependencies already constrain the tree to `5.11.1`; regenerating the lockfile leaves audit clean. |

Overrides removed on **2026-08-05** during dependency and audit maintenance:

| Override          | Previously forced | Reason for removal                                                                                |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `brace-expansion` | `^5.0.8`          | Dependency tree now resolves naturally to `5.0.9` or newer; `npm audit` remains clean without it. |

Overrides removed on **2026-07-21** during the dependency security review — all verified redundant by the removal checklist above (audit clean, lint, build, and full test suite pass without them):

| Override               | Previously forced | Reason for removal                                                                                                                                                                                            |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lodash`               | `^4.18.1`         | Whole tree now resolves naturally to `4.18.1`                                                                                                                                                                 |
| `ajv` (global)         | `^8.18.0`         | Consumers resolve naturally to `8.18.0`; no vulnerable copies installed                                                                                                                                       |
| `eslint.ajv` (nested)  | `^6.14.0`         | `eslint@10.7.0` resolves `ajv@6.14.0` natively and `npm run lint` passes without the override                                                                                                                 |
| `form-data`            | `^4.0.6`          | Whole tree resolves naturally to `4.0.6`                                                                                                                                                                      |
| `js-yaml`              | `4.2.0`           | This older constraint was removed after consumers resolved the then-patched `4.3.0` and `5.2.1` lines naturally. A new `>=5.2.2` override was added on 2026-07-25 for the later GHSA-pm4m-ph32-ghv5 advisory. |
| `anymatch.picomatch`   | `^2.3.2`          | `anymatch` resolves `picomatch@2.3.2` natively                                                                                                                                                                |
| `micromatch.picomatch` | `^2.3.2`          | `micromatch` resolves `picomatch@2.3.2` natively                                                                                                                                                              |

Overrides removed on **2026-04-05** as part of the TypeScript 6 upgrade review — all were found to be redundant because the dependency tree now resolves naturally to safe versions:

| Override               | Previously forced | Reason for removal                                                                                  |
| ---------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `glob`                 | `^13.0.0`         | All consumers (jest, rimraf, typeorm, @nestjs/cli, ts-jest) resolve naturally to `13.x`             |
| `test-exclude`         | `^8.0.0`          | Resolves naturally to `8.0.0` via `babel-plugin-istanbul`                                           |
| `brace-expansion`      | `^5.0.5`          | Resolves naturally to `5.0.5` via `minimatch` across the tree; `npm audit` clean without it         |
| `fast-xml-parser`      | `^5.5.6`          | `@aws-sdk/xml-builder` now resolves naturally to `5.5.9`                                            |
| `mjml`                 | `^5.0.0-beta.1`   | `@nestjs-modules/mailer` now pulls `mjml@5.0.0-beta.2` directly                                     |
| `serialize-javascript` | `^7.0.5`          | No longer installed anywhere in the dependency tree (`terser-webpack-plugin` no longer requires it) |

Overrides removed on **2026-05-30** and **2026-06-24** during dependency tree review:

| Override             | Previously forced | Reason for removal                                                                                                  |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `uuid`               | `^11.1.1`         | Removed as a global override once dependency updates and postinstall patch coverage made the global pin unnecessary |
| `file-type`          | `^21.3.3`         | No longer required after upstream package updates and lockfile refresh; audit stays clean without it                |
| `path-to-regexp`     | `^8.3.1`          | No longer required after upstream dependency updates; audit stays clean without it                                  |
| `preview-email.uuid` | `^11.1.1`         | Removed from overrides; nested copy remains covered by postinstall patch until upstream chain resolves natively     |

#### `mjml-core` — no override available (known vulnerability, no upstream fix)

- **Vulnerability**: [SNYK-JS-MJMLCORE-14417285](https://security.snyk.io/vuln/SNYK-JS-MJMLCORE-14417285) / CVE-2025-67898 — Directory Traversal via the `ignoreIncludes` parameter in `mjml-core`. CVSS Medium. **Fixed in: Not Fixed** (as of 2026-04-04).
- **Root cause**: `@nestjs-modules/mailer` depends on `mjml`, which pulls in `mjml-core@5.0.0-beta.2`. No patched release exists in any branch.
- **Risk assessment**: Exploitation requires an attacker to supply crafted input to the `ignoreIncludes` parameter. This project only processes internally authored email templates; no user-controlled content is passed to mjml. Practical exploitation risk is **low**.
- **No override action**: A version override cannot help because there is no patched release. `npm audit` does not flag this advisory (it is Snyk-specific).

**When it can be remediated**: When a patched `mjml-core` release is published. Monitor [CVE-2025-67898](https://www.cve.org/CVERecord?id=CVE-2025-67898) and the [mjml changelog](https://github.com/mjmlio/mjml/blob/master/CHANGELOG.md) for a fix. Verify with:

```sh
npm view mjml-core@latest version
```

---

### Postinstall Patch (`scripts/patch-nested-packages.js`)

This script runs automatically after every `npm install` and `npm ci` via the `postinstall` hook.

**Why it exists**: npm 11.x has a bug where nested overrides (e.g. `"A": { "B": "^x.y.z" }`) are not applied when package `B` is also a direct top-level dependency. In these cases, npm installs the older nested version even though the override is declared. The script works around this by:

1. Detecting any nested package install that is behind the required version.
2. Replacing it in `node_modules` by copying the safe top-level version.
3. Updating `package-lock.json` so that `npm audit` reports the correct version.

**Adding a new patch entry**: Edit the `patches` array in `scripts/patch-nested-packages.js`:

```js
const patches = [
  // [ 'path/within/node_modules/to/nested/package', 'top-level-package-name' ]
  ['@nestjs/platform-express/node_modules/multer', 'multer'],
  ['mailparser/node_modules/nodemailer', 'nodemailer'],
  ['preview-email/node_modules/nodemailer', 'nodemailer'],
];
```

**Removing a patch entry**: When the upstream package fixes its own dependency so the nested install no longer appears (or already uses the safe version), remove the corresponding entry from the `patches` array. Also remove the matching nested override from `package.json` if it is no longer needed.

#### `nodemailer` (nested under `mailparser` / `preview-email`)

- **Vulnerability**: [GHSA-c7w3-x93f-qmm8](https://github.com/advisories/GHSA-c7w3-x93f-qmm8) — SMTP command injection via unsanitised `envelope.size` parameter in `nodemailer < 8.0.4`. Severity: Low.
- **Root cause**: `mailparser` and `preview-email` can install nested `nodemailer` versions behind the secure top-level dependency. npm 11.x nested-override behavior can leave those copies in place.
- **Patch**: `['mailparser/node_modules/nodemailer', 'nodemailer']` and `['preview-email/node_modules/nodemailer', 'nodemailer']` copy the safe top-level `nodemailer` into nested installs after every `npm install` / `npm ci`.

**Status (2026-09-03)**: The `mailparser` override has been removed. `preview-email@3.4.0` now resolves `mailparser@3.9.17` and `nodemailer@9.1.1` natively, and `npm ls nodemailer` shows a single hoisted copy — so both entries are no-ops, kept as a safety net against future re-resolution.

**When it can be removed**: When `mailparser` and `preview-email` both resolve patched `nodemailer` natively and nested vulnerable copies are no longer installed. Verify with:

```sh
npm view mailparser@latest dependencies.nodemailer
npm view preview-email@latest dependencies.nodemailer
```

#### `uuid` (nested under `preview-email`) — removed 2026-08-31

- **Vulnerability**: [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — Missing buffer bounds check in UUID v3/v5/v6 when `buf` is provided (`uuid < 11.1.1`). Severity: Moderate.
- **Previous patch**: `['preview-email/node_modules/uuid', 'uuid']` copied the safe top-level `uuid` into nested preview-email installs.
- **Removed**: `preview-email@3.4.0` no longer installs a nested `uuid`. The tree has a single `uuid@14.0.2`. Restore the patch if `npm ls uuid` shows a nested copy below `11.1.1` again.

## CORS Configuration

### Purpose

CORS (Cross-Origin Resource Sharing) controls which domains can make requests to the backend API from browsers.

### Configuration Location

CORS is configured in `src/main.ts`.

### Development CORS Settings

**Allowed Origins:**

```typescript
origin: [
  'http://localhost:4200', // Local frontend dev server
  'https://dev.startrekonline.info', // Development frontend
];
```

**Development Environment:**

- `NODE_ENV=dev`
- CORS allows both localhost and dev subdomain
- Credentials: `true` (allows cookies/auth headers)

> TODO: Confirm the full list of allowed origins for dev (including any additional hostnames like preview/staging/admin tools).

### Production CORS Settings

**Allowed Origins:**

```typescript
origin: [
  'https://startrekonline.info', // Production frontend
];
```

**Production Environment:**

- `NODE_ENV=prod`
- CORS restricted to production domains only
- Credentials: `true`

> TODO: Confirm the production allowed origins list (and whether `www.` or additional subdomains should be included).

### CORS Headers

**Allowed Headers:**

- `Origin`
- `X-Requested-With`
- `Content-Type`
- `Accept`
- `Authorization`

### Troubleshooting CORS Errors

**Error:** "No 'Access-Control-Allow-Origin' header is present"

**Causes:**

1. Frontend origin not in allowed origins list
2. Request blocked by browser preflight/CORS negotiation
3. Preflight OPTIONS request failing

**Solutions:**

1. Add frontend origin to CORS configuration
2. Ensure the request includes the required headers (for example `Authorization`) and uses an allowed method/header set
3. Check backend logs for OPTIONS request failures

Note: The backend currently uses bearer tokens (the `Authorization` header). Cookie-based auth is not currently used; only enable `withCredentials` client-side if you intentionally introduce cookie-based authentication.

**Testing:**

- Use browser DevTools Network tab to inspect CORS headers
- Check `Access-Control-Allow-Origin` in response headers
- Verify `Origin` in request headers matches allowed list

## File Upload Security

### Allowed MIME Types

**Permitted:**

- `image/png`
- `image/jpg`
- `image/jpeg`

### Why Block SVG?

**Security Risk:**

SVG files can contain embedded JavaScript, making them a vector for:

- Cross-Site Scripting (XSS) attacks
- Malware injection
- Social engineering attacks

**Recommendation:**

Always block SVG uploads unless you have a specific need and implement SVG sanitisation.

### File Upload Size Limits

**Maximum File Size:** Controlled by `MAX_IMAGE_SIZE_IN_BYTES` (defaults to 10 MB if not set)

**Rationale:**

**Rationale:**

- Prevents excessive storage usage
- Limits impact of denial-of-service attacks
- Ensures reasonable upload times for users
- Aligned with Cloudflare Images size limits

**Enforcement:**

- Frontend validation (immediate user feedback)
- Backend Multer validation (defence in depth)
- Both should use the same limit for consistency

### File Upload Validation

**Defence in Depth:**

1. **Frontend Validation**: Check MIME type and size before upload
2. **Backend Validation**: Multer checks MIME type and size
3. **Virus scanning**: Uploads are scanned via Cloudmersive before being stored

**Magic Bytes Validation:**

Consider checking file magic bytes (file signature) to verify file type independently of MIME type and extension (prevents type spoofing).

> TODO: Decide whether to implement magic-bytes validation (and document the chosen approach/library if implemented).

### MIME Type Constants

**Centralised Constants:**

File upload limits and allowed MIME types are defined in:

```
src/shared/constants/file-upload.constants.ts
```

**Benefits:**

- Single source of truth
- Easy to update across all upload endpoints
- Consistent validation rules

## Password Security

### Hashing Algorithm

**Bcrypt:**

- Industry-standard password hashing
- Computationally expensive (resists brute force)
- Salted automatically (prevents rainbow table attacks)

**Salt Rounds:**

- Document current salt rounds (typically 10-12)

> TODO: Set and document the actual `AUTH_SALT_ROUNDS` used in each environment.

- Higher rounds = more secure but slower
- Balance security with performance

**Never Store Plaintext:**

- Passwords are always hashed before storage
- Even admins cannot retrieve plaintext passwords
- Password reset required if user forgets password

### Password Requirements

**Policy:**

- Minimum 8 characters.
- Must include uppercase, lowercase, numbers, and symbols.
- Enforced via `class-validator` `IsStrongPassword` on registration and reset DTOs.

## JWT Security

### JWT Secret

JWT signing secrets are loaded from AWS Secrets Manager via `SecretsService`.

**Requirements:**

- Long random string (at least 256 bits)
- Rotate on suspected compromise
- Never commit to version control

### JWT Secret Rotation

**Current Policy:**

> **Policy:** JWT secrets are rotated every 180 days or immediately upon suspected compromise. Rotation is owned by the Lead Developer.

**Rotation Process:**

1. Generate new secret
2. Update the AWS Secrets Manager secret value (`jwtSecret`)
3. Redeploy the backend so it picks up the updated secret
4. All existing tokens become invalid (users forced to re-login)
5. Consider grace period with dual-secret validation for smooth transition

### Token Expiry

**Expiry Duration:**

Document current token expiry (e.g., 1 hour, 24 hours).

> TODO: Record the current `AUTH_TOKEN_EXPIRES_IN` and `AUTH_REFRESH_TOKEN_EXPIRES_IN` values used in prod.

**Security Considerations:**

- Shorter expiry = more secure (limits window for token theft)
- Longer expiry = better UX (less frequent logins)
- Implement refresh tokens for long-lived sessions without compromising security

## Rate Limiting

### Global Rate Limits

**Configuration:**

- Implemented via `express-rate-limit` in `src/main.ts`
- Standard window length is 15 minutes
- GET/HEAD (read): 1500 per window (only failed requests are counted)
- POST/PUT/PATCH/DELETE (write): 200 per window
- Rate limit state is stored in **Redis** to ensure scalability and prevent memory leaks.
- Each rate limiting category (Read, Write, Auth, Expensive) uses a dedicated RedisStore instance with its own key prefix (e.g., `rl:read:`, `rl:auth:`).

**Purpose:**

- Prevent brute force attacks (login, password reset)
- Mitigate denial-of-service attacks
- Protect server resources

### Endpoint-Specific Rate Limits

**Login Endpoint:**

- Auth endpoints are rate limited as a group: 20 per 15 minutes
- Auth endpoints include `/auth/login`, `/auth/register`, `/auth/refresh`, and password reset flows

**File Upload Endpoints:**

- Upload/search endpoints are rate limited as a group: 50 per 15 minutes

### Rate Limit Bypass

**Considerations:**

- Authenticated users might have higher limits
- Trusted IPs (e.g., internal services) might bypass limits
- **Automated Bots**: Known CI runners (e.g., GitHub Actions) can bypass certain WAF and rate limiting blocks by providing a custom `User-Agent: Mozilla/5.0`. This is used for automated health and version checks.

> TODO: Document any additional rate-limit bypass rules (trusted IPs, admin tooling) and where they are configured (Cloudflare vs backend).

## Proxy, client IP, and IPv6

- The backend runs behind Cloudflare; `req.ip` will reflect Cloudflare unless proxy trust is configured
- The backend sets Express `trust proxy` to `TRUST_PROXY_HOPS` when not running in `local`
- Client IP is derived in this order: `CF-Connecting-IP`, first `X-Forwarded-For`, then `req.ip`
- IPv6-mapped IPv4 values like `::ffff:192.0.2.1` are normalised to IPv4

## Compliance & OpenSSF Best Practices

The project maintains an **OpenSSF Best Practices Badge**. This documentation serves as the base for our **Assurance Case** (Silver/Gold requirement).

### Secrets Management Policy (Silver/Gold)

1. **Storage**: All production secrets (database credentials, API keys, signing secrets) MUST be stored in **AWS Secrets Manager**.
2. **Access Control**: Runtime access is provided via IAM roles with least-privilege policies. Only the `SecretsService` should interface with the secret store.
3. **No Hardcoding**: Secrets or credentials MUST NEVER be committed to version control. This is enforced via automated CI checks and `.env.example` templates.
4. **Rotation**:
   - **JWT Secrets**: Rotated every 180 days.
   - **API Keys**: Rotated annually or following a leaver event with access.
   - **HMAC Service Keys**: Rotated only if compromised (see note on data migration in `Email address hashing`).
5. **Incidents**: Upon suspected compromise, secrets are revoked in the provider (e.g., Cloudflare, AWS) and updated in Secrets Manager immediately.

### Cryptography (Silver/Gold Standard)

The project adheres to the following cryptographic standards:

- **Algorithms**: Only industry-standard, non-deprecated algorithms are used.
  - **Password Hashing**: `Bcrypt` (with adaptive cost).
  - **PII Hashing**: `HMAC-SHA256` (SHA-256 remains secure for the foreseeable future).
  - **Digital Signatures**: `RS256` or `HS256` for JWTs.
- **Implementations**: No custom cryptography. We use the Node.js native `crypto` module, `bcrypt`, and `jsonwebtoken`.
- **Key Lengths**:
  - HMAC keys must be at least 32-64 random bytes.
  - JWT keys must be at least 256-bit entropy.
- **Entropy**: All random values (tokens, secrets) are generated using cryptographically secure PRNGs (`crypto.randomBytes`).

### Coding Standards & Quality

- **Static Analysis**: Automated linting (`eslint`) and type-checking (`tsc`) run on every PR.
- **Dependency Scanning**: `npm audit` is a blocking step in CI (`npm run verify`).
- **DCO (Developer Certificate of Origin)**: All commits must be signed-off (`Signed-off-by`) to ensure clear chain of ownership and licensing.

## Proxy, client IP, and IPv6

### Audit tables

| Table                  | PII stored                                  | Retention                                                                                                                                                              |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_audit`               | `ipAddress` (nullable), `userId`            | `ipAddress` nulled after `AUDIT_IP_NUKE_THRESHOLD_DAYS`; records deleted after `AUDIT_DATA_NUKE_THRESHOLD_DAYS`                                                        |
| `_audit_login_attempt` | `email` (nullable), `ipAddress` (nullable)  | Same as above                                                                                                                                                          |
| `_audit_ses_event`     | `emailHashed` (HMAC-SHA256 — not plaintext) | Non-suppressing records deleted after `SES_AUDIT_RETENTION_DAYS` (180 days); suppression records deleted after `SES_SUPPRESSION_RETENTION_DAYS` (2557 days / ~7 years) |
| `contact_request`      | `emailMasked` (nullable)                    | Email nulled after `CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS`; records deleted after `CONTACT_REQUEST_RECORD_RETENTION_DAYS`                                          |

- A daily cron job (UTC, 03:26 and 00:00) runs all retention cleanup jobs in sequence.
- A failed individual job is logged and swallowed so the others continue.

## Email Delivery Security

### SES Webhook (`POST /webhooks/ses`)

The endpoint receives SNS HTTP notifications containing SES bounce, complaint, and delivery events.

**TopicArn validation:**

Every incoming notification is validated against `AWS_SNS_TOPIC_ARN`. Requests with a non-matching `TopicArn` are rejected with `403 Forbidden`. This prevents spoofed SNS notifications from arbitrary topics being processed as legitimate SES events.

**Idempotency:**

SNS guarantees at-least-once delivery. The `snsMessageId` field is stored with a `UNIQUE` constraint. Duplicate deliveries of the same message are silently skipped before any write is attempted.

### Email address hashing

Email addresses received via SES bounce/complaint/delivery events are **never stored in plaintext**. Before any database write the address is passed through:

```
HMAC-SHA256(key = SES_EMAIL_HMAC_SECRET, data = email.toLowerCase())
```

The resulting 64-character hex digest (`emailHashed`) is stored instead. This means:

- The database contains no reversible PII, even if it is exfiltrated.
- Suppression lookups are O(1) index scans (deterministic output per address + key pair).
- Rainbow tables cannot be used without the secret key.

**Key rotation warning:** Changing `SES_EMAIL_HMAC_SECRET` invalidates all existing suppression records because the stored hashes will no longer match re-hashed lookups. If rotation is required, plan a migration to rehash existing rows with the new key before cutting over.

### Monitoring Rate Limits

**429 Errors:**

- Log all rate limit violations with client IP
- Monitor for patterns (DDoS attacks, misconfigured clients)
- Adjust limits if legitimate traffic is being blocked

## Logging Sensitive Data

### Never Log:

- **Passwords**: Plaintext or hashed
- **JWT Tokens**: Full token strings
- **API Keys/Secrets**: Cloudflare tokens, R2 credentials
- **Credit Card Numbers**: If payment processing added
- **Personal Identification Numbers**: Social security, passport, etc.

### What to Log:

- User IDs (not names or emails in high-volume logs)
- Request paths and methods
- Error messages and stack traces
- Client IPs (from `CF-Connecting-IP`)
- Rate limit violations
- Authentication failures (without password values)

### Log Levels and Security

**Production (`LOG_LEVEL=warn`):**

- Reduces log volume
- Minimises risk of sensitive data in logs
- Still captures errors and warnings

**Development (`LOG_LEVEL=debug`):**

- More verbose for debugging
- May include more request details
- Never use in production

## API Key Management

### Cloudflare API Token

**Permissions:**

- Cloudflare Images: Read/Write
- R2 Storage: Read/Write
- Minimum required permissions only

**Security:**

- Store in environment variables, never in code
- Rotate periodically (e.g., every 6 months)
- Revoke immediately if compromised

### R2 Access Credentials

**Access Key ID and Secret:**

- S3-compatible credentials
- Store in environment variables
- Rotate periodically

**Least Privilege:**

- Credentials should only have access to specific bucket
- Read/write only, no delete if possible (or isolate delete permissions)

## HTTP Security Headers

### Helmet Middleware

**Applied in `main.ts`:**

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` or `SAMEORIGIN`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=...` (HSTS)

**Purpose:**

- Prevent MIME type sniffing attacks
- Prevent clickjacking
- Enable browser XSS filters
- Enforce HTTPS

### Content Security Policy (CSP)

**Current Status**:
Implemented in `src/main.ts` using a per-request `nonce` provided by `NonceMiddleware`.

- **Policy**: `default-src 'none'; frame-ancestors 'none'; style-src 'self'; img-src 'self'; script-src 'self' 'nonce-{{nonce}}';`
- **Swagger Exception**: A relaxed policy is applied to the `/swagger` endpoint in development to allow styles/fonts required for documentation.

### HSTS (Strict-Transport-Security)

- **Status**: Enabled via Helmet.
- **Policy**: Enforces HTTPS for all sessions. Cloudflare also enforces a "Always Use HTTPS" rule at the edge.

### Software Supply Chain (OpenSSF Gold)

- **Reproducible Builds**: The project uses `package-lock.json` to ensure deterministic builds. CI builds use `npm ci` to guarantee that the exact same dependency tree is used in every environment.
- **Two-Factor Authentication (2FA)**: 2FA is REQUIRED for all developers with merge access to the GitHub repository and access to the AWS Console.
- **Code Review**: All modifications must be submitted via Pull Requests and undergo review by at least one other contributor before merging.

## Security Considerations

### Attack Vectors Addressed

- **SQL Injection**: TypeORM parameterised queries
- **XSS**: Input sanitisation, CSP headers, no SVG uploads
- **CSRF**: Token-based if using cookies (check implementation)
- **Brute Force**: Rate limiting on login endpoints
- **DDoS**: Cloudflare edge protection + backend rate limiting
- **File Upload Attacks**: MIME type validation, size limits, SVG blocking
- **Spoofed SNS Notifications**: `TopicArn` validation on `POST /webhooks/ses`
- **Email PII Exposure**: HMAC-SHA256 hashing of all email addresses in `_audit_ses_event`
- **Credential Storage**: Use of AWS Secrets Manager avoids environment variable leakage on logs or child processes (OpenSSF Silver requirement).

### Known Security Considerations

**Document any known security limitations or areas for improvement:**

- Token refresh strategy (if not implemented, plan to implement)
- Two-factor authentication (if not implemented, consider for future)
- Audit logging (track sensitive operations for security review)
- Dependency vulnerability scanning (npm audit, Dependabot)
