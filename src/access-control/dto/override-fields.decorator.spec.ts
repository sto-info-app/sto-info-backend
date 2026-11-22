import { validateDto } from '../../utils/testing/dto-validation.util';
import {
  OVERRIDE_REASON_MAX_LENGTH,
  OverrideExpiryProperty,
  OverrideReasonProperty,
  trimOverrideReason,
} from './override-fields.decorator';

/** Swagger's per-property metadata key, as `@ApiProperty` writes it. */
const API_MODEL_PROPERTIES = 'swagger/apiModelProperties';

class OverrideFields {
  @OverrideReasonProperty('Why.')
  readonly reason: string;

  @OverrideExpiryProperty('When it lapses.')
  readonly expiresAt?: Date;
}

/**
 * A moment comfortably in the future, derived from now so the spec never
 * ages into a failure.
 *
 * @returns The moment, as an ISO string.
 */
const tomorrow = (): string => new Date(Date.now() + 86_400_000).toISOString();

const documented = (propertyName: string): unknown =>
  Reflect.getMetadata(
    API_MODEL_PROPERTIES,
    OverrideFields.prototype,
    propertyName,
  );

describe('override field decorators', () => {
  it('accepts a reason with no expiry', async () => {
    const { errors } = await validateDto(OverrideFields, { reason: 'Abuse' });

    expect(errors).toHaveLength(0);
  });

  it('trims the reason before it is checked', async () => {
    const { dto, errors } = await validateDto(OverrideFields, {
      reason: '  Abuse  ',
    });

    expect(errors).toHaveLength(0);
    expect(dto.reason).toBe('Abuse');
  });

  it('refuses a reason that is only whitespace', async () => {
    const { errors } = await validateDto(OverrideFields, { reason: '   ' });

    expect(Object.keys(errors[0].constraints ?? {})).toEqual(['isNotEmpty']);
  });

  it('refuses a reason longer than the column holds', async () => {
    const { errors } = await validateDto(OverrideFields, {
      reason: 'x'.repeat(OVERRIDE_REASON_MAX_LENGTH + 1),
    });

    expect(Object.keys(errors[0].constraints ?? {})).toEqual(['maxLength']);
  });

  it('leaves a reason that is not a string to the validators', async () => {
    expect(trimOverrideReason({ value: 7 })).toBe(7);

    const { errors } = await validateDto(OverrideFields, { reason: 7 });

    expect(errors[0].constraints).toEqual(
      expect.objectContaining({ isString: expect.any(String) }),
    );
  });

  it('turns a future expiry into a date', async () => {
    const { dto, errors } = await validateDto(OverrideFields, {
      reason: 'Abuse',
      expiresAt: tomorrow(),
    });

    expect(errors).toHaveLength(0);
    expect(dto.expiresAt).toBeInstanceOf(Date);
  });

  it('refuses an expiry in the past', async () => {
    const { errors } = await validateDto(OverrideFields, {
      reason: 'Abuse',
      expiresAt: '2000-01-01T00:00:00Z',
    });

    expect(errors[0].constraints).toEqual({
      minDate: 'expiresAt must be in the future',
    });
  });

  it('documents the reason as required and the expiry as optional', () => {
    expect(documented('reason')).toEqual(
      expect.objectContaining({
        description: 'Why.',
        maxLength: OVERRIDE_REASON_MAX_LENGTH,
      }),
    );
    expect(documented('expiresAt')).toEqual(
      expect.objectContaining({
        description: 'When it lapses.',
        required: false,
      }),
    );
  });
});
