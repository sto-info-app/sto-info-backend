import * as Sentry from '@sentry/nestjs';

jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
}));

describe('Sentry Initialization', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    (Sentry.init as jest.Mock).mockClear();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should initialize Sentry if SENTRY_DSN is provided', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/123';
    process.env.NODE_ENV = 'production';
    process.env.APP_VERSION = '1.0.0';

    await jest.isolateModulesAsync(async () => {
      await import('./sentry.init');
    });

    expect(Sentry.init).toHaveBeenCalled();
  });

  it('should not initialize Sentry if SENTRY_DSN is missing', async () => {
    delete process.env.SENTRY_DSN;

    await jest.isolateModulesAsync(async () => {
      await import('./sentry.init');
    });

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('should filter health and metrics URLs in beforeSendTransaction', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/123';

    await jest.isolateModulesAsync(async () => {
      await import('./sentry.init');
    });

    expect(Sentry.init).toHaveBeenCalled();
    const initCall = (Sentry.init as jest.Mock).mock.calls[0][0];
    const beforeSendTransaction = initCall.beforeSendTransaction;

    expect(beforeSendTransaction({ request: { url: '/health' } })).toBeNull();
    expect(beforeSendTransaction({ request: { url: '/metrics' } })).toBeNull();
    expect(beforeSendTransaction({ request: { url: '/api/test' } })).toEqual({
      request: { url: '/api/test' },
    });
    expect(beforeSendTransaction({})).toEqual({});
  });

  it('should fallback to dev environment if NODE_ENV is missing', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/123';
    delete process.env.NODE_ENV;
    process.env.APP_VERSION = '1.0.0';

    await jest.isolateModulesAsync(async () => {
      await import('./sentry.init');
    });

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'dev',
      }),
    );
  });

  it('should redact sensitive headers and data in beforeSend', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/123';

    await jest.isolateModulesAsync(async () => {
      await import('./sentry.init');
    });

    const initCall = (Sentry.init as jest.Mock).mock.calls[0][0];
    const beforeSend = initCall.beforeSend;

    // Full event with everything
    let event = {
      request: {
        headers: {
          authorization: 'bearer secret',
          cookie: 'session=123',
          'set-cookie': 'session=456',
        },
        data: { password: 'secret' },
      },
    };
    let result = beforeSend(event);
    expect(result.request.headers.authorization).toBeUndefined();
    expect(result.request.data).toBeUndefined();

    // Event with request but no headers or data
    event = { request: {} } as any;
    result = beforeSend(event);
    expect(result).toEqual({ request: {} });

    // Event with request and data but no headers
    event = { request: { data: { foo: 'bar' } } } as any;
    result = beforeSend(event);
    expect(result.request.data).toBeUndefined();

    // Event with request and empty headers
    event = { request: { headers: {} } } as any;
    result = beforeSend(event);
    expect(result.request.headers).toEqual({});
  });
});
