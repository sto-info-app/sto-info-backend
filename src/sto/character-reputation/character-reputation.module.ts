import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { CharacterReputationProgressEntity } from './entities/character-reputation-progress.entity';
import { CharacterReputationEntity } from './entities/character-reputation.entity';
import { CharacterReputationController } from './character-reputation.controller';
import { CharacterReputationService } from './character-reputation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CharacterReputationEntity,
      CharacterReputationProgressEntity,
      CharacterEntity,
    ]),
  ],
  controllers: [CharacterReputationController],
  providers: [CharacterReputationService],
  exports: [CharacterReputationService],
})
export class CharacterReputationModule {}
