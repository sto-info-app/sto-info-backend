import { Entity, Index, OneToMany } from 'typeorm';

import { CatalogItemEntity } from 'src/sto/shared/entities/catalog-item.entity';

import { CharacterRdProgressEntity } from './character-rd-progress.entity';

/** The maximum level a character can attain in an R&D school. */
export const RD_MAX_LEVEL = 20;

@Entity({ name: 'character_rd_school' })
@Index('UX_character_rd_school_name', ['name'], { unique: true })
export class CharacterRdSchoolEntity extends CatalogItemEntity {
  @OneToMany(
    'CharacterRdProgressEntity',
    (progress: CharacterRdProgressEntity) => progress.school,
  )
  characterProgress: CharacterRdProgressEntity[];
}
