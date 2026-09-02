import { validate } from 'class-validator';
import { UpdateUserSettingsDto } from '../dto/update-user-settings.dto';
import {
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  MAX_SESSION_TIMEOUT_MINUTES,
  MIN_SESSION_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_OPTIONS_MINUTES,
  isAllowedSessionTimeoutMinutes,
  resolveSessionTimeoutMinutes,
} from './session-timeout.constants';

describe('session timeout constants', () => {
  /**
   * Builds a settings payload for validation.
   *
   * @param sessionTimeoutMinutes - The timeout to put on the payload, if any.
   * @returns The payload, typed as the DTO's writable shape.
   */
  const buildDto = (sessionTimeoutMinutes?: number): UpdateUserSettingsDto => {
    const dto = new UpdateUserSettingsDto() as {
      privacyMode: boolean;
      sessionTimeoutMinutes?: number;
    };
    dto.privacyMode = false;
    if (sessionTimeoutMinutes !== undefined) {
      dto.sessionTimeoutMinutes = sessionTimeoutMinutes;
    }
    return dto as UpdateUserSettingsDto;
  };

  describe('the offered options', () => {
    it('runs from the shortest to the longest', () => {
      expect(MIN_SESSION_TIMEOUT_MINUTES).toBe(60);
      expect(MAX_SESSION_TIMEOUT_MINUTES).toBe(480);
      expect([...SESSION_TIMEOUT_OPTIONS_MINUTES]).toEqual([60, 240, 480]);
    });

    it('offers the default', () => {
      expect(
        isAllowedSessionTimeoutMinutes(DEFAULT_SESSION_TIMEOUT_MINUTES),
      ).toBe(true);
    });

    it('no longer offers a full day', () => {
      expect(isAllowedSessionTimeoutMinutes(1440)).toBe(false);
    });
  });

  describe('resolveSessionTimeoutMinutes', () => {
    it('accepts an allowed stored timeout', () => {
      expect(resolveSessionTimeoutMinutes(480, 14400)).toBe(480);
    });

    it('falls back to the deployment default when nothing is stored', () => {
      expect(resolveSessionTimeoutMinutes(null, 3600)).toBe(60);
      expect(resolveSessionTimeoutMinutes(undefined, 3600)).toBe(60);
    });

    it('rejects a stored timeout above the maximum', () => {
      expect(
        resolveSessionTimeoutMinutes(MAX_SESSION_TIMEOUT_MINUTES + 1, 14400),
      ).toBe(DEFAULT_SESSION_TIMEOUT_MINUTES);
    });

    it('rejects a stored timeout that is no longer offered', () => {
      expect(resolveSessionTimeoutMinutes(1440, 14400)).toBe(
        DEFAULT_SESSION_TIMEOUT_MINUTES,
      );
    });

    it('rejects a deployment default outside the allowed options', () => {
      expect(resolveSessionTimeoutMinutes(null, 999999)).toBe(
        DEFAULT_SESSION_TIMEOUT_MINUTES,
      );
    });

    it('reads the deployment default from the environment', () => {
      const original = process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN;
      process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN = '28800';

      expect(resolveSessionTimeoutMinutes(null)).toBe(480);

      delete process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN;
      expect(resolveSessionTimeoutMinutes(null)).toBe(
        DEFAULT_SESSION_TIMEOUT_MINUTES,
      );

      process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN = original;
    });
  });

  describe('UpdateUserSettingsDto validation', () => {
    it('accepts each offered option', async () => {
      for (const option of SESSION_TIMEOUT_OPTIONS_MINUTES) {
        await expect(validate(buildDto(option))).resolves.toEqual([]);
      }
    });

    it('accepts a payload that omits the timeout', async () => {
      await expect(validate(buildDto())).resolves.toEqual([]);
    });

    it('fails for a crafted value above the maximum', async () => {
      const errors = await validate(buildDto(MAX_SESSION_TIMEOUT_MINUTES + 1));

      expect(
        errors.some(error => error.property === 'sessionTimeoutMinutes'),
      ).toBe(true);
    });

    it('fails for a value between the offered options', async () => {
      const errors = await validate(buildDto(120));

      expect(
        errors.some(error => error.property === 'sessionTimeoutMinutes'),
      ).toBe(true);
    });
  });
});
