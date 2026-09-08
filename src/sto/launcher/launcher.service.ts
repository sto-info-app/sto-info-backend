import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { CreateLauncherDto } from './dto/create-launcher.dto';
import { UpdateLauncherDto } from './dto/update-launcher.dto';
import { LauncherEntity } from './entities/launcher.entity';

@Injectable()
export class LauncherService {
  /**
   * Creates an instance of LauncherService.
   *
   * @param _launcherRepository - The launcher repository.
   */
  constructor(
    @InjectRepository(LauncherEntity)
    private readonly _launcherRepository: Repository<LauncherEntity>,
  ) {}

  /**
   * Finds all.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async findAll() {
    return await this._launcherRepository.find();
  }

  /**
   * Finds one.
   *
   * @param id - The id.
   * @returns A promise that resolves when the operation completes.
   */
  async findOne(id: string): Promise<LauncherEntity> {
    if (!id) {
      throw new BadRequestException('Launcher ID is required');
    }

    const launcher = await this._launcherRepository.findOne({
      where: {
        id: id,
      },
    });

    if (!launcher) {
      throw new NotFoundException('Launcher not found');
    }

    return launcher;
  }

  /**
   * Finds a record by name.
   *
   * @param name - The name.
   * @returns A promise that resolves when the operation completes.
   */
  async findOneByName(name: string): Promise<LauncherEntity> {
    if (!name) {
      throw new BadRequestException('Launcher name is required');
    }

    const launcher = await this._launcherRepository.findOne({
      where: { name: name },
    });

    if (!launcher) {
      throw new NotFoundException('Launcher not found');
    }

    return launcher;
  }

  /**
   * Finds records soft-deleted more than one week ago.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async findAllSoftDeletedOlderThanOneWeek(): Promise<LauncherEntity[]> {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    return this._launcherRepository
      .createQueryBuilder('launcher')
      .where('launcher.deletedAt IS NOT NULL')
      .andWhere('launcher.deletedAt < :oneWeekAgo', { oneWeekAgo })
      .getMany();
  }

  /**
   * Creates the value.
   *
   * @param createLauncherDto - The create launcher dto.
   * @returns A promise that resolves when the operation completes.
   */
  async create(createLauncherDto: CreateLauncherDto): Promise<LauncherEntity> {
    if (!createLauncherDto) {
      throw new BadRequestException('Launcher data is required');
    }

    const newLauncher = this._launcherRepository.create(createLauncherDto);
    try {
      await this._launcherRepository.save(newLauncher);
      return newLauncher;
    } catch (error: unknown) {
      throw new InternalServerErrorException('Failed to save a new launcher', {
        cause: error,
      });
    }
  }

  /**
   * Updates the value.
   *
   * @param id - The id.
   * @param updateLauncherDto - The update launcher dto.
   * @returns A promise that resolves when the operation completes.
   */
  async update(
    id: string,
    updateLauncherDto: UpdateLauncherDto,
  ): Promise<LauncherEntity> {
    if (!id) {
      throw new BadRequestException('Launcher ID is required');
    }

    if (!updateLauncherDto) {
      throw new BadRequestException('Update data is required');
    }

    const launcher = await this.findOne(id);
    const updatedLauncher = this._launcherRepository.merge(
      launcher,
      updateLauncherDto,
    );
    try {
      await this._launcherRepository.save(updatedLauncher);
      return updatedLauncher;
    } catch (error: unknown) {
      throw new InternalServerErrorException('Failed to update launcher', {
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
      throw new BadRequestException('Launcher ID is required');
    }

    const launcher = await this.findOne(id);
    try {
      await this._launcherRepository.remove(launcher);
    } catch (error: unknown) {
      throw new InternalServerErrorException('Failed to delete launcher', {
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
      throw new BadRequestException('Launcher ID is required');
    }

    const launcher = await this.findOne(id);
    try {
      await this._launcherRepository.softDelete(launcher.id);
    } catch (error: unknown) {
      throw new InternalServerErrorException('Failed to soft delete launcher', {
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
    const launchers = await this.findAllSoftDeletedOlderThanOneWeek();
    for (const launcher of launchers) {
      try {
        await this.remove(launcher.id);
      } catch (error: unknown) {
        throw new InternalServerErrorException(
          `Failed to hard delete launcher #${launcher.id}`,
          { cause: error },
        );
      }
    }
  }
}
