import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, LessThan, Not, Repository } from 'typeorm';

import { ContactRequestEntity } from 'src/contact/entities/contact-request.entity';
import {
  CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS,
  CONTACT_REQUEST_RECORD_RETENTION_DAYS,
} from 'src/cron/constants/cron.constants';

@Injectable()
export class ContactRequestCleanupService {
  private readonly _logger = new Logger(ContactRequestCleanupService.name);

  /**
   * Creates an instance of ContactRequestCleanupService.
   *
   * @param _contactRequestRepository - The contact request repository.
   */
  constructor(
    @InjectRepository(ContactRequestEntity)
    private readonly _contactRequestRepository: Repository<ContactRequestEntity>,
  ) {}

  /**
   * Removes stale records.
   */
  async cleanup(): Promise<void> {
    const recordThresholdDate = new Date();
    recordThresholdDate.setDate(
      recordThresholdDate.getDate() - CONTACT_REQUEST_RECORD_RETENTION_DAYS,
    );

    const deleteResult = await this._contactRequestRepository.delete({
      createdAt: LessThan(recordThresholdDate),
    });

    this._logger.log(
      `Deleted ${deleteResult.affected} contact requests older than ${CONTACT_REQUEST_RECORD_RETENTION_DAYS} days.`,
    );

    const thresholdDate = new Date();
    thresholdDate.setDate(
      thresholdDate.getDate() - CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS,
    );

    const updateResult = await this._contactRequestRepository.update(
      {
        createdAt: LessThan(thresholdDate),
        emailMasked: Not(IsNull()),
      },
      { emailMasked: null },
    );

    this._logger.log(
      `Cleared ${updateResult.affected} masked contact emails older than ${CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS} days.`,
    );
  }
}
