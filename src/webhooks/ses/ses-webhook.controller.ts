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
  private readonly logger = new Logger(SesWebhookController.name);

  constructor(private readonly sesWebhookService: SesWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
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
      this.logger.error('Failed to parse SNS request body');
      return;
    }

    // Validate the TopicArn to prevent spoofed notifications
    if (!this.sesWebhookService.validateTopicArn(envelope)) {
      this.logger.error(
        `Rejected SNS notification: unexpected TopicArn "${envelope.TopicArn}"`,
      );
      throw new ForbiddenException('Invalid SNS TopicArn');
    }

    const type = messageType ?? envelope.Type;

    if (type === 'SubscriptionConfirmation') {
      const url = envelope.SubscribeURL;
      if (!url) {
        this.logger.error('SubscriptionConfirmation missing SubscribeURL');
        return;
      }

      // Early validation to satisfy security scanners and defense-in-depth
      if (!this.sesWebhookService.isValidSnsSubscribeUrl(url)) {
        this.logger.error(
          `Rejected SNS subscription confirmation due to invalid SubscribeURL: ${url}`,
        );
        return;
      }

      await this.sesWebhookService.confirmSubscription(url);
      return;
    }

    if (type === 'Notification') {
      if (!envelope.Message) {
        this.logger.warn('SNS Notification missing Message body — skipping');
        return;
      }

      let notification: SesNotification;
      try {
        notification = JSON.parse(envelope.Message) as SesNotification;
      } catch {
        this.logger.error(
          'Failed to parse SES notification from SNS Message field',
        );
        return;
      }

      await this.sesWebhookService.processNotification(
        envelope.MessageId,
        notification,
      );
      return;
    }

    this.logger.warn(`Unhandled SNS message type: ${type}`);
  }
}
