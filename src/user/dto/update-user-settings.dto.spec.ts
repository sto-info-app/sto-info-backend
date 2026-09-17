import { validateDto } from '../../utils/testing/dto-validation.util';
import { PresenceVisibility } from '../enums/presence-visibility.enum';
import { UpdateUserSettingsDto } from './update-user-settings.dto';

/**
 * FC-006's first and fourth acceptance criteria meet at this boundary: an
 * export zone that is a canonical IANA identifier, and settings that cannot be
 * pushed past what the published policy allows.
 *
 * The timezone cases are the ones worth having. A rejected abbreviation is the
 * difference between a date that can be converted back to the moment its author
 * meant and one that cannot, because `GMT` and `BST` name the same place at
 * different times of year.
 */
describe('UpdateUserSettingsDto', () => {
  const errorsFor = async (payload: Record<string, unknown>) =>
    (await validateDto(UpdateUserSettingsDto, payload)).errors;

  const propertiesInError = async (payload: Record<string, unknown>) =>
    (await errorsFor(payload)).map(error => error.property);

  it('accepts a payload carrying only privacy mode', async () => {
    expect(await errorsFor({ privacyMode: true })).toHaveLength(0);
  });

  it('requires privacy mode', async () => {
    expect(await propertiesInError({})).toContain('privacyMode');
  });

  it('accepts the full settings surface', async () => {
    expect(
      await errorsFor({
        privacyMode: false,
        sessionTimeoutMinutes: 480,
        displayTimezone: 'Europe/London',
        stoExportTimezone: 'America/New_York',
        presenceVisibility: PresenceVisibility.EVERYONE,
        appearOffline: true,
        typingIndicatorsEnabled: true,
        notifyMention: false,
        notifyReply: false,
        notifyDirectMessage: false,
        notifyRosterAssociation: false,
        notifyEventReminder: false,
      }),
    ).toHaveLength(0);
  });

  describe('timezones', () => {
    it.each(['displayTimezone', 'stoExportTimezone'])(
      'accepts an IANA identifier for %s',
      async field => {
        expect(
          await errorsFor({ privacyMode: false, [field]: 'Pacific/Auckland' }),
        ).toHaveLength(0);
      },
    );

    it.each(['displayTimezone', 'stoExportTimezone'])(
      'accepts UTC itself for %s',
      async field => {
        expect(
          await errorsFor({ privacyMode: false, [field]: 'UTC' }),
        ).toHaveLength(0);
      },
    );

    /**
     * Null is a real answer, not an omission: it returns the display zone to
     * following the viewer's device and the export zone to unset, so a user can
     * undo a choice rather than only ever replace it.
     */
    it.each(['displayTimezone', 'stoExportTimezone'])(
      'accepts null to clear %s',
      async field => {
        expect(
          await errorsFor({ privacyMode: false, [field]: null }),
        ).toHaveLength(0);
      },
    );

    it.each([
      ['BST', 'displayTimezone'],
      ['GMT', 'displayTimezone'],
      ['EST', 'stoExportTimezone'],
      ['Europe/Nowhere', 'stoExportTimezone'],
      ['+01:00', 'stoExportTimezone'],
      ['', 'displayTimezone'],
    ])('rejects %s for %s', async (value, field) => {
      expect(
        await propertiesInError({ privacyMode: false, [field]: value }),
      ).toContain(field);
    });

    it('explains why an abbreviation is refused', async () => {
      const [error] = await errorsFor({
        privacyMode: false,
        stoExportTimezone: 'BST',
      });

      expect(Object.values(error.constraints ?? {}).join(' ')).toContain(
        'they do not say whether summer time applies',
      );
    });
  });

  describe('session timeout', () => {
    it.each([60, 240, 480])('accepts the offered window of %s', async value => {
      expect(
        await errorsFor({ privacyMode: false, sessionTimeoutMinutes: value }),
      ).toHaveLength(0);
    });

    /**
     * The fourth acceptance criterion in its smallest form: a number outside
     * the published options is refused rather than stored, so a client cannot
     * grant itself a longer session than the site offers.
     */
    it.each([0, 30, 120, 1440, -60])(
      'rejects %s as a session window',
      async value => {
        expect(
          await propertiesInError({
            privacyMode: false,
            sessionTimeoutMinutes: value,
          }),
        ).toContain('sessionTimeoutMinutes');
      },
    );
  });

  describe('presence', () => {
    it.each(Object.values(PresenceVisibility))('accepts %s', async value => {
      expect(
        await errorsFor({ privacyMode: false, presenceVisibility: value }),
      ).toHaveLength(0);
    });

    /**
     * Hiding is a separate switch rather than a fourth audience, so that going
     * invisible for an afternoon does not overwrite the audience the user
     * chose. A client sending `HIDDEN` is using an older model and must be told
     * so rather than quietly given the default.
     */
    it('rejects HIDDEN as an audience', async () => {
      expect(
        await propertiesInError({
          privacyMode: false,
          presenceVisibility: 'HIDDEN',
        }),
      ).toContain('presenceVisibility');
    });
  });

  /**
   * Whitelisting is what stops a client writing a column the settings page does
   * not own. Without it, a payload naming `userId` would be carried into the
   * update and reach the repository.
   */
  it('refuses a property the settings page does not own', async () => {
    expect(
      await propertiesInError({ privacyMode: false, userId: 'someone-else' }),
    ).toContain('userId');
  });
});
