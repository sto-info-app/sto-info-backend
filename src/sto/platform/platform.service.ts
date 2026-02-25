import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreatePlatformDto } from './dto/create-platform.dto';
import { UpdatePlatformDto } from './dto/update-platform.dto';
import { PlatformEntity } from './entities/platform.entity';

@Injectable()
export class PlatformService {
  constructor(
    @InjectRepository(PlatformEntity)
    private readonly platformRepository: Repository<PlatformEntity>,
  ) {}

  async findAll() {
    return await this.platformRepository.find();
  }

  async findOne(id: string): Promise<PlatformEntity> {
    if (!id) {
      throw new BadRequestException('Platform ID is required');
    }

    const platform = await this.platformRepository.findOne({
      where: {
        id: id,
      },
    });

    if (!platform) {
      throw new NotFoundException('Platform not found');
    }

    return platform;
  }

  async findOneByName(name: string): Promise<PlatformEntity> {
    if (!name) {
      throw new BadRequestException('Platform name is required');
    }

    const platform = await this.platformRepository.findOne({
      where: { name: name },
    });

    if (!platform) {
      throw new NotFoundException('Platform not found');
    }

    return platform;
  }

  async findAllSoftDeletedOlderThanOneWeek(): Promise<PlatformEntity[]> {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    return this.platformRepository
      .createQueryBuilder('platform')
      .where('platform.deletedAt IS NOT NULL')
      .andWhere('platform.deletedAt < :oneWeekAgo', { oneWeekAgo })
      .getMany();
  }

  async create(createPlatformDto: CreatePlatformDto): Promise<PlatformEntity> {
    if (!createPlatformDto) {
      throw new BadRequestException('Platform data is required');
    }

    const newPlatform = this.platformRepository.create(createPlatformDto);
    try {
      await this.platformRepository.save(newPlatform);
      return newPlatform;
    } catch (error: unknown) {
      throw new InternalServerErrorException('Failed to save a new platform', {
        cause: error,
      });
    }
  }

  async update(
    id: string,
    updatePlatformDto: UpdatePlatformDto,
  ): Promise<PlatformEntity> {
    if (!id) {
      throw new BadRequestException('Platform ID is required');
    }

    if (!updatePlatformDto) {
      throw new BadRequestException('Update data is required');
    }

    const platform = await this.findOne(id);
    const updatedPlatform = this.platformRepository.merge(
      platform,
      updatePlatformDto,
    );
    try {
      await this.platformRepository.save(updatedPlatform);
      return updatedPlatform;
    } catch (error: unknown) {
      throw new InternalServerErrorException('Failed to update platform', {
        cause: error,
      });
    }
  }

  async remove(id: string): Promise<void> {
    if (!id) {
      throw new BadRequestException('Platform ID is required');
    }

    const platform = await this.findOne(id);
    try {
      await this.platformRepository.remove(platform);
    } catch (error: unknown) {
      throw new InternalServerErrorException('Failed to delete platform', {
        cause: error,
      });
    }
  }

  async softRemove(id: string): Promise<void> {
    if (!id) {
      throw new BadRequestException('Platform ID is required');
    }

    const platform = await this.findOne(id);
    try {
      await this.platformRepository.softDelete(platform.id);
    } catch (error: unknown) {
      throw new InternalServerErrorException('Failed to soft delete platform', {
        cause: error,
      });
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async handleCron() {
    const platforms = await this.findAllSoftDeletedOlderThanOneWeek();
    for (const platform of platforms) {
      try {
        await this.remove(platform.id);
      } catch (error: unknown) {
        throw new InternalServerErrorException(
          `Failed to hard delete platform #${platform.id}`,
          { cause: error },
        );
      }
    }
  }
}
