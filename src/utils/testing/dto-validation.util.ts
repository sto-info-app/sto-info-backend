import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

/**
 * Instantiates and validates a DTO from a plain payload.
 *
 * @param cls - The DTO class constructor.
 * @param plain - Raw input payload.
 * @returns The DTO instance and its validation errors.
 */
export async function validateDto<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): Promise<{ dto: T; errors: ValidationError[] }> {
  const dto = plainToInstance(cls, plain);
  const errors = await validate(dto);

  return { dto, errors };
}
