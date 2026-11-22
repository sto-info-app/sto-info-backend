import { requireSecretKeys } from './require-secret-keys';

describe('requireSecretKeys', () => {
  const keys = ['accessKey', 'secretKey'] as const;

  it('should return the requested values', () => {
    expect(
      requireSecretKeys(
        { accessKey: 'id', secretKey: 'shh', unrelated: 1 },
        keys,
        'test',
      ),
    ).toEqual({ accessKey: 'id', secretKey: 'shh' });
  });

  it('should name every missing key, and what they are for', () => {
    expect(() => requireSecretKeys({}, keys, 'quarantine')).toThrow(
      'Missing quarantine secret keys: accessKey, secretKey.',
    );
  });

  it('should name only the keys that are missing', () => {
    expect(() =>
      requireSecretKeys({ accessKey: 'id' }, keys, 'exports'),
    ).toThrow('Missing exports secret keys: secretKey.');
  });

  // An empty value builds a client exactly as useless as an absent one.
  it.each([
    ['blank', '   '],
    ['empty', ''],
    ['not a string', 42],
    ['null', null],
  ])('should treat a %s value as missing', (_label, value) => {
    expect(() =>
      requireSecretKeys({ accessKey: 'id', secretKey: value }, keys, 'test'),
    ).toThrow('Missing test secret keys: secretKey.');
  });

  it('should refuse when there is no secret at all', () => {
    expect(() => requireSecretKeys(undefined, keys, 'test')).toThrow(
      'Missing test secret keys: accessKey, secretKey.',
    );
  });
});
