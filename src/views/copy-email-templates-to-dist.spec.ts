import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Logger } from '@nestjs/common';

import {
  copyEmailTemplates,
  copyWhenRunDirectly,
} from './copy-email-templates-to-dist';

describe('copy-email-templates-to-dist', () => {
  let root: string;
  let logSpy: jest.SpyInstance;

  const source = (...parts: string[]): string =>
    path.join(root, 'src', 'views', 'email-templates', ...parts);
  const target = (...parts: string[]): string =>
    path.join(root, 'dist', 'src', 'views', 'email-templates', ...parts);

  beforeEach(() => {
    // A throwaway project root, so nothing is ever written to the real dist.
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'email-templates-'));
    // The test setup already replaces log with a shared silent mock, which
    // spyOn hands back as it is, so its calls are cleared for each test.
    logSpy = jest.spyOn(Logger.prototype, 'log');
    logSpy.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Lays out a source folder with a file at the top and one nested. */
  const writeTemplates = (): void => {
    fs.mkdirSync(source('partials'), { recursive: true });
    fs.writeFileSync(source('welcome.ejs'), '<p>Welcome</p>');
    fs.writeFileSync(source('partials', 'footer.ejs'), '<footer></footer>');
  };

  describe('copyEmailTemplates', () => {
    it('copies every template, nested folders included, next to the compiled app', () => {
      writeTemplates();

      copyEmailTemplates(root);

      expect(fs.readFileSync(target('welcome.ejs'), 'utf8')).toBe(
        '<p>Welcome</p>',
      );
      expect(fs.readFileSync(target('partials', 'footer.ejs'), 'utf8')).toBe(
        '<footer></footer>',
      );
      expect(logSpy).toHaveBeenCalledWith(
        'Email templates copied to dist folder',
      );
    });

    it('overwrites the copies left by an earlier build', () => {
      writeTemplates();
      fs.mkdirSync(target('partials'), { recursive: true });
      fs.writeFileSync(target('welcome.ejs'), 'stale');

      copyEmailTemplates(root);

      expect(fs.readFileSync(target('welcome.ejs'), 'utf8')).toBe(
        '<p>Welcome</p>',
      );
      expect(fs.readFileSync(target('partials', 'footer.ejs'), 'utf8')).toBe(
        '<footer></footer>',
      );
    });

    it('refuses when the templates source is missing', () => {
      expect(() => copyEmailTemplates(root)).toThrow(
        `Email templates source not found: ${source()}`,
      );
      expect(fs.existsSync(target())).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('works from the current directory when no root is given', () => {
      writeTemplates();
      jest.spyOn(process, 'cwd').mockReturnValue(root);

      copyEmailTemplates();

      expect(fs.existsSync(target('welcome.ejs'))).toBe(true);
    });
  });

  describe('copyWhenRunDirectly', () => {
    const self = { id: 'self' } as NodeModule;

    it('copies when this file is the program being run', () => {
      writeTemplates();
      jest.spyOn(process, 'cwd').mockReturnValue(root);

      copyWhenRunDirectly(self, self);

      expect(fs.existsSync(target('welcome.ejs'))).toBe(true);
    });

    it('does nothing when the file is only imported', () => {
      writeTemplates();
      jest.spyOn(process, 'cwd').mockReturnValue(root);

      copyWhenRunDirectly({ id: 'other' } as NodeModule, self);
      copyWhenRunDirectly(undefined, self);

      expect(fs.existsSync(target())).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
