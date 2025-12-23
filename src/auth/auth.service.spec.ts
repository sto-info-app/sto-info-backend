import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLoginAttemptEntity } from 'src/audit/entities/audit-login-attempt.entity';
import { MailService } from 'src/mail/mail.service';
import { UserRefreshTokenService } from 'src/user-refresh-token/user-refresh-token.service';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserService } from 'src/user/user.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {},
        },
        {
          provide: getRepositoryToken(UserProfileEntity),
          useValue: {},
        },
        {
          provide: getRepositoryToken(AuditLoginAttemptEntity),
          useValue: {},
        },
        {
          provide: JwtService,
          useValue: {},
        },
        {
          provide: UserService,
          useValue: {},
        },
        {
          provide: MailService,
          useValue: {},
        },
        {
          provide: UserRefreshTokenService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
