import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { SecretsService } from 'src/shared/secrets/secrets.service';

import { NotificationEmailType } from './notification-email-type.enum';

/** What an unsubscribe link says. */
export interface UnsubscribeClaim {
  /** Whose emails. */
  readonly userId: string;
  /** Which types to turn off. */
  readonly types: readonly NotificationEmailType[];
}

/** Keeps this key apart from every other use of the JWT secret. */
const KEY_PURPOSE = 'sc-1067 notification email unsubscribe';

const TYPES = new Set<string>(Object.values(NotificationEmailType));

/**
 * Signs and checks the one-click unsubscribe links in notification emails
 * (sc-1067).
 *
 * A link names the person and the types it turns off, signed with a key
 * derived from the JWT secret, so it needs no sign-in and cannot be altered
 * to switch off anybody else's emails. It does not expire: an old email's
 * link should still work, and all it can do is switch emails off. Rotating
 * the JWT secret retires every link, which is safe.
 */
@Injectable()
export class EmailUnsubscribeTokenService implements OnModuleInit {
  private readonly _logger = new Logger(EmailUnsubscribeTokenService.name);
  private _key: Buffer | null = null;

  /**
   * Creates an instance of EmailUnsubscribeTokenService.
   *
   * @param _secrets - The application's secrets.
   */
  constructor(private readonly _secrets: SecretsService) {}

  /**
   * Derives the signing key.
   */
  async onModuleInit(): Promise<void> {
    const secret = (await this._secrets.getSecret(
      process.env.AWS_SECRET_NAME!,
    )) as { jwtSecret?: unknown } | undefined;
    const jwtSecret = secret?.jwtSecret;

    if (typeof jwtSecret === 'string' && jwtSecret !== '') {
      this._key = createHmac('sha256', jwtSecret).update(KEY_PURPOSE).digest();
    } else {
      this._logger.warn(
        '[onModuleInit] jwtSecret is not set: unsubscribe links cannot be signed.',
      );
    }
  }

  /**
   * Signs a link's claim.
   *
   * @param claim - Whose emails, and which.
   * @returns The token, or null without a key.
   */
  sign(claim: UnsubscribeClaim): string | null {
    if (this._key === null) {
      return null;
    }

    const payload = Buffer.from(
      JSON.stringify({ u: claim.userId, t: claim.types }),
    ).toString('base64url');

    return `${payload}.${this.mac(payload).toString('base64url')}`;
  }

  /**
   * Checks a token and reads its claim.
   *
   * @param token - The token from a link.
   * @returns The claim, or null when it is not one this service signed.
   */
  verify(token: string | undefined | null): UnsubscribeClaim | null {
    if (this._key === null || typeof token !== 'string') {
      return null;
    }

    const [payload, signature, ...rest] = token.split('.');

    if (!payload || !signature || rest.length > 0) {
      return null;
    }

    const expected = this.mac(payload);
    const given = Buffer.from(signature, 'base64url');

    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return null;
    }

    return this.parse(payload);
  }

  /**
   * Reads a signed payload.
   *
   * @param payload - The payload, already checked.
   * @returns The claim, or null when it is malformed.
   */
  private parse(payload: string): UnsubscribeClaim | null {
    try {
      const { u, t } = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as { u?: unknown; t?: unknown };

      const types = Array.isArray(t) ? t : [];

      if (
        typeof u !== 'string' ||
        types.length === 0 ||
        !types.every(
          type =>
            typeof type === 'string' &&
            TYPES.has(type) &&
            type !== NotificationEmailType.LOGIN,
        )
      ) {
        return null;
      }

      return { userId: u, types: types as NotificationEmailType[] };
    } catch {
      return null;
    }
  }

  /**
   * The signature of a payload.
   *
   * @param payload - The payload.
   * @returns Its HMAC.
   */
  private mac(payload: string): Buffer {
    return createHmac('sha256', this._key as Buffer)
      .update(payload)
      .digest();
  }
}
