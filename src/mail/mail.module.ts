import { Module } from '@nestjs/common';
import { SecretsModule } from 'src/shared/secrets/secrets.module';
import { ValidatorsService } from 'src/shared/utilities/validators.service';
import { MailService } from './mail.service';

@Module({
  imports: [SecretsModule],
  providers: [MailService, ValidatorsService],
  exports: [MailService, ValidatorsService],
})
export class MailModule {}
