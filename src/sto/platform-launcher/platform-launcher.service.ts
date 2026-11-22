import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Repository } from 'typeorm';

import { isValidCloudflareImageUrl } from 'src/shared/constants/image.constants';

import { PlatformLauncherEntity } from './entities/platform-launcher.entity';

@Injectable()
export class PlatformLauncherService {
  /**
   * Creates an instance of PlatformLauncherService.
   *
   * @param _platformLauncherRepository - The platform launcher repository.
   */
  constructor(
    @InjectRepository(PlatformLauncherEntity)
    private readonly _platformLauncherRepository: Repository<PlatformLauncherEntity>,
  ) {}

  /**
   * Returns a relation with a validated background image URL.
   *
   * @param relation - The relation to sanitize.
   * @returns The same relation with an invalid background URL set to `null`.
   */
  private sanitizeBackgroundImageUrl(
    relation: PlatformLauncherEntity,
  ): PlatformLauncherEntity {
    if (!isValidCloudflareImageUrl(relation.backgroundImageUrl)) {
      relation.backgroundImageUrl = null;
    }

    return relation;
  }

  /**
   * Adds a platform-launcher relation.
   *
   * @param platformId - The platform id.
   * @param launcherId - The launcher id.
   * @returns A promise that resolves when the operation completes.
   */
  async addPlatformLauncherRelation(platformId: string, launcherId: string) {
    if (!platformId) {
      throw new BadRequestException('Platform ID is required');
    }

    if (!launcherId) {
      throw new BadRequestException('Launcher ID is required');
    }

    // `save()` and `insert()` write the join columns from the relation
    // objects. Those are unset here, so either call stores null foreign keys
    // and collides with the global default row. The foreign keys are written
    // as parameters instead.
    try {
      await this._platformLauncherRepository.query(
        `INSERT INTO ${this.tableName()} ("id", "platformId", "launcherId", "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now())`,
        [randomUUID(), platformId, launcherId],
      );

      return { platformId, launcherId } as PlatformLauncherEntity;
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        'Failed to add new platform-launcher relation',
        { cause: error },
      );
    }
  }

  /**
   * Makes sure a mapping row exists and has a background picture.
   *
   * A row that has no picture is given this one; a row that has one keeps
   * it, so a picture somebody changed by hand is never put back. A missing
   * row is created with it. Either id may be null, for a platform default, a
   * launcher default or the global default.
   *
   * A removed row counts as present, so it is left removed: its unique index
   * covers removed rows too, and a second row could not be added beside it.
   *
   * @param platformId - The platform, or null for any.
   * @param launcherId - The launcher, or null for any.
   * @param backgroundImageUrl - The picture to give it.
   * @returns Whether the row was created, given the picture, or kept as it
   * was.
   */
  async ensureBackground(
    platformId: string | null,
    launcherId: string | null,
    backgroundImageUrl: string,
  ): Promise<'created' | 'filled' | 'kept'> {
    const existing = await this._platformLauncherRepository.findOne({
      where: {
        platformId: platformId ?? IsNull(),
        launcherId: launcherId ?? IsNull(),
      },
      withDeleted: true,
    });

    if (existing === null) {
      // Written as parameters, as in `addPlatformLauncherRelation`.
      await this._platformLauncherRepository.query(
        `INSERT INTO ${this.tableName()} ("id", "platformId", "launcherId", "backgroundImageUrl", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, now(), now())`,
        [randomUUID(), platformId, launcherId, backgroundImageUrl],
      );

      return 'created';
    }

    if (existing.backgroundImageUrl) {
      return 'kept';
    }

    // Still empty when written, in case another instance filled it first.
    await this._platformLauncherRepository.query(
      `UPDATE ${this.tableName()} SET "backgroundImageUrl" = $1, "updatedAt" = now() WHERE "id" = $2 AND "backgroundImageUrl" IS NULL`,
      [backgroundImageUrl, existing.id],
    );

    return 'filled';
  }

  /**
   * The mapping table's name, with its schema when it has one.
   *
   * @returns The quoted name, for raw SQL.
   */
  private tableName(): string {
    const metadata = this._platformLauncherRepository.metadata;

    return metadata.schema
      ? `"${metadata.schema}"."${metadata.tableName}"`
      : `"${metadata.tableName}"`;
  }

  /**
   * Removes a platform-launcher relation.
   *
   * @param platformId - The platform id.
   * @param launcherId - The launcher id.
   * @returns A promise that resolves when the operation completes.
   */
  async removePlatformLauncherRelation(platformId: string, launcherId: string) {
    if (!platformId) {
      throw new BadRequestException('Platform ID is required');
    }

    if (!launcherId) {
      throw new BadRequestException('Launcher ID is required');
    }

    const platformLauncher = await this._platformLauncherRepository.findOne({
      where: { platformId: platformId, launcherId: launcherId },
    });
    if (!platformLauncher) {
      throw new NotFoundException(`PlatformLauncherEntity relation not found`);
    }
    try {
      await this._platformLauncherRepository.remove(platformLauncher);
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        'Failed to remove platform-launcher relation',
        { cause: error },
      );
    }
  }

  /**
   * Finds all.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async findAll(): Promise<PlatformLauncherEntity[]> {
    const relations = await this._platformLauncherRepository.find({
      relations: { platform: true, launcher: true },
    });

    return relations.map(relation => this.sanitizeBackgroundImageUrl(relation));
  }

  /**
   * Finds all launchers for the given platform.
   *
   * @param platformId - The platform id.
   * @returns A promise that resolves when the operation completes.
   */
  async findAllLaunchersForPlatform(
    platformId: string,
  ): Promise<PlatformLauncherEntity[]> {
    if (!platformId) {
      throw new BadRequestException('Platform ID is required');
    }

    const launchers = await this._platformLauncherRepository.find({
      where: { platformId: platformId },
    });
    return launchers.map(relation => this.sanitizeBackgroundImageUrl(relation));
  }

  /**
   * Finds one.
   *
   * @param platformId - The platform id.
   * @param launcherId - The launcher id.
   * @returns A promise that resolves when the operation completes.
   */
  async findOne(
    platformId: string,
    launcherId: string,
  ): Promise<PlatformLauncherEntity> {
    if (!platformId) {
      throw new BadRequestException('Platform ID is required');
    }

    if (!launcherId) {
      throw new BadRequestException('Launcher ID is required');
    }

    const platformLauncher = await this._platformLauncherRepository.findOne({
      where: { platformId: platformId, launcherId: launcherId },
    });

    if (!platformLauncher) {
      throw new NotFoundException(`PlatformLauncherEntity relation not found`);
    }

    return this.sanitizeBackgroundImageUrl(platformLauncher);
  }
}
