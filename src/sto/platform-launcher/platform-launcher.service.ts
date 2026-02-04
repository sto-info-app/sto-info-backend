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
  constructor(
    @InjectRepository(PlatformLauncherEntity)
    private readonly platformLauncherRepository: Repository<PlatformLauncherEntity>,
  ) {}

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
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to add new platform-launcher relation',
        error,
      );
    }
  }

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
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to remove platform-launcher relation',
        error,
      );
    }
  }

  async findAll(): Promise<PlatformLauncherEntity[]> {
    return await this.platformLauncherRepository.find({
      relations: ['platform', 'launcher'],
    });
  }

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
    return platformLauncher;
  }
}
