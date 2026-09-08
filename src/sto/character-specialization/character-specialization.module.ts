import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CharacterModule } from 'src/sto/character/character.module';

import { CharacterSpecializationController } from './character-specialization.controller';
import { CharacterSpecializationService } from './character-specialization.service';
import { CharacterSpecializationProgressEntity } from './entities/character-specialization-progress.entity';
import { CharacterSpecializationEntity } from './entities/character-specialization.entity';

@Module({
  imports: [
    CharacterModule,
    TypeOrmModule.forFeature([
      CharacterSpecializationEntity,
      CharacterSpecializationProgressEntity,
    ]),
  ],
  controllers: [CharacterSpecializationController],
  providers: [CharacterSpecializationService],
  exports: [CharacterSpecializationService],
})
export class CharacterSpecializationModule {}
