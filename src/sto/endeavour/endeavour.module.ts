import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountEntity } from 'src/sto/account/entities/account.entity';

import { EndeavourController } from './endeavour.controller';
import { EndeavourService } from './endeavour.service';
import { AccountEndeavourProgressEntity } from './entities/account-endeavour-progress.entity';
import { EndeavourPerkEntity } from './entities/endeavour-perk.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EndeavourPerkEntity,
      AccountEndeavourProgressEntity,
      AccountEntity,
    ]),
  ],
  controllers: [EndeavourController],
  providers: [EndeavourService],
  exports: [EndeavourService],
})
export class EndeavourModule {}
