import { Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

const srcDir = path.join(__dirname, 'email-templates');
const destDir = path.join(__dirname, '../..', 'dist/email-templates');

fs.mkdirSync(destDir, { recursive: true });

fs.readdirSync(srcDir).forEach(file => {
  const srcFile = path.join(srcDir, file);
  const destFile = path.join(destDir, file);
  fs.copyFileSync(srcFile, destFile);
});

const logger = new Logger('CopyEmailTemplates');
logger.log('Email templates copied to dist folder');
