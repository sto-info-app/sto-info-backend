import * as fs from 'node:fs';
import * as path from 'node:path';

import { Logger } from '@nestjs/common';

/**
 * Copies files and directories recursively.
 *
 * @param src - The src.
 * @param dest - The dest.
 */
function copyRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Copies the email templates into the build output.
 *
 * @param root - The project root. Defaults to the working directory, which is
 *   the project root whenever this runs through `npm run assets:copy`.
 * @throws Error when the templates source folder does not exist.
 */
export function copyEmailTemplates(root: string = process.cwd()): void {
  const srcTemplatesDir = path.resolve(root, 'src', 'views', 'email-templates');

  // IMPORTANT: copy next to compiled main.js (dist/src)
  const distTemplatesDir = path.resolve(
    root,
    'dist',
    'src',
    'views',
    'email-templates',
  );

  if (!fs.existsSync(srcTemplatesDir)) {
    throw new Error(`Email templates source not found: ${srcTemplatesDir}`);
  }

  copyRecursive(srcTemplatesDir, distTemplatesDir);
  const logger = new Logger('CopyEmailTemplates');
  logger.log('Email templates copied to dist folder');
}

/**
 * Copies the email templates when this file is the program being run, and
 * does nothing when it is only imported, as the spec does.
 *
 * @param entry - The module Node started with.
 * @param self - This module.
 */
export function copyWhenRunDirectly(
  entry: object | undefined,
  self: object,
): void {
  if (entry === self) {
    copyEmailTemplates();
  }
}

copyWhenRunDirectly(require.main, module);
