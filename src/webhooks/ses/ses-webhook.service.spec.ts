import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as https from 'node:https';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';

import { SecretsService } from '../../shared/secrets/secrets.service';
import {
  SesNotification,
  SnsEnvelope,
} from './dto/sns-notification.interfaces';
import { SesEventEntity } from './entities/ses-event.entity';
import { SesWebhookService } from './ses-webhook.service';

jest.mock('node:https');

type MockRepo = {
  findOne: jest.Mock<(...args: any[]) => Promise<any>>;
  count: jest.Mock<(...args: any[]) => Promise<any>>;
  create: jest.Mock<(...args: any[]) => any>;
  save: jest.Mock<(...args: any[]) => Promise<any>>;
};

/** Compute the expected HMAC-SHA256 hash using the same logic as the service. */
const hmac = (email: string, secret = '') =>
  createHmac('sha256', secret).update(email.toLowerCase()).digest('hex');

describe('SesWebhookService', () => {
  let service: SesWebhookService;
  let repo: MockRepo;
  let configService: jest.Mocked<ConfigService>;
  let secretsService: jest.Mocked<SecretsService>;

  const testSecretName = 'test-secret-name';
  const testHmacSecret = 'test-hmac-secret';

  const savedEntity = { id: 'uuid-1' } as SesEventEntity;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn<(...args: any[]) => Promise<any>>(),
      count: jest.fn<(...args: any[]) => Promise<any>>(),
      create: jest
        .fn<(...args: any[]) => any>()
        .mockImplementation(
          (data: Partial<SesEventEntity>) => data as SesEventEntity,
        ),
      save: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(savedEntity),
    };

    configService = {
      get: jest.fn().mockReturnValue(testSecretName),
    } as any;

    secretsService = {
      getSecret: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({
        sesEmailHmacSecret: testHmacSecret,
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SesWebhookService,
        { provide: getRepositoryToken(SesEventEntity), useValue: repo },
        { provide: ConfigService, useValue: configService },
        { provide: SecretsService, useValue: secretsService },
      ],
    }).compile();

    service = module.get(SesWebhookService);
  });

  afterEach(() => {
    delete process.env.AWS_SNS_TOPIC_ARN;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // validateTopicArn
  // --------------------------------------------------------------------------
  describe('validateTopicArn', () => {
    const envelope = {
      TopicArn: 'arn:aws:sns:eu-west-2:123:sto-info-ses-bounces',
    } as SnsEnvelope;

    it('should return false when AWS_SNS_TOPIC_ARN is not set', () => {
      delete process.env.AWS_SNS_TOPIC_ARN;
      expect(service.validateTopicArn(envelope)).toBe(false);
    });

    it('should return true when TopicArn matches', () => {
      process.env.AWS_SNS_TOPIC_ARN = envelope.TopicArn;
      expect(service.validateTopicArn(envelope)).toBe(true);
    });

    it('should return false when TopicArn does not match', () => {
      process.env.AWS_SNS_TOPIC_ARN = 'arn:aws:sns:eu-west-2:999:other-topic';
      expect(service.validateTopicArn(envelope)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // processNotification — idempotency
  // --------------------------------------------------------------------------
  describe('processNotification', () => {
    it('should skip processing when snsMessageId already exists', async () => {
      repo.findOne.mockResolvedValue(savedEntity);
      const notification = { notificationType: 'Bounce' } as SesNotification;
      await service.processNotification('dup-msg', notification);
      expect(repo.save).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Bounce handling
    // -------------------------------------------------------------------------
    describe('Bounce', () => {
      const bounceNotification: SesNotification = {
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
          bouncedRecipients: [{ emailAddress: 'User@Example.com' }],
          timestamp: '',
          feedbackId: 'fid-1',
        },
      };

      beforeEach(() => {
        repo.findOne.mockResolvedValue(null);
      });

      it('should persist a hard bounce with suppress=true and store a hash', async () => {
        await service.processNotification('msg-bounce-001', bounceNotification);
        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'Bounce',
            emailHashed: hmac('User@Example.com', testHmacSecret),
            bounceType: 'Permanent',
            suppress: true,
          }),
        );
        expect(repo.save).toHaveBeenCalledTimes(1);
      });

      it('should persist a soft bounce with suppress=false', async () => {
        const softBounce: SesNotification = {
          ...bounceNotification,
          bounce: {
            ...bounceNotification.bounce!,
            bounceType: 'Transient',
            bounceSubType: 'MailboxFull',
          },
        };
        await service.processNotification('msg-soft-001', softBounce);
        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            bounceType: 'Transient',
            suppress: false,
          }),
        );
      });

      it('should lowercase the email before hashing', async () => {
        await service.processNotification('msg-bounce-002', bounceNotification);
        const expectedHash = hmac('user@example.com', testHmacSecret); // lower-cased
        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({ emailHashed: expectedHash }),
        );
      });

      it('should never store a plaintext email', async () => {
        await service.processNotification('msg-bounce-003', bounceNotification);
        const callArg = (repo.create as jest.Mock).mock.calls[0][0] as Record<
          string,
          unknown
        >;
        expect(callArg).not.toHaveProperty('email');
      });
    });

    // -------------------------------------------------------------------------
    // Complaint handling
    // -------------------------------------------------------------------------
    describe('Complaint', () => {
      const complaintNotification: SesNotification = {
        notificationType: 'Complaint',
        mail: {
          messageId: 'ses-002',
          source: 'no-reply@test.local',
          destination: ['angry@example.com'],
          timestamp: '',
        },
        complaint: {
          complainedRecipients: [{ emailAddress: 'Angry@Example.com' }],
          complaintFeedbackType: 'abuse',
          timestamp: '',
          feedbackId: 'cid-1',
        },
      };

      beforeEach(() => {
        repo.findOne.mockResolvedValue(null);
      });

      it('should persist a complaint with suppress=true and a hashed email', async () => {
        await service.processNotification(
          'msg-complaint-001',
          complaintNotification,
        );
        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'Complaint',
            emailHashed: hmac('Angry@Example.com', testHmacSecret),
            complaintFeedbackType: 'abuse',
            suppress: true,
          }),
        );
      });

      it('should handle missing complaintFeedbackType gracefully', async () => {
        const noFeedbackType: SesNotification = {
          ...complaintNotification,
          complaint: {
            ...complaintNotification.complaint!,
            complaintFeedbackType: undefined,
          },
        };
        await service.processNotification('msg-complaint-002', noFeedbackType);
        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({ complaintFeedbackType: null }),
        );
      });
    });

    // -------------------------------------------------------------------------
    // Reject handling
    // -------------------------------------------------------------------------
    describe('Reject', () => {
      const rejectNotification: SesNotification = {
        notificationType: 'Reject',
        mail: {
          messageId: 'ses-004',
          source: 'no-reply@test.local',
          destination: ['rejected@example.com'],
          timestamp: '',
        },
        reject: { reason: 'Bad content' },
      };

      beforeEach(() => {
        repo.findOne.mockResolvedValue(null);
      });

      it('should persist a Reject event as a hard bounce with suppress=true', async () => {
        await service.processNotification('msg-reject-001', rejectNotification);
        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'Bounce',
            bounceType: 'Permanent',
            bounceSubType: 'Rejected',
            suppress: true,
            reason: 'Bad content',
          }),
        );
        expect(repo.save).toHaveBeenCalledTimes(1);
      });

      it('should use SES_REJECTED as reason when reject is undefined', async () => {
        const noRejectField: SesNotification = {
          ...rejectNotification,
          reject: undefined,
        };
        await service.processNotification('msg-reject-002', noRejectField);
        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({ reason: 'SES_REJECTED' }),
        );
      });
    });

    // -------------------------------------------------------------------------
    // Unknown notification type
    // -------------------------------------------------------------------------
    it('should log a warning for unrecognised notification type', async () => {
      repo.findOne.mockResolvedValue(null);
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const unknown = {
        notificationType: 'Unknown' as any,
        mail: { messageId: 'x', source: '', destination: [], timestamp: '' },
      } as SesNotification;

      await service.processNotification('msg-unknown-001', unknown);
      expect(repo.save).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unrecognised SES notification type'),
      );
      warnSpy.mockRestore();
    });

    // -------------------------------------------------------------------------
    // Delivery handling
    // -------------------------------------------------------------------------
    describe('Delivery', () => {
      const deliveryNotification: SesNotification = {
        notificationType: 'Delivery',
        mail: {
          messageId: 'ses-003',
          source: 'no-reply@test.local',
          destination: ['user@example.com'],
          timestamp: '',
        },
        delivery: {
          recipients: ['User@Example.com'],
          timestamp: '',
          processingTimeMillis: 250,
          smtpResponse: '250 OK',
        },
      };

      beforeEach(() => {
        repo.findOne.mockResolvedValue(null);
      });

      it('should persist a delivery event with suppress=false', async () => {
        await service.processNotification(
          'msg-delivery-001',
          deliveryNotification,
        );
        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'Delivery',
            emailHashed: hmac('User@Example.com', testHmacSecret),
            suppress: false,
          }),
        );
      });
    });
  });

  // --------------------------------------------------------------------------
  // confirmSubscription
  // --------------------------------------------------------------------------
  describe('confirmSubscription', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should resolve when the HTTPS GET succeeds for a valid SNS URL', async () => {
      const mockReq = new EventEmitter() as any;
      const mockRes = { statusCode: 200 } as any;
      (https.get as jest.Mock<(...args: any[]) => any>).mockImplementation(
        (_url: string, cb: (res: any) => void) => {
          cb(mockRes);
          return mockReq;
        },
      );

      await expect(
        service.confirmSubscription(
          'https://sns.us-east-1.amazonaws.com/confirm?token=abc',
        ),
      ).resolves.toBeUndefined();
      expect(https.get).toHaveBeenCalled();
    });

    it('should reject and return early for an invalid protocol', async () => {
      await service.confirmSubscription('http://sns.amazonaws.com/confirm');
      expect(https.get).not.toHaveBeenCalled();
    });

    it('should reject and return early for a malformed URL', async () => {
      await service.confirmSubscription('not-a-url');
      expect(https.get).not.toHaveBeenCalled();
    });

    it('should reject and return early for a non-AWS hostname', async () => {
      await service.confirmSubscription('https://attacker.com/confirm');
      expect(https.get).not.toHaveBeenCalled();
    });

    it('should reject and return early for an AWS hostname without sns label', async () => {
      await service.confirmSubscription('https://ec2.amazonaws.com/confirm');
      expect(https.get).not.toHaveBeenCalled();
    });

    it('should reject and return early for non-standard ports', async () => {
      await service.confirmSubscription(
        'https://sns.us-east-1.amazonaws.com:8080/confirm',
      );
      expect(https.get).not.toHaveBeenCalled();
    });

    it('should reject when the HTTPS GET emits an error for a valid URL', async () => {
      const mockReq = new EventEmitter() as any;
      (https.get as jest.Mock<(...args: any[]) => any>).mockImplementation(
        () => mockReq,
      );

      const promise = service.confirmSubscription(
        'https://sns.eu-west-2.amazonaws.com/confirm',
      );
      mockReq.emit('error', new Error('Network failure'));
      await expect(promise).rejects.toThrow('Network failure');
    });
  });

  // --------------------------------------------------------------------------
  // isValidSnsSubscribeUrl
  // --------------------------------------------------------------------------
  describe('isValidSnsSubscribeUrl', () => {
    it('should return true for valid regional SNS URLs', () => {
      expect(
        service.isValidSnsSubscribeUrl(
          'https://sns.us-east-1.amazonaws.com/confirm',
        ),
      ).toBe(true);
    });

    it('should return true for valid global SNS URLs', () => {
      expect(
        service.isValidSnsSubscribeUrl('https://sns.amazonaws.com/confirm'),
      ).toBe(true);
    });

    it('should return false for malformed URLs', () => {
      expect(service.isValidSnsSubscribeUrl('not-a-url')).toBe(false);
    });

    it('should return false for non-HTTPS protocols', () => {
      expect(service.isValidSnsSubscribeUrl('http://sns.amazonaws.com/')).toBe(
        false,
      );
    });

    it('should return false for suspicious hostnames', () => {
      expect(service.isValidSnsSubscribeUrl('https://sns.attacker.com/')).toBe(
        false,
      );
      expect(
        service.isValidSnsSubscribeUrl(
          'https://sns.us-east-1.amazonaws.com.attacker.com/',
        ),
      ).toBe(false);
      // Hostname without sns prefix
      expect(
        service.isValidSnsSubscribeUrl('https://ec2.us-east-1.amazonaws.com/'),
      ).toBe(false);
    });

    it('should return false for non-standard ports', () => {
      expect(
        service.isValidSnsSubscribeUrl(
          'https://sns.us-east-1.amazonaws.com:8080/',
        ),
      ).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // hashEmail — secret fallbacks
  // --------------------------------------------------------------------------
  describe('hashEmail (via isSuppressed)', () => {
    it('should hash with empty key when AWS_SECRET_NAME is not configured', async () => {
      configService.get.mockReturnValue(undefined);
      repo.count.mockResolvedValue(0);
      await service.isSuppressed('user@example.com');
      const expectedHash = createHmac('sha256', '') //NOSONAR - test data
        .update('user@example.com')
        .digest('hex');
      expect(repo.count).toHaveBeenCalledWith({
        where: { emailHashed: expectedHash, suppress: true },
      });
    });

    it('should hash with empty key when sesEmailHmacSecret is absent from secrets', async () => {
      configService.get.mockReturnValue('some-secret-name');
      secretsService.getSecret.mockResolvedValueOnce({} as any);
      repo.count.mockResolvedValue(0);
      await service.isSuppressed('user@example.com');
      const expectedHash = createHmac('sha256', '') //NOSONAR - test data
        .update('user@example.com')
        .digest('hex');
      expect(repo.count).toHaveBeenCalledWith({
        where: { emailHashed: expectedHash, suppress: true },
      });
    });

    it('should hash with empty key when secretObject is null', async () => {
      configService.get.mockReturnValue('some-secret-name');
      secretsService.getSecret.mockResolvedValueOnce(null as any);
      repo.count.mockResolvedValue(0);
      await service.isSuppressed('user@example.com');
      const expectedHash = createHmac('sha256', '') //NOSONAR - test data
        .update('user@example.com')
        .digest('hex');
      expect(repo.count).toHaveBeenCalledWith({
        where: { emailHashed: expectedHash, suppress: true },
      });
    });
  });

  // --------------------------------------------------------------------------
  // isSuppressed
  // --------------------------------------------------------------------------
  describe('isSuppressed', () => {
    it('should hash the input email and query by hash', async () => {
      repo.count.mockResolvedValue(1);
      await service.isSuppressed('User@Example.com');
      expect(repo.count).toHaveBeenCalledWith({
        where: {
          emailHashed: hmac('user@example.com', testHmacSecret),
          suppress: true,
        },
      });
    });

    it('should return true when a suppression record exists', async () => {
      repo.count.mockResolvedValue(1);
      expect(await service.isSuppressed('user@example.com')).toBe(true);
    });

    it('should return false when no suppression record exists', async () => {
      repo.count.mockResolvedValue(0);
      expect(await service.isSuppressed('clean@example.com')).toBe(false);
    });

    it('should use the secret from Secrets Manager', async () => {
      const customSecret = 'custom-secret-123';
      secretsService.getSecret.mockResolvedValueOnce({
        sesEmailHmacSecret: customSecret,
      });
      repo.count.mockResolvedValue(0);
      await service.isSuppressed('user@example.com');
      const expectedHash = hmac('user@example.com', customSecret);
      expect(repo.count).toHaveBeenCalledWith({
        where: { emailHashed: expectedHash, suppress: true },
      });
    });
  });
});
