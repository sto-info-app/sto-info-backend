/** A picture format's leading bytes, as the worker recognises them. */
interface ImageSignature {
  readonly contentType: string;
  readonly offset: number;
  readonly marker: readonly number[];
}

/**
 * The picture formats the scan worker's sniffer recognises, with the same
 * markers (its `src/quarantine/content-sniff.ts`), so a declaration made here
 * is one the worker will hold to.
 */
const IMAGE_SIGNATURES: readonly ImageSignature[] = [
  { contentType: 'image/png', offset: 0, marker: [0x89, 0x50, 0x4e, 0x47] },
  { contentType: 'image/jpeg', offset: 0, marker: [0xff, 0xd8, 0xff] },
  { contentType: 'image/gif', offset: 0, marker: [0x47, 0x49, 0x46, 0x38] },
  { contentType: 'image/webp', offset: 8, marker: [0x57, 0x45, 0x42, 0x50] },
  { contentType: 'image/bmp', offset: 0, marker: [0x42, 0x4d] },
];

/** What is declared for bytes that are no picture the worker knows. */
export const UNKNOWN_CONTENT_TYPE = 'application/octet-stream';

/**
 * What a rescan declares a picture to be (FC-041).
 *
 * A legacy picture never had a declared type, so one is read off its bytes.
 * Anything the worker would not recognise is declared as unknown, which the
 * worker refuses as a mismatch: a policy refusal, reported and left showing.
 *
 * @param bytes - The picture.
 * @returns Its media type.
 */
export function declaredTypeOf(bytes: Buffer): string {
  const found = IMAGE_SIGNATURES.find(
    signature =>
      bytes.length >= signature.offset + signature.marker.length &&
      signature.marker.every(
        (byte, index) => bytes[signature.offset + index] === byte,
      ),
  );

  return found?.contentType ?? UNKNOWN_CONTENT_TYPE;
}
