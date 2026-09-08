import { BadRequestException } from '@nestjs/common';

/**
 * Requires that there is an image for a description to belong to.
 *
 * Alternative text arrives with the upload, so an editor form can only ever be
 * correcting wording that is already there. Accepting a description for an
 * empty slot would store text that describes nothing, and which would then be
 * read out the moment somebody uploaded an unrelated picture into that slot.
 *
 * @param imageId - The image the description belongs to, if there is one.
 * @param altText - The description being set, or undefined when unchanged.
 * @param label - What the slot is called, for the message.
 * @throws BadRequestException when there is no image to describe.
 */
export function assertImageDescribable(
  imageId: string | null | undefined,
  altText: string | undefined,
  label: string,
): void {
  if (altText !== undefined && !imageId) {
    throw new BadRequestException(
      `There is no ${label} to describe. Upload one first.`,
    );
  }
}
