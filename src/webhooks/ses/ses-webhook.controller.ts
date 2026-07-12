import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import {
  SesNotification,
  SnsEnvelope,
} from './dto/sns-notification.interfaces';
import { SesWebhookService } from './ses-webhook.service';

/**
 * Receives HTTP POST notifications from AWS SNS for SES bounce, complaint,
 * and delivery events. This endpoint must be publicly accessible and is
 * rate-limited by the global write limiter.
 *
 * AWS SNS sends `Content-Type: text/plain` with a JSON body, so we accept
 * the raw body as a string and parse it manually.
 */
@Controller('webhooks/ses')
export class SesWebhookController {
  private readonly _logger = new Logger(SesWebhookController.name);

  /**
   * Creates an instance of SesWebhookController.
   *
   * @param _sesWebhookService - The ses webhook service.
   */
  constructor(private readonly _sesWebhookService: SesWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  /**
   * Handles sns notification.
   *
   * @param messageType - The message type.
   * @param body - The request body.
   */
  async handleSnsNotification(
    @Headers('x-amz-sns-message-type') messageType: string,
    @Body() body: unknown,
  ): Promise<void> {
    // SNS posts application/json but also sets the message-type header.
    // Parse body if it arrived as a string (text/plain fallback).
    let envelope: SnsEnvelope;
    try {
      envelope =
        typeof body === 'string'
          ? (JSON.parse(body) as SnsEnvelope)
          : (body as SnsEnvelope);
    } catch {
      this._logger.error('Failed to parse SNS request body');
      return;
    }

    // Validate the TopicArn to prevent spoofed notifications
    if (!this._sesWebhookService.validateTopicArn(envelope)) {
      this._logger.error(
        `Rejected SNS notification: unexpected TopicArn "${envelope.TopicArn}"`,
      );
      throw new ForbiddenException('Invalid SNS TopicArn');
    }

    const type = messageType ?? envelope.Type;

    if (type === 'SubscriptionConfirmation') {
      const subscribeUrl = envelope.SubscribeURL;
      if (!subscribeUrl) {
        this._logger.error('SubscriptionConfirmation missing SubscribeURL');
        return;
      }

      // Explicit inline check to satisfy security scanners (SSRF prevention).
      // This is redundant with service validation but helps satisfy static analysis.
      let isValid = false;
      try {
        const parsed = new URL(subscribeUrl);
        const host = parsed.hostname.toLowerCase();
        if (
          parsed.protocol === 'https:' &&
          (host === 'sns.amazonaws.com' ||
            (host.endsWith('.amazonaws.com') && host.startsWith('sns.')))
        ) {
          isValid = true;
        }
      } catch {
        isValid = false;
      }

      if (!isValid) {
        this._logger.error(
          'Rejected SNS subscription confirmation due to invalid SubscribeURL format or domain',
        );
        return;
      }

      await this._sesWebhookService.confirmSubscription(subscribeUrl);
      return;
    }

    if (type === 'Notification') {
      if (!envelope.Message) {
        this._logger.warn('SNS Notification missing Message body — skipping');
        return;
      }

      let notification: SesNotification;
      try {
        notification = JSON.parse(envelope.Message) as SesNotification;
      } catch {
        this._logger.error(
          'Failed to parse SES notification from SNS Message field',
        );
        return;
      }

      await this._sesWebhookService.processNotification(
        envelope.MessageId,
        notification,
      );
      return;
    }

    this._logger.warn(`Unhandled SNS message type: ${type}`);
  }
}
