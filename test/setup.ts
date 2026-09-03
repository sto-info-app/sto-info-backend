import { ConsoleLogger, Logger } from '@nestjs/common';
import { TestingModuleBuilder } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';

import { afterEach, jest } from '@jest/globals';

/**
 * Global NestJS Logger configuration for tests.
 * This silences the framework's internal logs globally.
 *
 * We reassign the prototype methods to silent jest mocks.
 * This allows individual tests to still use jest.spyOn() to verify log calls,
 * but when those spies are restored, they revert to these silent mocks
 * instead of the original console-printing methods.
 */

const silentMock = () => jest.fn().mockImplementation(() => {});

// Disable standard NestJS logging
Logger.overrideLogger(false);

// Silent prototypes for Logger
Logger.prototype.log = silentMock();
Logger.prototype.error = silentMock();
Logger.prototype.warn = silentMock();
Logger.prototype.debug = silentMock();
Logger.prototype.verbose = silentMock();
Logger.prototype.fatal = silentMock();

// Silent prototypes for ConsoleLogger (the actual printer)
ConsoleLogger.prototype.log = silentMock();
ConsoleLogger.prototype.error = silentMock();
ConsoleLogger.prototype.warn = silentMock();
ConsoleLogger.prototype.debug = silentMock();
ConsoleLogger.prototype.verbose = silentMock();
ConsoleLogger.prototype.fatal = silentMock();

// Silent static methods on Logger
(Logger as any).log = silentMock();
(Logger as any).error = silentMock();
(Logger as any).warn = silentMock();
(Logger as any).debug = silentMock();
(Logger as any).verbose = silentMock();
(Logger as any).fatal = silentMock();

/**
 * Auto-close every TestingModule after the test that created it.
 *
 * Almost none of the specs in this project call `module.close()` themselves.
 * An unclosed TestingModule keeps its whole DI container alive, including
 * anything registered via @Cron/@Interval (cron, launcher, platform,
 * storytime-chapter-scheduler, user-refresh-token) whose real timers and
 * handles never get torn down — real leaks worth fixing, though profiling
 * (see stryker.config.mjs) found the OOM warnings during mutation testing
 * were actually caused by Jest itself, which retains reporting data for
 * every test run for the life of the process. Patching the builder here
 * fixes this for every spec without editing all of them.
 */
const openTestingModules = new Set<TestingModule>();
const originalCompile = TestingModuleBuilder.prototype.compile;

TestingModuleBuilder.prototype.compile = async function (
  ...args: Parameters<typeof originalCompile>
) {
  const module = await originalCompile.apply(this, args);
  openTestingModules.add(module);
  return module;
};

afterEach(async () => {
  const modules = Array.from(openTestingModules);
  openTestingModules.clear();
  await Promise.all(modules.map(module => module.close().catch(() => {})));
});
