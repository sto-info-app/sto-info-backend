import { Module } from '@nestjs/common';
import { SecretsModule } from 'src/shared/secrets/secrets.module';
import { MailService } from './mail.service';

@Module({
  imports: [SecretsModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
