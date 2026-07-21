import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { CharacterRdProgressEntity } from './entities/character-rd-progress.entity';
import { CharacterRdSchoolEntity } from './entities/character-rd-school.entity';
import { CharacterRdController } from './character-rd.controller';
import { CharacterRdService } from './character-rd.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CharacterRdSchoolEntity,
      CharacterRdProgressEntity,
      CharacterEntity,
    ]),
  ],
  controllers: [CharacterRdController],
  providers: [CharacterRdService],
  exports: [CharacterRdService],
})
export class CharacterRdModule {}
