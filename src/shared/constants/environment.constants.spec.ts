import {
  DEMO_DATA_ENVIRONMENTS,
  isOnMachineEnvironment,
  isProductionEnvironment,
  loadsDemoData,
  NODE_ENV_DEV,
  NODE_ENV_E2E_TEST,
  NODE_ENV_LOCAL,
  NODE_ENV_PROD,
  NODE_ENV_STAGING,
  NODE_ENVIRONMENTS,
  normaliseEnvironment,
  ON_MACHINE_ENVIRONMENTS,
} from './environment.constants';

describe('Environment constants', () => {
  describe('NODE_ENVIRONMENTS', () => {
    it('lists every name in the order they are promoted through', () => {
      expect(NODE_ENVIRONMENTS).toEqual([
        'local',
        'e2etest',
        'dev',
        'staging',
        'prod',
      ]);
    });

    it('contains every member of the narrower lists', () => {
      for (const name of [
        ...ON_MACHINE_ENVIRONMENTS,
        ...DEMO_DATA_ENVIRONMENTS,
      ]) {
        expect(NODE_ENVIRONMENTS).toContain(name);
      }
    });
  });

  describe('normaliseEnvironment', () => {
    it('trims and lower-cases the value', () => {
      expect(normaliseEnvironment('  Local ')).toBe('local');
    });

    it('returns an empty string when nothing is set', () => {
      expect(normaliseEnvironment(undefined)).toBe('');
    });
  });

  describe('isOnMachineEnvironment', () => {
    it.each([NODE_ENV_LOCAL, NODE_ENV_E2E_TEST])('is true for %s', name => {
      expect(isOnMachineEnvironment(name)).toBe(true);
    });

    it.each([NODE_ENV_DEV, NODE_ENV_STAGING, NODE_ENV_PROD, undefined, 'test'])(
      'is false for %s',
      name => {
        expect(isOnMachineEnvironment(name)).toBe(false);
      },
    );

    it('ignores case and surrounding space', () => {
      expect(isOnMachineEnvironment(' E2ETEST ')).toBe(true);
    });
  });

  describe('loadsDemoData', () => {
    it.each([
      NODE_ENV_LOCAL,
      NODE_ENV_E2E_TEST,
      NODE_ENV_DEV,
      NODE_ENV_STAGING,
    ])('is true for %s', name => {
      expect(loadsDemoData(name)).toBe(true);
    });

    it.each([NODE_ENV_PROD, undefined, 'test'])('is false for %s', name => {
      expect(loadsDemoData(name)).toBe(false);
    });
  });

  describe('isProductionEnvironment', () => {
    it('is true only for prod', () => {
      expect(isProductionEnvironment('prod')).toBe(true);
      expect(isProductionEnvironment('Prod ')).toBe(true);
    });

    it.each([
      NODE_ENV_LOCAL,
      NODE_ENV_E2E_TEST,
      NODE_ENV_DEV,
      NODE_ENV_STAGING,
      undefined,
    ])('is false for %s', name => {
      expect(isProductionEnvironment(name)).toBe(false);
    });
  });
});
