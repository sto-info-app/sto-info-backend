/**
 * File upload configuration constants
 * Default Multer limits for file uploads across the application
 */

/**
 * Default Multer limits for image uploads
 */
export const DEFAULT_MULTER_LIMITS = {
  /**
   * Maximum file size in bytes (10MB by default, can be overridden by MAX_IMAGE_SIZE_IN_BYTES env var)
   */
  fileSize: 10485760,

  /**
   * Maximum field size in bytes (same as file size)
   */
  fieldSize: 10485760,

  /**
   * Maximum number of files allowed in a single upload
   */
  files: 1,

  /**
   * Maximum number of non-file fields allowed
   * Set to 0 to only allow file uploads without additional form data
   */
  fields: 0,

  /**
   * Maximum number of parts (multipart sections)
   * For a single file upload: field name + file = 2 parts
   */
  parts: 2,

  /**
   * Maximum number of header key-value pairs
   */
  headerPairs: 50,
};

/**
 * Allowed image MIME types for uploads
 */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpg',
  'image/jpeg',
] as const;

/**
 * Type representing allowed image MIME types
 */
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

/**
 * Type-safe check if a MIME type is allowed for image uploads
 * @param mimeType The MIME type to check
 * @returns True if the MIME type is allowed
 */
export function isAllowedImageMimeType(mimeType: string): boolean {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}
