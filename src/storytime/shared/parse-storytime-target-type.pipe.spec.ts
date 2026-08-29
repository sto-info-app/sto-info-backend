import { BadRequestException } from '@nestjs/common';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { ParseStorytimeTargetTypePipe } from './parse-storytime-target-type.pipe';

describe('ParseStorytimeTargetTypePipe', () => {
  let pipe: ParseStorytimeTargetTypePipe;

  beforeEach(() => {
    pipe = new ParseStorytimeTargetTypePipe();
  });

  it('reads the lower case a URL carries', () => {
    expect(pipe.transform('story')).toBe(StorytimeTargetType.STORY);
  });

  // Links made before the routes were lowered still have to resolve.
  it('still reads the upper case the enum is written in', () => {
    expect(pipe.transform('STORY')).toBe(StorytimeTargetType.STORY);
  });

  it('reads a value with an underscore in it', () => {
    expect(pipe.transform('crew_credit')).toBe(StorytimeTargetType.CREW_CREDIT);
  });

  it.each(Object.values(StorytimeTargetType))('reads %s', targetType => {
    expect(pipe.transform(targetType.toLowerCase())).toBe(targetType);
  });

  it('refuses a segment that names nothing', () => {
    expect(() => pipe.transform('starship')).toThrow(BadRequestException);
  });

  it('refuses an empty segment', () => {
    expect(() => pipe.transform('')).toThrow(BadRequestException);
  });
});
