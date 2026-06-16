import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ContactRequestEntity } from 'src/contact/entities/contact-request.entity';
import {
  CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS,
  CONTACT_REQUEST_RECORD_RETENTION_DAYS,
} from 'src/cron/constants/cron.constants';
import { IsNull, LessThan, Not, Repository } from 'typeorm';

@Injectable()
export class ContactRequestCleanupService {
  private readonly logger = new Logger(ContactRequestCleanupService.name);

  /**
   * Creates an instance of ContactRequestCleanupService.
   *
   * @param contactRequestRepository - The contact request repository.
   */
  constructor(
    @InjectRepository(ContactRequestEntity)
    private readonly contactRequestRepository: Repository<ContactRequestEntity>,
  ) {}

  /**
   * Removes stale records.
   */
  async cleanup(): Promise<void> {
    const recordThresholdDate = new Date();
    recordThresholdDate.setDate(
      recordThresholdDate.getDate() - CONTACT_REQUEST_RECORD_RETENTION_DAYS,
    );

    const deleteResult = await this.contactRequestRepository.delete({
      createdAt: LessThan(recordThresholdDate),
    });

    this.logger.log(
      `Deleted ${deleteResult.affected} contact requests older than ${CONTACT_REQUEST_RECORD_RETENTION_DAYS} days.`,
    );

    const thresholdDate = new Date();
    thresholdDate.setDate(
      thresholdDate.getDate() - CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS,
    );

    const updateResult = await this.contactRequestRepository.update(
      {
        createdAt: LessThan(thresholdDate),
        emailMasked: Not(IsNull()),
      },
      { emailMasked: null },
    );

    this.logger.log(
      `Cleared ${updateResult.affected} masked contact emails older than ${CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS} days.`,
    );
  }
}
