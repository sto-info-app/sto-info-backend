import { jest } from '@jest/globals';
import { ConsoleLogger, Logger } from '@nestjs/common';

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
