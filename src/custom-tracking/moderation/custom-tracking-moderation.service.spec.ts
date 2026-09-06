import { Logger, NotFoundException } from '@nestjs/common';

import { jest } from '@jest/globals';
import { DataSource, EntityManager, IsNull } from 'typeorm';

import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingModerationLevel } from '../enums/custom-tracking-moderation-level.enum';
import { CustomTrackingModerationService } from './custom-tracking-moderation.service';

describe('CustomTrackingModerationService', () => {
  let service: CustomTrackingModerationService;
  let update: jest.Mock<(...args: unknown[]) => Promise<{ affected: number }>>;
  let findOne: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let manager: EntityManager;

  const suppressedAt = new Date('2026-09-05T10:00:00.000Z');

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    update = jest.fn(async () => ({ affected: 1 }));
    findOne = jest.fn(async () => ({
      id: 'section-1',
      name: 'Ship collection',
      suppressedAt,
      suppressedByUserId: 'admin-1',
    }));

    manager = { update, findOne } as unknown as EntityManager;

    service = new CustomTrackingModerationService({
      manager,
    } as unknown as DataSource);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('hides a section from everybody but its owner', async () => {
    await expect(
      service.suppress(
        CustomTrackingModerationLevel.SECTION,
        'section-1',
        'admin-1',
      ),
    ).resolves.toEqual({
      level: CustomTrackingModerationLevel.SECTION,
      id: 'section-1',
      name: 'Ship collection',
      suppressed: true,
      suppressedAt,
      suppressedByUserId: 'admin-1',
    });

    expect(update).toHaveBeenCalledWith(
      CustomTrackingSectionEntity,
      { id: 'section-1', deletedAt: IsNull() },
      expect.objectContaining({ suppressedByUserId: 'admin-1' }),
    );
  });

  it('acts on the table the level names', async () => {
    await service.suppress(CustomTrackingModerationLevel.TAB, 'tab-1', 'a');
    expect(update.mock.calls[0][0]).toBe(CustomTrackingTabEntity);

    await service.suppress(CustomTrackingModerationLevel.FIELD, 'f-1', 'a');
    expect(update.mock.calls[1][0]).toBe(CustomTrackingFieldEntity);
  });

  it('clears both the timestamp and the administrator when restoring', async () => {
    findOne.mockResolvedValue({
      id: 'section-1',
      name: 'Ship collection',
      suppressedAt: null,
      suppressedByUserId: null,
    });

    await expect(
      service.restore(
        CustomTrackingModerationLevel.SECTION,
        'section-1',
        'admin-1',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        suppressed: false,
        suppressedAt: null,
        suppressedByUserId: null,
      }),
    );

    expect(update).toHaveBeenCalledWith(
      CustomTrackingSectionEntity,
      { id: 'section-1', deletedAt: IsNull() },
      { suppressedAt: null, suppressedByUserId: null },
    );
  });

  // It is already invisible, and acting on it would record a decision that
  // changed nothing.
  it('refuses a row its owner has already deleted', async () => {
    update.mockResolvedValue({ affected: 0 });

    await expect(
      service.suppress(CustomTrackingModerationLevel.FIELD, 'field-1', 'a'),
    ).rejects.toThrow(NotFoundException);
  });

  // An administrator needs to be told what the row says, not what we asked it
  // to say — it is the row the public projection will consult.
  it('reports the row as it now stands', async () => {
    await service.suppress(CustomTrackingModerationLevel.SECTION, 's-1', 'a');

    expect(findOne.mock.invocationCallOrder[0]).toBeGreaterThan(
      update.mock.invocationCallOrder[0],
    );
  });
});
