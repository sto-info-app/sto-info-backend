import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { IsEmailSwitchesConstraint } from './is-email-switches.constraint';
import { UpdateUserSettingsDto } from './update-user-settings.dto';

describe('email switches in a settings change (sc-1067)', () => {
  const constraint = new IsEmailSwitchesConstraint();

  const errorsFor = (body: Record<string, unknown>) =>
    validateSync(
      plainToInstance(UpdateUserSettingsDto, { privacyMode: false, ...body }),
    ).map(error => error.property);

  it('accepts known types switched on or off', () => {
    expect(constraint.validate({ STORYTIME_COMMENT: true, LOGIN: false })).toBe(
      true,
    );
    expect(constraint.validate({})).toBe(true);
  });

  it.each([
    ['null', null],
    ['a list', ['LOGIN']],
    ['a string', 'LOGIN'],
    ['an unknown type', { NOT_A_TYPE: true }],
    ['a value that is not true or false', { LOGIN: 'yes' }],
  ])('refuses %s', (_name, value) => {
    expect(constraint.validate(value)).toBe(false);
  });

  it('names the property in its message', () => {
    expect(
      constraint.defaultMessage({ property: 'emailNotifications' } as never),
    ).toBe(
      'emailNotifications must map notification email types to true or false.',
    );
  });

  it('is checked on a settings change, as is the frequency', () => {
    expect(errorsFor({ emailNotifications: { FRIEND_REQUEST: true } })).toEqual(
      [],
    );
    expect(errorsFor({ emailFrequency: 'WEEKLY' })).toEqual([]);
    expect(errorsFor({ emailNotifications: { NOPE: true } })).toEqual([
      'emailNotifications',
    ]);
    expect(errorsFor({ emailFrequency: 'HOURLY' })).toEqual(['emailFrequency']);
  });
});
