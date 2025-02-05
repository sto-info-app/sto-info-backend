import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateLauncherDto } from './dto/create-launcher.dto';
import { UpdateLauncherDto } from './dto/update-launcher.dto';
import { LauncherEntity } from './entities/launcher.entity';

@Injectable()
export class LauncherService {
  constructor(
    @InjectRepository(LauncherEntity)
    private readonly launcherRepository: Repository<LauncherEntity>,
  ) {}

  async findAll() {
    return await this.launcherRepository.find();
  }

  async findOne(id: string): Promise<LauncherEntity> {
    const launcher = await this.launcherRepository.findOne({
      where: {
        id: id,
      },
    });
    return launcher;
  }

  async findOneByName(name: string): Promise<LauncherEntity> {
    const launcher = await this.launcherRepository.findOne({
      where: { name: name },
    });
    return launcher;
  }

  async findAllSoftDeletedOlderThanOneWeek(): Promise<LauncherEntity[]> {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    return this.launcherRepository
      .createQueryBuilder('launcher')
      .where('launcher.deletedAt IS NOT NULL')
      .andWhere('launcher.deletedAt < :oneWeekAgo', { oneWeekAgo })
      .getMany();
  }

  async create(createLauncherDto: CreateLauncherDto): Promise<LauncherEntity> {
    const newLauncher = this.launcherRepository.create(createLauncherDto);
    try {
      await this.launcherRepository.save(newLauncher);
      return newLauncher;
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to save a new launcher',
        error,
      );
    }
  }

  async update(
    id: string,
    updateLauncherDto: UpdateLauncherDto,
  ): Promise<LauncherEntity> {
    const launcher = await this.findOne(id);
    const updatedLauncher = this.launcherRepository.merge(
      launcher,
      updateLauncherDto,
    );
    try {
      await this.launcherRepository.save(updatedLauncher);
      return updatedLauncher;
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to update launcher',
        error,
      );
    }
  }

  async remove(id: string): Promise<void> {
    const launcher = await this.findOne(id);
    try {
      await this.launcherRepository.remove(launcher);
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to delete launcher',
        error,
      );
    }
  }

  async softRemove(id: string): Promise<void> {
    const launcher = await this.findOne(id);
    try {
      await this.launcherRepository.softDelete(launcher.id);
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to soft delete launcher',
        error,
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async handleCron() {
    const launchers = await this.findAllSoftDeletedOlderThanOneWeek();
    for (const launcher of launchers) {
      try {
        await this.remove(launcher.id);
      } catch (error) {
        throw new InternalServerErrorException(
          `Failed to hard delete launcher #${launcher.id}`,
          error,
        );
      }
    }
  }
}
