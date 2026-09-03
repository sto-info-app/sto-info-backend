import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CharacterModule } from 'src/sto/character/character.module';

import { CharacterReputationController } from './character-reputation.controller';
import { CharacterReputationService } from './character-reputation.service';
import { CharacterReputationProgressEntity } from './entities/character-reputation-progress.entity';
import { CharacterReputationEntity } from './entities/character-reputation.entity';

@Module({
  imports: [
    CharacterModule,
    TypeOrmModule.forFeature([
      CharacterReputationEntity,
      CharacterReputationProgressEntity,
    ]),
  ],
  controllers: [CharacterReputationController],
  providers: [CharacterReputationService],
  exports: [CharacterReputationService],
})
export class CharacterReputationModule {}
