import { jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SnsEnvelope } from './dto/sns-notification.interfaces';
import { SesWebhookController } from './ses-webhook.controller';
import { SesWebhookService } from './ses-webhook.service';

describe('SesWebhookController', () => {
  let controller: SesWebhookController;
  let service: jest.Mocked<
    Pick<
      SesWebhookService,
      | 'validateTopicArn'
      | 'confirmSubscription'
      | 'processNotification'
      | 'isValidSnsSubscribeUrl'
    >
  >;

  const validTopicArn =
    'arn:aws:sns:eu-west-2:123456789012:sto-info-ses-bounces';

  const makeEnvelope = (overrides: Partial<SnsEnvelope> = {}): SnsEnvelope => ({
    Type: 'Notification',
    MessageId: 'msg-001',
    TopicArn: validTopicArn,
    Timestamp: '2026-02-24T00:00:00Z',
    SignatureVersion: '1',
    Signature: 'sig',
    SigningCertURL: 'https://sns.amazonaws.com/cert.pem',
    ...overrides,
  });

  beforeEach(async () => {
    service = {
      validateTopicArn: jest.fn().mockReturnValue(true),
      confirmSubscription: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(undefined),
      processNotification: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(undefined),
      isValidSnsSubscribeUrl: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<
      Pick<
        SesWebhookService,
        | 'validateTopicArn'
        | 'confirmSubscription'
        | 'processNotification'
        | 'isValidSnsSubscribeUrl'
      >
    >;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SesWebhookController],
      providers: [{ provide: SesWebhookService, useValue: service }],
    }).compile();

    controller = module.get(SesWebhookController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handleSnsNotification', () => {
    it('should throw ForbiddenException when TopicArn is invalid', async () => {
      service.validateTopicArn.mockReturnValue(false);
      const envelope = makeEnvelope();
      await expect(
        controller.handleSnsNotification('Notification', envelope),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should confirm SNS subscription on SubscriptionConfirmation', async () => {
      const envelope = makeEnvelope({
        Type: 'SubscriptionConfirmation',
        SubscribeURL: 'https://sns.amazonaws.com/confirm?token=abc',
      });
      await controller.handleSnsNotification(
        'SubscriptionConfirmation',
        envelope,
      );
      expect(service.confirmSubscription).toHaveBeenCalledWith(
        'https://sns.amazonaws.com/confirm?token=abc',
      );
    });

    it('should do nothing when SubscriptionConfirmation is missing SubscribeURL', async () => {
      const envelope = makeEnvelope({ Type: 'SubscriptionConfirmation' });
      await controller.handleSnsNotification(
        'SubscriptionConfirmation',
        envelope,
      );
      expect(service.confirmSubscription).not.toHaveBeenCalled();
    });

    it('should do nothing when SubscribeURL is invalid (SSRF protection)', async () => {
      service.isValidSnsSubscribeUrl.mockReturnValue(false);
      const envelope = makeEnvelope({
        Type: 'SubscriptionConfirmation',
        SubscribeURL: 'https://attacker.com/confirm',
      });
      await controller.handleSnsNotification(
        'SubscriptionConfirmation',
        envelope,
      );
      expect(service.confirmSubscription).not.toHaveBeenCalled();
    });

    it('should set isValid to false when SubscribeURL parsing fails', async () => {
      const envelope = makeEnvelope({
        Type: 'SubscriptionConfirmation',
        SubscribeURL: 'not-a-url',
      });
      await controller.handleSnsNotification(
        'SubscriptionConfirmation',
        envelope,
      );
      expect(service.confirmSubscription).not.toHaveBeenCalled();
    });

    it('should reject non-https SubscribeURL', async () => {
      const envelope = makeEnvelope({
        Type: 'SubscriptionConfirmation',
        SubscribeURL: 'http://sns.amazonaws.com/confirm',
      });
      await controller.handleSnsNotification(
        'SubscriptionConfirmation',
        envelope,
      );
      expect(service.confirmSubscription).not.toHaveBeenCalled();
    });

    it('should reject invalid subdomains of amazonaws.com', async () => {
      const envelope = makeEnvelope({
        Type: 'SubscriptionConfirmation',
        SubscribeURL: 'https://other.amazonaws.com/confirm',
      });
      await controller.handleSnsNotification(
        'SubscriptionConfirmation',
        envelope,
      );
      expect(service.confirmSubscription).not.toHaveBeenCalled();
    });

    it('should process a valid Notification', async () => {
      const sesNotification = {
        notificationType: 'Bounce',
        mail: {
          messageId: 'ses-001',
          source: 'no-reply@test.local',
          destination: ['user@example.com'],
          timestamp: '',
        },
        bounce: {
          bounceType: 'Permanent',
          bounceSubType: 'General',
          bouncedRecipients: [{ emailAddress: 'user@example.com' }],
          timestamp: '',
          feedbackId: '',
        },
      };
      const envelope = makeEnvelope({
        Message: JSON.stringify(sesNotification),
      });
      await controller.handleSnsNotification('Notification', envelope);
      expect(service.processNotification).toHaveBeenCalledWith(
        'msg-001',
        sesNotification,
      );
    });

    it('should handle Notification with no Message field', async () => {
      const envelope = makeEnvelope({ Message: undefined });
      await controller.handleSnsNotification('Notification', envelope);
      expect(service.processNotification).not.toHaveBeenCalled();
    });

    it('should accept a string body and parse it as JSON', async () => {
      const sesNotification = {
        notificationType: 'Delivery',
        mail: {
          messageId: 'ses-002',
          source: 'no-reply@test.local',
          destination: ['user@example.com'],
          timestamp: '',
        },
        delivery: {
          recipients: ['user@example.com'],
          timestamp: '',
          processingTimeMillis: 100,
          smtpResponse: '250',
        },
      };
      const envelope = makeEnvelope({
        Message: JSON.stringify(sesNotification),
      });
      await controller.handleSnsNotification(
        'Notification',
        JSON.stringify(envelope) as unknown as object,
      );
      expect(service.processNotification).toHaveBeenCalled();
    });

    it('should handle unknown SNS message type gracefully', async () => {
      const envelope = makeEnvelope({ Type: 'UnsubscribeConfirmation' });
      await expect(
        controller.handleSnsNotification('UnsubscribeConfirmation', envelope),
      ).resolves.not.toThrow();
    });

    it('should return early and log when body is invalid JSON string', async () => {
      await expect(
        controller.handleSnsNotification(
          'Notification',
          'not-valid-json' as any,
        ),
      ).resolves.toBeUndefined();
      expect(service.processNotification).not.toHaveBeenCalled();
    });

    it('should skip and log when Notification Message field contains invalid JSON', async () => {
      const envelope = makeEnvelope({ Message: '{invalid-json}' });
      await expect(
        controller.handleSnsNotification('Notification', envelope),
      ).resolves.toBeUndefined();
      expect(service.processNotification).not.toHaveBeenCalled();
    });

    it('should fall back to envelope.Type when x-amz-sns-message-type header is absent', async () => {
      const sesNotification = {
        notificationType: 'Delivery',
        mail: {
          messageId: 'ses-003',
          source: 'no-reply@test.local',
          destination: ['user@example.com'],
          timestamp: '',
        },
        delivery: {
          recipients: ['user@example.com'],
          timestamp: '',
          processingTimeMillis: 100,
          smtpResponse: '250',
        },
      };
      const envelope = makeEnvelope({
        Type: 'Notification',
        Message: JSON.stringify(sesNotification),
      });
      // Pass undefined/null as the header to simulate header absence
      await controller.handleSnsNotification(
        undefined as unknown as string,
        envelope,
      );
      expect(service.processNotification).toHaveBeenCalledWith(
        'msg-001',
        sesNotification,
      );
    });
  });
});
