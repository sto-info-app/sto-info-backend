import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from 'src/mail/mail.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';
import { ContactRequestEntity } from './entities/contact-request.entity';

@Module({
  imports: [MailModule, TypeOrmModule.forFeature([ContactRequestEntity])],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
