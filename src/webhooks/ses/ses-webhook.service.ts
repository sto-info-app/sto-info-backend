import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac } from 'node:crypto';
import * as https from 'node:https';
import { Repository } from 'typeorm';
import { SecretsService } from '../../shared/secrets/secrets.service';
import {
  SesBounce,
  SesComplaint,
  SesDelivery,
  SesNotification,
  SnsEnvelope,
} from './dto/sns-notification.interfaces';
import {
  SesBounceSubType,
  SesBounceType,
  SesEventEntity,
} from './entities/ses-event.entity';

@Injectable()
export class SesWebhookService {
  private readonly logger = new Logger(SesWebhookService.name);

  constructor(
    @InjectRepository(SesEventEntity)
    private readonly sesEventRepository: Repository<SesEventEntity>,
    private readonly configService: ConfigService,
    private readonly secretsService: SecretsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Confirms an SNS HTTP subscription by performing an HTTPS GET on the
   * `SubscribeURL` provided by AWS in the `SubscriptionConfirmation` message.
   *
   * AWS requires this confirmation within 3 days of receiving the message.
   * Resolves when the GET completes successfully, or rejects on network failure.
   *
   * @param subscribeUrl - The `SubscribeURL` value from the SNS envelope.
   */
  async confirmSubscription(subscribeUrl: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(subscribeUrl);
    } catch {
      this.logger.error('Invalid SNS subscription URL format');
      return;
    }

    const host = parsed.hostname.toLowerCase();
    // Use an explicit whitelist logic that CodeQL recognizes easily.
    const isAmazonSns =
      host === 'sns.amazonaws.com' ||
      (host.endsWith('.amazonaws.com') && host.startsWith('sns.'));

    // Only allow default HTTPS port (443) to further prevent SSRF.
    const isInvalidPort = parsed.port && parsed.port !== '443';

    if (parsed.protocol !== 'https:' || !isAmazonSns || isInvalidPort) {
      this.logger.error(
        'Rejected SNS confirmation: invalid protocol, domain, or port',
      );
      return;
    }

    this.logger.log('Confirming SNS subscription via AWS endpoint');

    // Use an options object to explicitly break the data flow into vetted parts.
    const options: https.RequestOptions = {
      protocol: 'https:',
      hostname: host,
      path: parsed.pathname + parsed.search,
      port: 443,
      method: 'GET',
    };

    await new Promise<void>((resolve, reject) => {
      https
        .get(options, res => {
          this.logger.log(
            `SNS subscription confirmed. HTTP status: ${res.statusCode}`,
          );
          resolve();
        })
        .on('error', err => {
          this.logger.error('Failed to confirm SNS subscription', err.message);
          reject(err);
        });
    });
  }

  /**
   * Processes an SES event notification (Bounce, Complaint, or Delivery)
   * received from SNS.
   *
   * This method is idempotent — if an SNS message with the same `snsMessageId`
   * has already been processed, the call is silently ignored. This handles
   * SNS's at-least-once delivery guarantee.
   *
   * Email addresses are stored as HMAC-SHA256 hashes to prevent PII exposure
   * in the database even if the storage layer is compromised.
   *
   * @param snsMessageId - The `MessageId` from the SNS envelope, used as the idempotency key.
   * @param notification - The parsed SES notification object from the SNS `Message` field.
   */
  async processNotification(
    snsMessageId: string,
    notification: SesNotification,
  ): Promise<void> {
    // Idempotency: skip if this SNS message has already been processed.
    const existing = await this.sesEventRepository.findOne({
      where: { snsMessageId },
    });
    if (existing) {
      this.logger.warn(
        `Duplicate SNS message ${snsMessageId} — skipping (already persisted as event ${existing.id})`,
      );
      return;
    }

    switch (notification.notificationType) {
      case 'Bounce':
        await this.handleBounce(snsMessageId, notification);
        break;
      case 'Complaint':
        await this.handleComplaint(snsMessageId, notification);
        break;
      case 'Delivery':
        await this.handleDelivery(snsMessageId, notification);
        break;
      case 'Reject':
        await this.handleReject(snsMessageId, notification);
        break;
      default:
        this.logger.warn(
          `Unrecognised SES notification type: ${String(notification.notificationType)}`,
        );
    }
  }

