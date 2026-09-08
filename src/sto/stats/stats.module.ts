import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterRankEntity } from 'src/sto/character/entities/character-rank.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { AccountEndeavourProgressEntity } from 'src/sto/endeavour/entities/account-endeavour-progress.entity';
import { EndeavourPerkEntity } from 'src/sto/endeavour/entities/endeavour-perk.entity';

import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccountEntity,
      CharacterEntity,
      CharacterRankEntity,
      AccountEndeavourProgressEntity,
      EndeavourPerkEntity,
    ]),
  ],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
