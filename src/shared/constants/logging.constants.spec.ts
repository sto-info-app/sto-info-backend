import {
  DEFAULT_LOG_LEVEL,
  DEFAULT_LOG_LEVELS,
  ENVIRONMENT_LOG_LEVELS,
  getLogLevelsForEnvironment,
  LOG_LEVEL_DEBUG,
  LOG_LEVEL_ERROR,
  LOG_LEVEL_LOG,
  LOG_LEVEL_VERBOSE,
  LOG_LEVEL_WARN,
  LogLevel,
  parseLogLevel,
  VALID_LOG_LEVELS,
} from './logging.constants';

describe('Logging Constants', () => {
  describe('Constants', () => {
    it('should export individual log level constants', () => {
      expect(LOG_LEVEL_ERROR).toBe('error');
      expect(LOG_LEVEL_WARN).toBe('warn');
      expect(LOG_LEVEL_LOG).toBe('log');
      expect(LOG_LEVEL_DEBUG).toBe('debug');
      expect(LOG_LEVEL_VERBOSE).toBe('verbose');
    });

    it('should have all log levels in VALID_LOG_LEVELS', () => {
      expect(VALID_LOG_LEVELS).toEqual([
        'error',
        'warn',
        'log',
        'debug',
        'verbose',
      ]);
    });

    it('should set DEFAULT_LOG_LEVEL to log', () => {
      expect(DEFAULT_LOG_LEVEL).toBe('log');
    });

    it('should set DEFAULT_LOG_LEVELS to staging config', () => {
      expect(DEFAULT_LOG_LEVELS).toBe(ENVIRONMENT_LOG_LEVELS.staging);
      expect(DEFAULT_LOG_LEVELS).toEqual(['error', 'warn', 'log']);
    });
  });

  describe('parseLogLevel', () => {
    describe('Single level (hierarchical)', () => {
      const testCases: Array<{
        input: string;
        expected: LogLevel[];
        description: string;
      }> = [
        {
          input: 'error',
          expected: ['error'],
          description: 'should return only error for error level',
        },
        {
          input: 'warn',
          expected: ['error', 'warn'],
          description: 'should return error and warn for warn level',
        },
        {
          input: 'log',
          expected: ['error', 'warn', 'log'],
          description: 'should return up to log for log level',
        },
        {
          input: 'debug',
          expected: ['error', 'warn', 'log', 'debug'],
          description: 'should return up to debug for debug level',
        },
        {
          input: 'verbose',
          expected: ['error', 'warn', 'log', 'debug', 'verbose'],
          description: 'should return all levels for verbose',
        },
      ];

      testCases.forEach(({ input, expected, description }) => {
        it(description, () => {
          expect(parseLogLevel(input)).toEqual(expected);
        });
      });
    });

    describe('Comma-separated (explicit)', () => {
      const testCases: Array<{
        input: string;
        expected: LogLevel[];
        description: string;
      }> = [
        {
          input: 'error,warn',
          expected: ['error', 'warn'],
          description: 'should return only specified levels',
        },
        {
          input: 'error,log,debug',
          expected: ['error', 'log', 'debug'],
          description: 'should skip missing levels',
        },
        {
          input: ' error , warn ',
          expected: ['error', 'warn'],
          description: 'should trim whitespace',
        },
        {
          input: 'error,invalid,warn',
          expected: ['error', 'warn'],
          description: 'should filter out invalid levels',
        },
      ];

      testCases.forEach(({ input, expected, description }) => {
        it(description, () => {
          expect(parseLogLevel(input)).toEqual(expected);
        });
      });
    });

    describe('Invalid or missing input', () => {
      it('should return DEFAULT_LOG_LEVELS for undefined', () => {
        expect(parseLogLevel(undefined)).toBe(DEFAULT_LOG_LEVELS);
      });

      it('should return DEFAULT_LOG_LEVELS for invalid level', () => {
        expect(parseLogLevel('invalid')).toBe(DEFAULT_LOG_LEVELS);
      });

      it('should return DEFAULT_LOG_LEVELS for empty comma list', () => {
        expect(parseLogLevel('invalid1,invalid2')).toBe(DEFAULT_LOG_LEVELS);
      });
    });
  });

  describe('getLogLevelsForEnvironment', () => {
    describe('With explicit LOG_LEVEL', () => {
      it('should override environment default with explicit level', () => {
        const result = getLogLevelsForEnvironment('prod', 'debug');
        expect(result).toEqual(['error', 'warn', 'log', 'debug']);
      });

      it('should use parseLogLevel for explicit level', () => {
        const result = getLogLevelsForEnvironment('local', 'error,warn');
        expect(result).toEqual(['error', 'warn']);
      });
    });

    describe('Without LOG_LEVEL (environment defaults)', () => {
      const testCases: Array<{
        env: string;
        expected: LogLevel[];
        description: string;
      }> = [
        {
          env: 'local',
          expected: ['error', 'warn', 'log', 'debug', 'verbose'],
          description: 'should use all levels for local',
        },
        {
          env: 'dev',
          expected: ['error', 'warn', 'log', 'debug'],
          description: 'should use up to debug for dev',
        },
        {
          env: 'staging',
          expected: ['error', 'warn', 'log'],
          description: 'should use up to log for staging',
        },
        {
          env: 'prod',
          expected: ['error', 'warn'],
          description: 'should use only error and warn for prod',
        },
      ];

      testCases.forEach(({ env, expected, description }) => {
        it(description, () => {
          expect(getLogLevelsForEnvironment(env)).toEqual(expected);
        });
      });

      it('should use DEFAULT_LOG_LEVELS for unknown environment', () => {
        expect(getLogLevelsForEnvironment('unknown')).toBe(DEFAULT_LOG_LEVELS);
      });

      it('should default to dev environment', () => {
        expect(getLogLevelsForEnvironment()).toEqual(
          ENVIRONMENT_LOG_LEVELS.dev,
        );
      });
    });
  });
});
