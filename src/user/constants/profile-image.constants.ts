/**
 * What a profile picture is recorded as in Cloudflare Images.
 *
 * Unchanged from the string the synchronous upload path passed, and it has
 * to stay unchanged: it is part of the custom identifier and the metadata of
 * every profile picture already stored, and an inventory that grouped images
 * by it would stop seeing the old ones.
 */
export const PROFILE_IMAGE_ENTITY_TAG = 'user';
