import { BadRequestException, ParseEnumPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ROLES_KEY } from 'src/auth/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FeatureSwitch } from './feature-switch.constants';
import { FeatureSwitchDto, SetFeatureSwitchDto } from './feature-switch.dto';
import { FeatureSwitchesController } from './feature-switches.controller';
import { FeatureSwitchesService } from './feature-switches.service';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

describe('FeatureSwitchesController', () => {
  const fleet: FeatureSwitchDto = {
    feature: FeatureSwitch.FLEET_COMMUNITIES,
    label: 'Fleet Communities',
    isEnabled: true,
    changedAt: new Date('2026-10-06T09:00:00.000Z'),
    changedByUsername: 'Steve',
    subFlags: [],
  };

  let list: jest.Mock<() => Promise<FeatureSwitchDto[]>>;
  let set: jest.Mock<
    (
      feature: FeatureSwitch,
      isEnabled: boolean,
      adminUserId: string,
      reason: string,
    ) => Promise<FeatureSwitchDto>
  >;
  let controller: FeatureSwitchesController;

  beforeEach(() => {
    list = jest.fn(() => Promise.resolve([fleet]));
    set = jest.fn(() => Promise.resolve(fleet));
    controller = new FeatureSwitchesController({
      list,
      set,
    } as unknown as FeatureSwitchesService);
  });

  it('lists the switches', async () => {
    await expect(controller.list()).resolves.toEqual([fleet]);
  });

  it('throws a switch, with the site admin and their reason', async () => {
    await expect(
      controller.set(
        FeatureSwitch.FLEET_COMMUNITIES,
        { isEnabled: true, reason: 'Accepted' },
        ADMIN_ID,
      ),
    ).resolves.toBe(fleet);
    expect(set).toHaveBeenCalledWith(
      FeatureSwitch.FLEET_COMMUNITIES,
      true,
      ADMIN_ID,
      'Accepted',
    );
  });

  it('is for administrators only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, FeatureSwitchesController)).toEqual([
      UserRole.ADMIN,
    ]);
  });

  it('takes only a feature it has a switch for', async () => {
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      FeatureSwitchesController,
      'set',
    ) as Record<string, { data: string; pipes: unknown[] }>;
    const param = Object.values(args).find(arg => arg.data === 'feature')!;
    const pipe = param.pipes[0] as ParseEnumPipe;

    expect(pipe).toBeInstanceOf(ParseEnumPipe);
    await expect(pipe.transform('STORYTIME', { type: 'param' })).resolves.toBe(
      'STORYTIME',
    );
    await expect(
      pipe.transform('NEWS', { type: 'param' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SetFeatureSwitchDto', () => {
  /**
   * Validates a body as the API's pipe would.
   *
   * @param body - The body.
   * @returns The properties that failed.
   */
  async function failing(body: object): Promise<string[]> {
    const errors = await validate(plainToInstance(SetFeatureSwitchDto, body));

    return errors.map(error => error.property);
  }

  it('takes on or off and a reason', async () => {
    await expect(
      failing({ isEnabled: false, reason: 'Incident 12' }),
    ).resolves.toEqual([]);
  });

  it('needs a reason that is more than spaces', async () => {
    await expect(failing({ isEnabled: true })).resolves.toEqual(['reason']);
    await expect(failing({ isEnabled: true, reason: '   ' })).resolves.toEqual([
      'reason',
    ]);
  });

  it('needs on or off as a boolean, not a word', async () => {
    await expect(
      failing({ isEnabled: 'true', reason: 'Accepted' }),
    ).resolves.toEqual(['isEnabled']);
  });
});
