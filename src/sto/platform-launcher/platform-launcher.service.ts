import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformLauncherEntity } from './entities/platform-launcher.entity';

@Injectable()
export class PlatformLauncherService {
  /**
   * Creates an instance of PlatformLauncherService.
   *
   * @param platformLauncherRepository - The platform launcher repository.
   */
  constructor(
    @InjectRepository(PlatformLauncherEntity)
    private readonly platformLauncherRepository: Repository<PlatformLauncherEntity>,
  ) {}

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

    const platformLauncher = new PlatformLauncherEntity();
    platformLauncher.platformId = platformId;
    platformLauncher.launcherId = launcherId;
    try {
      await this.platformLauncherRepository.save(platformLauncher);
      return platformLauncher;
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        'Failed to add new platform-launcher relation',
        { cause: error },
      );
    }
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

    const platformLauncher = await this.platformLauncherRepository.findOne({
      where: { platformId: platformId, launcherId: launcherId },
    });
    if (!platformLauncher) {
      throw new NotFoundException(`PlatformLauncherEntity relation not found`);
    }
    try {
      await this.platformLauncherRepository.remove(platformLauncher);
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
    return await this.platformLauncherRepository.find({
      relations: { platform: true, launcher: true },
    });
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

    const launchers = await this.platformLauncherRepository.find({
      where: { platformId: platformId },
    });
    return launchers;
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

    const platformLauncher = await this.platformLauncherRepository.findOne({
      where: { platformId: platformId, launcherId: launcherId },
    });

    if (!platformLauncher) {
      throw new NotFoundException(`PlatformLauncherEntity relation not found`);
    }

    return platformLauncher;
  }
}
