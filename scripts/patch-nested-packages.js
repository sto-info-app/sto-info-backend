#!/usr/bin/env node
/**
 * Workaround for npm 11.x bug: nested overrides are not applied when the same package
 * is also a direct dependency. This script is run as a postinstall hook and patches
 * known vulnerable nested package versions.
 *
 * When the upstream packages resolve their own dependencies to safe versions, or when
 * npm fixes the nested override behaviour, the relevant entry here can be removed.
 *
 * See: https://github.com/advisories/GHSA-5528-5vmv-3xc2 (multer < 2.1.1)
 * See: https://github.com/advisories/GHSA-c7w3-x93f-qmm8 (nodemailer < 8.0.4)
 * See: https://github.com/advisories/GHSA-w5hq-g745-h8pq (uuid < 11.1.1)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

/**
 * Replaces a nested package install with the top-level version of the same package,
 * and updates package-lock.json so that npm audit reports the corrected version.
 */
function patchNestedPackage(nestedPath, topLevelName) {
  const srcDir = path.join(root, 'node_modules', ...topLevelName.split('/'));
  const dstDir = path.join(root, 'node_modules', ...nestedPath.split('/'));

  if (!fs.existsSync(dstDir)) return;

  const srcPkg = JSON.parse(
    fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8'),
  );
  const dstPkg = JSON.parse(
    fs.readFileSync(path.join(dstDir, 'package.json'), 'utf8'),
  );

  if (dstPkg.version === srcPkg.version) return;

  console.log(
    `[postinstall] Patching ${nestedPath}: ${dstPkg.version} → ${srcPkg.version}`,
  );

  fs.cpSync(srcDir, dstDir, { recursive: true, force: true });

  patchLockFile(nestedPath, topLevelName, srcPkg.version);
}

function patchLockFile(nestedPath, topLevelName, newVersion) {
  const lockPath = path.join(root, 'package-lock.json');
  if (!fs.existsSync(lockPath)) return;

  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const packages = lock.packages;

  const nestedKey = `node_modules/${nestedPath}`;
  const topKey = `node_modules/${topLevelName}`;

  if (packages[nestedKey]) {
    packages[nestedKey] = structuredClone(packages[topKey]);
  }

  // Update the parent package's recorded dependency version
  const parentKey = `node_modules/${nestedPath.split('/node_modules/').slice(0, -1).join('/node_modules/')}`;
  const packageName = topLevelName.split('/').pop();
  if (packages[parentKey]?.dependencies?.[packageName]) {
    packages[parentKey].dependencies[packageName] = newVersion;
  }

  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
}

// Patches: [ nestedInstallPath, topLevelPackageName ]
const patches = [
  ['@nestjs/platform-express/node_modules/multer', 'multer'],
  ['preview-email/node_modules/nodemailer', 'nodemailer'],
  ['preview-email/node_modules/uuid', 'uuid'],
];

for (const [nestedPath, topLevelName] of patches) {
  patchNestedPackage(nestedPath, topLevelName);
}
