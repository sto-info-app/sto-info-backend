import { validate } from 'class-validator';

import {
  CharacterSpecializationEntity,
  SPECIALIZATION_PRIMARY_MAX_POINTS,
  SPECIALIZATION_SECONDARY_MAX_POINTS,
  SpecializationType,
} from './character-specialization.entity';

describe('CharacterSpecializationEntity', () => {
  const createSpecialization = (
    type: SpecializationType,
    maxPoints?: number,
  ): CharacterSpecializationEntity => {
    const specialization = new CharacterSpecializationEntity();
    specialization.name = 'Test Specialization';
    specialization.sortOrder = 0;
    specialization.type = type;

    if (maxPoints !== undefined) specialization.maxPoints = maxPoints;
    else specialization.setDefaultMaxPoints();

    return specialization;
  };

  it.each([
    ['primary', SPECIALIZATION_PRIMARY_MAX_POINTS],
    ['secondary', SPECIALIZATION_SECONDARY_MAX_POINTS],
  ] as const)('defaults %s specializations to %i points', (type, expected) => {
    expect(createSpecialization(type).maxPoints).toBe(expected);
  });

  it.each([
    ['primary', SPECIALIZATION_PRIMARY_MAX_POINTS],
    ['secondary', SPECIALIZATION_SECONDARY_MAX_POINTS],
  ] as const)(
    'accepts the maximum points for %s specializations',
    async (type, maximum) => {
      await expect(
        validate(createSpecialization(type, maximum)),
      ).resolves.toHaveLength(0);
    },
  );

  it.each([
    ['primary', SPECIALIZATION_PRIMARY_MAX_POINTS + 1],
    ['secondary', SPECIALIZATION_SECONDARY_MAX_POINTS + 1],
  ] as const)(
    'rejects points above the %s specialization limit',
    async (type, points) => {
      await expect(
        validate(createSpecialization(type, points)),
      ).resolves.not.toHaveLength(0);
    },
  );

  it.each(['primary', 'secondary'] as const)(
    'retains common point validation for %s specializations',
    async type => {
      await expect(
        validate(createSpecialization(type, 0)),
      ).resolves.not.toHaveLength(0);
      await expect(
        validate(createSpecialization(type, 1.5)),
      ).resolves.not.toHaveLength(0);
    },
  );
});
