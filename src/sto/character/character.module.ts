import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { AccountEntity } from '../account/entities/account.entity';
import { CharacterController } from './character.controller';
import { CharacterOwnershipService } from './character-ownership.service';
import { CharacterService } from './character.service';
import { CharacterClassEntity } from './entities/character-class.entity';
import { CharacterRankEntity } from './entities/character-rank.entity';
import { CharacterEntity } from './entities/character.entity';
import { FactionEntity } from './entities/faction.entity';
import { GeneralFactionEntity } from './entities/general-faction.entity';
import { RecruitTypeEntity } from './entities/recruit-type.entity';
import { SexEntity } from './entities/sex.entity';
import { SpeciesEntity } from './entities/species.entity';

@Module({
  imports: [
    SharedModule,
    TypeOrmModule.forFeature([
      CharacterEntity,
      AccountEntity,
      GeneralFactionEntity,
      FactionEntity,
      SexEntity,
      CharacterClassEntity,
      RecruitTypeEntity,
      SpeciesEntity,
      CharacterRankEntity,
    ]),
  ],
  controllers: [CharacterController],
  providers: [CharacterService, CharacterOwnershipService],
  exports: [CharacterService, CharacterOwnershipService],
})
export class CharacterModule {}
