/**
 * How a Custom Tracking picture is identified to the asset registry.
 *
 * The only subject in the registry whose identifier is not one row's primary
 * key, and it cannot be: a picture answers a Field for a record, and the row
 * that will hold it does not exist until the picture is published. The pair
 * is what a placement has to be keyed by, so the pair is what it stores.
 *
 * The same spelling Cloudflare already records these under, which keeps one
 * composite identifier in the system rather than two.
 *
 * @param fieldId - The image Field.
 * @param targetId - The Account or Character described.
 * @returns The subject identifier.
 */
export function customTrackingSubjectId(
  fieldId: string,
  targetId: string,
): string {
  return `${fieldId}:${targetId}`;
}
