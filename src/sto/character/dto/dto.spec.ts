import { emptyStringToUndefined } from './create-character-request.dto';
import { CreateCharacterDto } from './create-character.dto';

describe('DTO Transformations', () => {
  it('should transform empty strings to undefined', () => {
    expect(emptyStringToUndefined({ value: '' })).toBeUndefined();
    expect(emptyStringToUndefined({ value: 'some' })).toBe('some');
    expect(emptyStringToUndefined({ value: null })).toBeNull();
  });

  it('should be able to instantiate CreateCharacterDto', () => {
    const dto = new CreateCharacterDto();
    expect(dto).toBeDefined();
  });
});
