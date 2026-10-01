import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from 'src/auth/auth.module';
import { AssetIngressModule } from 'src/file-assets/asset-ingress.module';
import { MailModule } from 'src/mail/mail.module';
import { SharedModule } from 'src/shared/shared.module';
import { ValidatorsService } from 'src/shared/utilities/validators.service';

import { AccountClosureLedgerService } from './closure/account-closure-ledger.service';
import { AccountClosureReconciliationService } from './closure/account-closure-reconciliation.service';
import { UserPreferenceEntity } from './entities/user-preference.entity';
import { UserProfileEntity } from './entities/user-profile.entity';
import { UserEntity } from './entities/user.entity';
import { UserProfileImagePublisher } from './images/user-profile-image.publisher';
import { UserPreferenceService } from './user-preference.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [
    SharedModule,
    MailModule,
    TypeOrmModule.forFeature([
      UserEntity,
      UserProfileEntity,
      UserPreferenceEntity,
    ]),
    forwardRef(() => AuthModule), // Use forwardRef to handle circular dependency
    // A profile picture is now registered, quarantined and scanned before
    // anybody sees it, and published into the profile afterwards.
    AssetIngressModule,
  ],
  controllers: [UserController],
  providers: [
    UserService,
    UserPreferenceService,
    ValidatorsService,
    UserProfileImagePublisher,
    // Each closure kept outside the database, and checked at boot (FC-042).
    AccountClosureLedgerService,
    AccountClosureReconciliationService,
  ],
  exports: [
    UserService,
    UserPreferenceService,
    TypeOrmModule,
    AccountClosureLedgerService,
    AccountClosureReconciliationService,
  ],
})
export class UserModule {}
