import { validateDto } from '../../utils/testing/dto-validation.util';
import { PERMISSION_CODES } from '../constants/permission-codes.constants';
import { PermissionEffect } from '../enums/permission-effect.enum';
import { SetLimitOverrideDto } from './set-limit-override.dto';
import { SetPermissionOverrideDto } from './set-permission-override.dto';

/** A date comfortably in the future, for expiry tests. */
const futureDate = new Date(Date.now() + 86_400_000).toISOString();

describe('SetPermissionOverrideDto Validation', () => {
  const validPayload = {
    permissionCode: PERMISSION_CODES.STORYTIME_STORY_CREATE,
    effect: PermissionEffect.DENY,
    reason: 'Repeated policy breaches',
  };

  it('should accept a valid override', async () => {
    const { errors } = await validateDto(
      SetPermissionOverrideDto,
      validPayload,
    );

    expect(errors).toHaveLength(0);
  });

  it('should accept an override with a future expiry', async () => {
    const { errors } = await validateDto(SetPermissionOverrideDto, {
      ...validPayload,
      expiresAt: futureDate,
    });

    expect(errors).toHaveLength(0);
  });

  // An unrecognised code would store an override that no guard ever reads,
  // giving the appearance of a restriction that does nothing.
  it('should reject an unrecognised permission code', async () => {
    const { errors } = await validateDto(SetPermissionOverrideDto, {
      ...validPayload,
      permissionCode: 'storytime.make.me.an.admin',
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject an invalid effect', async () => {
    const { errors } = await validateDto(SetPermissionOverrideDto, {
      ...validPayload,
      effect: 'MAYBE',
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject a missing reason', async () => {
    const { errors } = await validateDto(SetPermissionOverrideDto, {
      permissionCode: PERMISSION_CODES.STORYTIME_STORY_CREATE,
      effect: PermissionEffect.DENY,
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  // Trimmed before validation, so whitespace cannot stand in for the reason
  // this field exists to capture.
  it('should reject a whitespace-only reason', async () => {
    const { errors } = await validateDto(SetPermissionOverrideDto, {
      ...validPayload,
      reason: '   ',
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('should trim the reason', async () => {
    const { dto } = await validateDto(SetPermissionOverrideDto, {
      ...validPayload,
      reason: '  Repeated policy breaches  ',
    });

    expect(dto.reason).toBe('Repeated policy breaches');
  });

  it('should reject a reason beyond the maximum length', async () => {
    const { errors } = await validateDto(SetPermissionOverrideDto, {
      ...validPayload,
      reason: 'x'.repeat(501),
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  // An expiry already in the past would create an override that never applies.
  it('should reject an expiry in the past', async () => {
    const { errors } = await validateDto(SetPermissionOverrideDto, {
      ...validPayload,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject unknown properties', async () => {
    const { errors } = await validateDto(SetPermissionOverrideDto, {
      ...validPayload,
      grantedByUserId: 'e6d3a1b2-0000-4000-8000-0000000000ad',
    });

    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('SetLimitOverrideDto Validation', () => {
  const validPayload = {
    limitKey: 'STORYTIME_MAX_STORIES_PER_USER',
    limitValue: 500,
    reason: 'Prolific creator',
  };

  it('should accept a valid exemption', async () => {
    const { errors } = await validateDto(SetLimitOverrideDto, validPayload);

    expect(errors).toHaveLength(0);
  });

  it('should accept a limit of zero', async () => {
    const { errors } = await validateDto(SetLimitOverrideDto, {
      ...validPayload,
      limitValue: 0,
    });

    expect(errors).toHaveLength(0);
  });

  it('should coerce a numeric string limit', async () => {
    const { dto, errors } = await validateDto(SetLimitOverrideDto, {
      ...validPayload,
      limitValue: '250',
    });

    expect(errors).toHaveLength(0);
    expect(dto.limitValue).toBe(250);
  });

  // A key that does not match a configuration variable name would store an
  // exemption that no limit check ever reads.
  it('should reject a lower-case limit key', async () => {
    const { errors } = await validateDto(SetLimitOverrideDto, {
      ...validPayload,
      limitKey: 'storytime_max_stories_per_user',
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject a limit key containing punctuation', async () => {
    const { errors } = await validateDto(SetLimitOverrideDto, {
      ...validPayload,
      limitKey: 'STORYTIME.MAX-STORIES',
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject a limit key that is too short', async () => {
    const { errors } = await validateDto(SetLimitOverrideDto, {
      ...validPayload,
      limitKey: 'AB',
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject a negative limit', async () => {
    const { errors } = await validateDto(SetLimitOverrideDto, {
      ...validPayload,
      limitValue: -1,
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject a fractional limit', async () => {
    const { errors } = await validateDto(SetLimitOverrideDto, {
      ...validPayload,
      limitValue: 2.5,
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  // The ceiling stops an accidental extra digit removing the protection these
  // limits exist to provide.
  it('should reject a limit beyond the permitted ceiling', async () => {
    const { errors } = await validateDto(SetLimitOverrideDto, {
      ...validPayload,
      limitValue: 100_001,
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject an expiry in the past', async () => {
    const { errors } = await validateDto(SetLimitOverrideDto, {
      ...validPayload,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('should accept an exemption with a future expiry', async () => {
    const { errors } = await validateDto(SetLimitOverrideDto, {
      ...validPayload,
      expiresAt: futureDate,
    });

    expect(errors).toHaveLength(0);
  });

  it('should reject a whitespace-only reason', async () => {
    const { errors } = await validateDto(SetLimitOverrideDto, {
      ...validPayload,
      reason: '   ',
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject unknown properties', async () => {
    const { errors } = await validateDto(SetLimitOverrideDto, {
      ...validPayload,
      userId: 'e6d3a1b2-0000-4000-8000-000000000001',
    });

    expect(errors.length).toBeGreaterThan(0);
  });
});
