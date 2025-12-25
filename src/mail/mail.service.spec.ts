import { Test, TestingModule } from '@nestjs/testing';
import { SecretsService } from 'src/shared/secrets/secrets.service';
import { ValidatorsService } from 'src/shared/utilities/validators.service';
import { MailService } from './mail.service';

describe('MailService', () => {
  let service: MailService;

  beforeEach(async () => {
    process.env.APP_TITLE = 'Test App';
    process.env.SENDGRID_NOREPLY_SENDER = 'no-reply@test.local';
    process.env.APP_FRONTEND_URL = 'https://test.local';
    process.env.AWS_SECRET_NAME = 'test-secret';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: SecretsService,
          useValue: {
            getSecret: jest.fn().mockResolvedValue({ sendGridApiKey: 'key' }),
          },
        },
        {
          provide: ValidatorsService,
          useValue: {
            validateEmail: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw if a required environment variable is missing', () => {
    const originalAppTitle = process.env.APP_TITLE;
    delete process.env.APP_TITLE;

    const secretsMock = {
      getSecret: jest.fn(),
    } as unknown as SecretsService;
    const validatorsMock = {
      validateEmail: jest.fn(),
    } as unknown as ValidatorsService;

    expect(() => new MailService(secretsMock, validatorsMock)).toThrow(
      'Environment variable APP_TITLE is not set',
    );

    process.env.APP_TITLE = originalAppTitle;
  });
});
