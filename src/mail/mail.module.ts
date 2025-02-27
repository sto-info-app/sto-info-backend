import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { ValidatorsService } from 'src/shared/utilities/validators.service';
import { MailService } from './mail.service';

@Module({
  imports: [SharedModule],
  providers: [MailService, ValidatorsService],
  exports: [MailService, ValidatorsService],
})
export class MailModule {}
