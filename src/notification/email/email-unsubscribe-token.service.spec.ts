import { Logger } from '@nestjs/common';

import { SecretsService } from 'src/shared/secrets/secrets.service';

import { EmailUnsubscribeTokenService } from './email-unsubscribe-token.service';
import { NotificationEmailType } from './notification-email-type.enum';

describe('EmailUnsubscribeTokenService (sc-1067)', () => {
  const claim = {
    userId: 'user-1',
    types: [
      NotificationEmailType.STORYTIME_COMMENT,
      NotificationEmailType.FRIEND_REQUEST,
    ],
  };

  const build = async (secret: unknown) => {
    const service = new EmailUnsubscribeTokenService({
      getSecret: jest.fn(async () => secret),
    } as unknown as SecretsService);

    await service.onModuleInit();

    return service;
  };

  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  let service: EmailUnsubscribeTokenService;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = await build({ jwtSecret: 'a-secret' });
  });

  afterEach(() => jest.restoreAllMocks());

  it('reads back what it signed', () => {
    expect(service.verify(service.sign(claim))).toEqual(claim);
  });

  it('refuses a token with its claim changed', () => {
    const [, signature] = (service.sign(claim) as string).split('.');
    const forged = `${encode({ u: 'user-2', t: claim.types })}.${signature}`;

    expect(service.verify(forged)).toBeNull();
  });

  it('refuses a token signed with another key', async () => {
    const other = await build({ jwtSecret: 'another-secret' });

    expect(service.verify(other.sign(claim))).toBeNull();
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an empty token', ''],
    ['one part', 'abc'],
    ['three parts', 'a.b.c'],
    [
      'a short signature',
      `${encode({ u: 'user-1', t: ['FRIEND_REQUEST'] })}.AA`,
    ],
  ])('refuses %s', (_name, token) => {
    expect(service.verify(token as string)).toBeNull();
  });

  /**
   * Signed but malformed: only reachable with the key, but the parser must
   * still not trust it.
   */
  it.each([
    ['no user', { t: ['FRIEND_REQUEST'] }],
    ['no types', { u: 'user-1', t: [] }],
    ['types that are not a list', { u: 'user-1', t: 'FRIEND_REQUEST' }],
    ['an unknown type', { u: 'user-1', t: ['NOT_A_TYPE'] }],
    ['the login alert', { u: 'user-1', t: ['LOGIN'] }],
  ])('refuses a signed claim with %s', (_name, payload) => {
    const sign = (service as unknown as { mac(p: string): Buffer }).mac.bind(
      service,
    );
    const body = encode(payload);

    expect(
      service.verify(`${body}.${sign(body).toString('base64url')}`),
    ).toBeNull();
  });

  it('refuses a signed payload that is not JSON', () => {
    const sign = (service as unknown as { mac(p: string): Buffer }).mac.bind(
      service,
    );
    const body = Buffer.from('not json').toString('base64url');

    expect(
      service.verify(`${body}.${sign(body).toString('base64url')}`),
    ).toBeNull();
  });

  it.each([
    ['no secret', undefined],
    ['no JWT secret', {}],
    ['an empty JWT secret', { jwtSecret: '' }],
  ])('signs and accepts nothing with %s', async (_name, secret) => {
    const keyless = await build(secret);

    expect(keyless.sign(claim)).toBeNull();
    expect(keyless.verify(service.sign(claim))).toBeNull();
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });
});
