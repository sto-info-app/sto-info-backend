import { Module } from '@nestjs/common';

import { CharacterAdmiraltyModule } from 'src/sto/character-admiralty/character-admiralty.module';
import { CharacterCommendationModule } from 'src/sto/character-commendation/character-commendation.module';
import { CharacterRdModule } from 'src/sto/character-rd/character-rd.module';
import { CharacterReputationModule } from 'src/sto/character-reputation/character-reputation.module';
import { CharacterSpecializationModule } from 'src/sto/character-specialization/character-specialization.module';

import { CharacterOverviewController } from './character-overview.controller';
import { CharacterOverviewService } from './character-overview.service';

@Module({
  imports: [
    CharacterReputationModule,
    CharacterRdModule,
    CharacterSpecializationModule,
    CharacterAdmiraltyModule,
    CharacterCommendationModule,
  ],
  controllers: [CharacterOverviewController],
  providers: [CharacterOverviewService],
})
export class CharacterOverviewModule {}
