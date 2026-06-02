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
  /**
   * Creates an instance of PlatformService.
   *
   * @param platformRepository - The platform repository.
   */
  constructor(
    @InjectRepository(PlatformEntity)
    private readonly platformRepository: Repository<PlatformEntity>,
  ) {}

  /**
   * Finds all.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async findAll() {
    return await this.platformRepository.find();
  }

  /**
   * Finds one.
   *
   * @param id - The id.
   * @returns A promise that resolves when the operation completes.
   */
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

  /**
   * Finds a record by name.
   *
   * @param name - The name.
   * @returns A promise that resolves when the operation completes.
   */
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

  /**
   * Finds records soft-deleted more than one week ago.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async findAllSoftDeletedOlderThanOneWeek(): Promise<PlatformEntity[]> {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    return this.platformRepository
      .createQueryBuilder('platform')
      .where('platform.deletedAt IS NOT NULL')
      .andWhere('platform.deletedAt < :oneWeekAgo', { oneWeekAgo })
      .getMany();
  }

  /**
   * Creates the value.
   *
   * @param createPlatformDto - The create platform dto.
   * @returns A promise that resolves when the operation completes.
   */
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

  /**
   * Updates the value.
   *
   * @param id - The id.
   * @param updatePlatformDto - The update platform dto.
   * @returns A promise that resolves when the operation completes.
   */
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

  /**
   * Removes the value.
   *
   * @param id - The id.
   */
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

  /**
   * Handles soft remove.
   *
   * @param id - The id.
   */
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
  /**
   * Runs the scheduled cron job.
   *
   * @returns A promise that resolves when the operation completes.
   */
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
