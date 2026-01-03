import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountEntity } from '../account/entities/account.entity';
import { CharacterController } from './character.controller';
import { CharacterService } from './character.service';
import { CharacterClassEntity } from './entities/character-class.entity';
import { CharacterEntity } from './entities/character.entity';
import { FactionEntity } from './entities/faction.entity';
import { GeneralFactionEntity } from './entities/general-faction.entity';
import { RecruitTypeEntity } from './entities/recruit-type.entity';
import { SexEntity } from './entities/sex.entity';
import { SpeciesEntity } from './entities/species.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CharacterEntity,
      AccountEntity,
      GeneralFactionEntity,
      FactionEntity,
      SexEntity,
      CharacterClassEntity,
      RecruitTypeEntity,
      SpeciesEntity,
    ]),
  ],
  controllers: [CharacterController],
  providers: [CharacterService],
  exports: [CharacterService],
})
export class CharacterModule {}
