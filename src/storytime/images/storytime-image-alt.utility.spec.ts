import { BadRequestException } from '@nestjs/common';
import { assertImageDescribable } from './storytime-image-alt.utility';

describe('assertImageDescribable', () => {
  it('allows wording to be corrected against an image that exists', () => {
    expect(() =>
      assertImageDescribable('image-1', 'The USS Ares at warp', 'banner'),
    ).not.toThrow();
  });

  it('allows an update that says nothing about the description', () => {
    expect(() =>
      assertImageDescribable(null, undefined, 'banner'),
    ).not.toThrow();
  });

  // Wording stored against an empty slot would describe nothing, and would
  // then be read out the moment an unrelated picture was uploaded into it.
  it('refuses a description when there is no image', () => {
    expect(() => assertImageDescribable(null, 'A ship', 'banner')).toThrow(
      new BadRequestException(
        'There is no banner to describe. Upload one first.',
      ),
    );
  });

  it('refuses a description when the image has been removed', () => {
    expect(() =>
      assertImageDescribable(undefined, 'A ship', 'profile image'),
    ).toThrow('There is no profile image to describe. Upload one first.');
  });
});
