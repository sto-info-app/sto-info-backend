import { jest } from '@jest/globals';

import { Roles } from 'src/auth/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import {
  CustomTrackingDefinitionTreeService,
  CustomTrackingSectionNode,
} from '../definitions/custom-tracking-definition-tree.service';
import { CustomTrackingDefinitionMapper } from '../definitions/custom-tracking-definition.mapper';
import { CustomTrackingSuppressionDto } from '../dto/custom-tracking-moderation.dto';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingModerationLevel } from '../enums/custom-tracking-moderation-level.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingModerationController } from './custom-tracking-moderation.controller';
import { CustomTrackingModerationService } from './custom-tracking-moderation.service';

describe('CustomTrackingModerationController', () => {
  let controller: CustomTrackingModerationController;
  let suppress: jest.Mock<() => Promise<CustomTrackingSuppressionDto>>;
  let restore: jest.Mock<() => Promise<CustomTrackingSuppressionDto>>;
  let load: jest.Mock<() => Promise<CustomTrackingSectionNode[]>>;

  const outcome: CustomTrackingSuppressionDto = {
    level: CustomTrackingModerationLevel.SECTION,
    id: 'section-1',
    name: 'Ship collection',
    suppressed: true,
    suppressedAt: new Date('2026-09-05T10:00:00.000Z'),
    suppressedByUserId: 'admin-1',
  };

  const node: CustomTrackingSectionNode = {
    section: {
      id: 'section-1',
      targetScope: CustomTrackingTargetScope.ACCOUNT,
      name: 'Ship collection',
      description: null,
      orderIndex: 1000,
      publiclyVisible: true,
      suppressedAt: null,
    } as CustomTrackingSectionEntity,
    tabs: [],
  };

  beforeEach(() => {
    suppress = jest
      .fn<() => Promise<CustomTrackingSuppressionDto>>()
      .mockResolvedValue(outcome);
    restore = jest
      .fn<() => Promise<CustomTrackingSuppressionDto>>()
      .mockResolvedValue({ ...outcome, suppressed: false });
    load = jest
      .fn<() => Promise<CustomTrackingSectionNode[]>>()
      .mockResolvedValue([node]);

    controller = new CustomTrackingModerationController(
      { suppress, restore } as unknown as CustomTrackingModerationService,
      { load } as unknown as CustomTrackingDefinitionTreeService,
      new CustomTrackingDefinitionMapper(),
    );
  });

  // Suppression changes what everybody but the owner can see. There is no
  // reading of this that a member should be able to reach.
  it('is closed to everybody but an administrator', () => {
    expect(
      Reflect.getMetadata('roles', CustomTrackingModerationController),
    ).toEqual([UserRole.ADMIN]);
    expect(Roles).toBeDefined();
  });

  // You cannot suppress what you cannot address.
  it('lists what a member has defined so it can be named', async () => {
    await expect(
      controller.findTree(CustomTrackingTargetScope.ACCOUNT, 'owner-1'),
    ).resolves.toEqual([expect.objectContaining({ id: 'section-1' })]);

    expect(load).toHaveBeenCalledWith(
      'owner-1',
      CustomTrackingTargetScope.ACCOUNT,
    );
  });

  it('suppresses what an administrator names', async () => {
    await expect(
      controller.suppress(
        'admin-1',
        CustomTrackingModerationLevel.FIELD,
        'field-1',
      ),
    ).resolves.toEqual(outcome);

    expect(suppress).toHaveBeenCalledWith(
      CustomTrackingModerationLevel.FIELD,
      'field-1',
      'admin-1',
    );
  });

  it('restores what an administrator names', async () => {
    await expect(
      controller.restore(
        'admin-1',
        CustomTrackingModerationLevel.SECTION,
        'section-1',
      ),
    ).resolves.toEqual(expect.objectContaining({ suppressed: false }));

    expect(restore).toHaveBeenCalledWith(
      CustomTrackingModerationLevel.SECTION,
      'section-1',
      'admin-1',
    );
  });
});
