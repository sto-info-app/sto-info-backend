import { Module } from '@nestjs/common';

import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { MailerModule } from '@nestjs-modules/mailer';

import { SharedModule } from 'src/shared/shared.module';
import { ValidatorsService } from 'src/shared/utilities/validators.service';

import { MailService } from './mail.service';

@Module({
  imports: [
    SharedModule,
    MailerModule.forRoot({
      transport: {
        SES: {
          sesClient: new SESv2Client({
            region: process.env.AWS_REGION ?? 'eu-west-2',
          }),
          SendEmailCommand,
        },
      },
    }),
  ],
  providers: [MailService, ValidatorsService],
  exports: [MailService, ValidatorsService],
})
export class MailModule {}
