import { Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC_TEMPLATES_DIR = path.resolve(
  process.cwd(),
  'src',
  'views',
  'email-templates',
);

// IMPORTANT: copy next to compiled main.js (dist/src)
const DIST_TEMPLATES_DIR = path.resolve(
  process.cwd(),
  'dist',
  'src',
  'views',
  'email-templates',
);

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

if (!fs.existsSync(SRC_TEMPLATES_DIR)) {
  throw new Error(`Email templates source not found: ${SRC_TEMPLATES_DIR}`);
}

copyRecursive(SRC_TEMPLATES_DIR, DIST_TEMPLATES_DIR);
const logger = new Logger('CopyEmailTemplates');
logger.log('Email templates copied to dist folder');