  /**
   * Checks whether future emails to the given address are suppressed.
   *
   * The check is performed by hashing the email address with HMAC-SHA256 and
   * querying against stored hashes, ensuring plaintext addresses are never
   * compared or stored.
   *
   * @param email - The recipient email address to check (case-insensitive).
   * @returns `true` if at least one suppression record exists for this address; `false` otherwise.
   */
  async isSuppressed(email: string): Promise<boolean> {
    const hash = await this.hashEmail(email);
    const count = await this.sesEventRepository.count({
      where: { emailHashed: hash, suppress: true },
    });
    return count > 0;
  }

  /**
   * Validates that the `TopicArn` in an incoming SNS envelope matches the
   * expected value configured in `AWS_SNS_TOPIC_ARN`.
   *
   * This check prevents spoofed notifications from arbitrary SNS topics from
   * being processed as legitimate SES events.
   *
   * @param envelope - The parsed SNS HTTP notification envelope.
   * @returns `true` if the `TopicArn` matches the configured expected value; `false` otherwise.
   */
  validateTopicArn(envelope: SnsEnvelope): boolean {
    const expected = process.env.AWS_SNS_TOPIC_ARN;
    if (!expected) {
      this.logger.error(
        'AWS_SNS_TOPIC_ARN is not configured — cannot validate SNS message origin',
      );
      return false;
    }
    return envelope.TopicArn === expected;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Validates that the provided SubscribeURL points to an expected AWS SNS
   * endpoint and uses HTTPS. This helps prevent SSRF via a spoofed SNS message.
   *
   * @param subscribeUrl - The URL provided by AWS SNS for subscription confirmation.
   * @returns `true` if the URL is a valid AWS SNS HTTPS endpoint; `false` otherwise.
   */
  isValidSnsSubscribeUrl(subscribeUrl: string): boolean {
    try {
      const url = new URL(subscribeUrl);
      const host = url.hostname.toLowerCase();
      const isAmazonSns =
        host === 'sns.amazonaws.com' ||
        (host.endsWith('.amazonaws.com') && host.startsWith('sns.'));
      const isInvalidPort = url.port && url.port !== '443';

      return url.protocol === 'https:' && isAmazonSns && !isInvalidPort;
    } catch {
      return false;
    }
  }

  /**
   * Computes a deterministic HMAC-SHA256 hash of the given email address.
   *
   * The address is lower-cased before hashing to ensure case-insensitive
   * matching. The HMAC secret is retrieved from AWS Secrets Manager via
   * `SecretsService`.
   *
   * @param email - The raw recipient email address.
   * @returns A 64-character lowercase hexadecimal HMAC-SHA256 digest.
   */
  private async hashEmail(email: string): Promise<string> {
    const secretName = this.configService.get<string>('AWS_SECRET_NAME');
    let secret = '';

    if (secretName) {
      const secretObject = await this.secretsService.getSecret(secretName);
      secret = secretObject?.sesEmailHmacSecret ?? '';
    }

    if (!secret) {
      this.logger.warn(
        'SES HMAC secret is not configured in Secrets Manager — email hashes will be computed with an empty key',
      );
    }

    return createHmac('sha256', secret) // NOSONAR
      .update(email.toLowerCase())
      .digest('hex');
  }

  /**
   * Persists one audit record per bounced recipient.
   *
   * Hard bounces (`Permanent`) set `suppress = true`, preventing future sends
   * to the affected address. Soft bounces (`Transient`, `Undetermined`) are
   * recorded for audit purposes only, without suppression.
   *
   * @param snsMessageId - Idempotency key from the parent SNS envelope.
   * @param notification - The full SES notification containing bounce details.
   */
  private async handleBounce(
    snsMessageId: string,
    notification: SesNotification,
  ): Promise<void> {
    const bounce = notification.bounce as SesBounce;
    const isPermanent = bounce.bounceType === 'Permanent';

    for (const recipient of bounce.bouncedRecipients) {
      const emailHashed = await this.hashEmail(recipient.emailAddress);
      const event = this.sesEventRepository.create({
        eventType: 'Bounce',
        emailHashed,
        bounceType: bounce.bounceType as SesBounceType,
        bounceSubType: bounce.bounceSubType as SesBounceSubType,
        complaintFeedbackType: null,
        sesMessageId: notification.mail.messageId,
        snsMessageId,
        suppress: isPermanent,
      });

      await this.sesEventRepository.save(event);

      if (isPermanent) {
        this.logger.warn(
          `Hard bounce (${bounce.bounceSubType}) recorded — address suppressed`,
        );
      } else {
        this.logger.log(
          `Soft bounce (${bounce.bounceType}/${bounce.bounceSubType}) recorded — address not suppressed`,
        );
      }
    }
  }

  /**
   * Persists one audit record per complained-about recipient.
   *
   * All complaints unconditionally set `suppress = true` regardless of
   * `complaintFeedbackType`, as per AWS's recommendation to immediately
   * remove complainers from mailing lists.
   *
   * @param snsMessageId - Idempotency key from the parent SNS envelope.
   * @param notification - The full SES notification containing complaint details.
   */
  private async handleComplaint(
    snsMessageId: string,
    notification: SesNotification,
  ): Promise<void> {
    const complaint = notification.complaint as SesComplaint;

    for (const recipient of complaint.complainedRecipients) {
      const emailHashed = await this.hashEmail(recipient.emailAddress);
      const event = this.sesEventRepository.create({
        eventType: 'Complaint',
        emailHashed,
        bounceType: null,
        bounceSubType: null,
        complaintFeedbackType: complaint.complaintFeedbackType ?? null,
        sesMessageId: notification.mail.messageId,
        snsMessageId,
        suppress: true,
      });

      await this.sesEventRepository.save(event);

      this.logger.warn(
        `Complaint (${complaint.complaintFeedbackType ?? 'unknown feedback type'}) recorded — address suppressed`,
      );
    }
  }

  /**
   * Persists one audit record per successfully delivered recipient.
   *
   * Delivery events are recorded for audit/visibility purposes only;
   * they never set `suppress = true`. These records are eligible for
   * cleanup after the shorter `SES_AUDIT_RETENTION_DAYS` window.
   *
   * @param snsMessageId - Idempotency key from the parent SNS envelope.
   * @param notification - The full SES notification containing delivery details.
   */
  private async handleDelivery(
    snsMessageId: string,
    notification: SesNotification,
  ): Promise<void> {
    const delivery = notification.delivery as SesDelivery;

    for (const recipient of delivery.recipients) {
      const emailHashed = await this.hashEmail(recipient);
      const event = this.sesEventRepository.create({
        eventType: 'Delivery',
        emailHashed,
        bounceType: null,
        bounceSubType: null,
        complaintFeedbackType: null,
        sesMessageId: notification.mail.messageId,
        snsMessageId,
        suppress: false,
      });

      await this.sesEventRepository.save(event);
    }

    this.logger.log(
      `Delivery confirmed for ${delivery.recipients.length} recipient(s) in ${delivery.processingTimeMillis}ms`,
    );
  }

  /**
   * Persists an audit record for an SES Reject event.
   *
   * Rejects occur when SES refuses to attempt delivery (e.g., because of
   * a virus or a previous hard bounce stored in the SES suppression list).
   * These events are recorded with suppress=true because the address
   * is clearly undeliverable.
   *
   * @param snsMessageId - Idempotency key from the parent SNS envelope.
   * @param notification - The full SES notification containing reject details.
   */
  private async handleReject(
    snsMessageId: string,
    notification: SesNotification,
  ): Promise<void> {
    const reject = notification.reject;
    const emailHashed = await this.hashEmail(notification.mail.destination[0]);

    const event = this.sesEventRepository.create({
      eventType: 'Bounce', // Record as a bounce for simplicity in lookups
      emailHashed,
      bounceType: 'Permanent',
      bounceSubType: 'Rejected',
      complaintFeedbackType: null,
      sesMessageId: notification.mail.messageId,
      snsMessageId,
      suppress: true,
      reason: reject?.reason ?? 'SES_REJECTED',
    });

    await this.sesEventRepository.save(event);

    this.logger.warn(
      `SES Reject recorded for ${notification.mail.destination[0]}: ${reject?.reason ?? 'unknown reason'}`,
    );
  }
}
