import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHmac } from 'node:crypto';
import { Repository } from 'typeorm';
import { SecretsService } from '../../shared/secrets/secrets.service';
import {
  SesNotification,
  SnsEnvelope,
} from './dto/sns-notification.interfaces';
import { SesEventEntity } from './entities/ses-event.entity';
import { SesWebhookService } from './ses-webhook.service';

type MockRepo = jest.Mocked<
  Pick<Repository<SesEventEntity>, 'findOne' | 'count' | 'create' | 'save'>
>;

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
      findOne: jest.fn(),
      count: jest.fn(),
      create: jest
        .fn()
        .mockImplementation(
          (data: Partial<SesEventEntity>) => data as SesEventEntity,
        ),
      save: jest.fn().mockResolvedValue(savedEntity),
    };

    configService = {
      get: jest.fn().mockReturnValue(testSecretName),
    } as any;

    secretsService = {
      getSecret: jest.fn().mockResolvedValue({
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
