import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CharacterModule } from 'src/sto/character/character.module';

import { CharacterAdmiraltyController } from './character-admiralty.controller';
import { CharacterAdmiraltyService } from './character-admiralty.service';
import { CharacterAdmiraltyCampaignEntity } from './entities/character-admiralty-campaign.entity';
import { CharacterAdmiraltyProgressEntity } from './entities/character-admiralty-progress.entity';

@Module({
  imports: [
    CharacterModule,
    TypeOrmModule.forFeature([
      CharacterAdmiraltyCampaignEntity,
      CharacterAdmiraltyProgressEntity,
    ]),
  ],
  controllers: [CharacterAdmiraltyController],
  providers: [CharacterAdmiraltyService],
  exports: [CharacterAdmiraltyService],
})
export class CharacterAdmiraltyModule {}
