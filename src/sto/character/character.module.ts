import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AssetIngressModule } from 'src/file-assets/asset-ingress.module';
import { SharedModule } from 'src/shared/shared.module';

import { AccountEntity } from '../account/entities/account.entity';
import { CharacterOwnershipService } from './character-ownership.service';
import { CharacterController } from './character.controller';
import { CharacterService } from './character.service';
import { CharacterClassEntity } from './entities/character-class.entity';
import { CharacterRankEntity } from './entities/character-rank.entity';
import { CharacterEntity } from './entities/character.entity';
import { FactionEntity } from './entities/faction.entity';
import { GeneralFactionEntity } from './entities/general-faction.entity';
import { RecruitTypeEntity } from './entities/recruit-type.entity';
import { SexEntity } from './entities/sex.entity';
import { SpeciesEntity } from './entities/species.entity';
import { CharacterImagePublisher } from './images/character-image.publisher';

@Module({
  imports: [
    SharedModule,
    // A portrait is registered, quarantined and scanned before anybody sees
    // it, and published onto the Character afterwards.
    AssetIngressModule,
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
  providers: [
    CharacterService,
    CharacterOwnershipService,
    CharacterImagePublisher,
  ],
  exports: [CharacterService, CharacterOwnershipService],
})
export class CharacterModule {}
