import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CharacterModule } from 'src/sto/character/character.module';

import { CharacterCommendationController } from './character-commendation.controller';
import { CharacterCommendationService } from './character-commendation.service';
import { CharacterCommendationProgressEntity } from './entities/character-commendation-progress.entity';
import { CharacterCommendationEntity } from './entities/character-commendation.entity';

@Module({
  imports: [
    CharacterModule,
    TypeOrmModule.forFeature([
      CharacterCommendationEntity,
      CharacterCommendationProgressEntity,
    ]),
  ],
  controllers: [CharacterCommendationController],
  providers: [CharacterCommendationService],
  exports: [CharacterCommendationService],
})
export class CharacterCommendationModule {}
