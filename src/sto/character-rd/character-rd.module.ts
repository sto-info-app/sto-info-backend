import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CharacterModule } from 'src/sto/character/character.module';
import { CharacterRdProgressEntity } from './entities/character-rd-progress.entity';
import { CharacterRdSchoolEntity } from './entities/character-rd-school.entity';
import { CharacterRdController } from './character-rd.controller';
import { CharacterRdService } from './character-rd.service';

@Module({
  imports: [
    CharacterModule,
    TypeOrmModule.forFeature([
      CharacterRdSchoolEntity,
      CharacterRdProgressEntity,
    ]),
  ],
  controllers: [CharacterRdController],
  providers: [CharacterRdService],
  exports: [CharacterRdService],
})
export class CharacterRdModule {}
