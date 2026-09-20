import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisher,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';

import { UserProfileEntity } from '../entities/user-profile.entity';

/**
 * Puts a cleared picture on somebody's profile.
 *
 * The half of publication that only this feature can do. Everything up to
 * here is the same for every picture the site holds; this is the one write
 * that knows the table, the column and that a profile is keyed by its user.
 *
 * It returns what the column held so that the previous picture can be
 * withdrawn. Returning it rather than deleting it here is deliberate: the
 * withdrawal is a registry state change followed by a Cloudflare delete
 * followed by a purge record, and a feature has no business performing any
 * of the three.
 */
@Injectable()
export class UserProfileImagePublisher implements AssetPublisher, OnModuleInit {
  private readonly _logger = new Logger(UserProfileImagePublisher.name);

  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.USER_PROFILE;

  /**
   * Creates an instance of UserProfileImagePublisher.
   *
   * @param _profiles - Repository of user profiles.
   * @param _registry - Which publisher writes which table.
   */
  constructor(
    @InjectRepository(UserProfileEntity)
    private readonly _profiles: Repository<UserProfileEntity>,
    private readonly _registry: AssetPublisherRegistry,
  ) {}

  /**
   * Registers this publisher with the registry.
   */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Points a profile at a newly published picture.
   *
   * A profile that has since been deleted is not an error. The account went
   * while the picture was being scanned; nothing points at it, and the
   * caller withdraws it as it would any replaced picture.
   *
   * @param attachment - The profile, the new picture and the feature detail.
   * @returns The picture the profile held before, or null.
   */
  async attach(attachment: AssetAttachment): Promise<string | null> {
    const profile = await this._profiles.findOne({
      where: { userId: attachment.subjectId },
    });

    if (profile === null) {
      this._logger.warn(
        `[attach] No profile to publish to - UserId: ${attachment.subjectId}`,
      );

      return attachment.deliveryReference;
    }

    const previous = profile.profilePictureId ?? null;

    profile.profilePictureId = attachment.deliveryReference;
    await this._profiles.save(profile);

    return previous;
  }
}
