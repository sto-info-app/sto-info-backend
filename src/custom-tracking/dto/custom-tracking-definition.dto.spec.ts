import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import {
  CreateCustomTrackingFieldDto,
  UpdateCustomTrackingFieldDto,
} from './custom-tracking-field.dto';
import {
  CreateCustomTrackingSectionDto,
  UpdateCustomTrackingSectionDto,
} from './custom-tracking-section.dto';
import {
  CreateCustomTrackingTabDto,
  UpdateCustomTrackingTabDto,
} from './custom-tracking-tab.dto';

describe('inherited definition request validation', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };

  it.each([
    CreateCustomTrackingSectionDto,
    CreateCustomTrackingTabDto,
    CreateCustomTrackingFieldDto,
  ])(
    'preserves create defaults and validates inherited properties for %p',
    async Dto => {
      const dto = plainToInstance(Dto, {
        name: 'Reputation',
        ...(Dto === CreateCustomTrackingFieldDto
          ? { fieldType: CustomTrackingFieldType.INTEGER, configuration: {} }
          : {}),
      });
      expect(await validate(dto, options)).toEqual([]);
      expect(dto.description).toBeNull();
      expect(dto.publiclyVisible).toBe(false);
      dto.name = '';
      expect(
        (await validate(dto, options)).map(error => error.property),
      ).toContain('name');
    },
  );

  it.each([
    UpdateCustomTrackingSectionDto,
    UpdateCustomTrackingTabDto,
    UpdateCustomTrackingFieldDto,
  ])(
    'keeps omitted patch properties distinct from clearing them for %p',
    async Dto => {
      const absent = plainToInstance(Dto, {});
      expect(await validate(absent, options)).toEqual([]);
      expect(absent.name).toBeUndefined();
      expect(absent.description).toBeUndefined();
      expect(absent.publiclyVisible).toBeUndefined();
      const clear = plainToInstance(Dto, {
        description: null,
        publiclyVisible: false,
      });
      expect(await validate(clear, options)).toEqual([]);
      expect(clear.description).toBeNull();
      expect(clear.publiclyVisible).toBe(false);
      const invalid = plainToInstance(Dto, {
        name: 'x'.repeat(101),
        publiclyVisible: 'true',
        extra: true,
      });
      expect(
        (await validate(invalid, options)).map(error => error.property),
      ).toEqual(expect.arrayContaining(['name', 'publiclyVisible', 'extra']));
    },
  );
});
