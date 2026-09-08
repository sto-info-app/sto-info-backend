/**
 * What an image's own bytes say about it.
 */
export interface StorytimeImageContent {
  /** The encoding the bytes are actually in, whatever the request claimed. */
  readonly format: 'png' | 'jpeg';
  /** Width in pixels. */
  readonly width: number;
  /** Height in pixels. */
  readonly height: number;
}

/** The eight bytes every PNG begins with. */
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** Where the IHDR chunk's width lives, counting from the start of the file. */
const PNG_WIDTH_OFFSET = 16;

/** The shortest run of bytes that can carry a PNG header. */
const PNG_HEADER_LENGTH = 24;

/** The marker introducing every JPEG segment. */
const JPEG_MARKER_PREFIX = 0xff;

/** Start of image. */
const JPEG_START_OF_IMAGE = 0xd8;

/** End of image. */
const JPEG_END_OF_IMAGE = 0xd9;

/**
 * Segment markers that carry no length and no payload.
 *
 * `0x01` is a private marker and `0xd0`–`0xd7` are restart markers; both sit
 * on their own, so a reader that assumed a length after them would step into
 * the middle of the following segment.
 */
const JPEG_STANDALONE_MARKERS = new Set([
  0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7,
]);

/**
 * Markers in the start-of-frame range that are something else entirely.
 *
 * `0xc4`, `0xc8` and `0xcc` fall inside `0xc0`–`0xcf` but describe Huffman
 * tables, a JPEG extension and arithmetic coding conditioning rather than a
 * frame, so none of them carries the dimensions.
 */
const JPEG_NON_FRAME_MARKERS = new Set([0xc4, 0xc8, 0xcc]);

/**
 * Reads an image's format and dimensions from its own bytes.
 *
 * Deliberately independent of the declared content type. A request states its
 * own MIME type and a filename ends in whatever the person uploading chose, so
 * neither is evidence of anything; the signature at the head of the file is.
 * This is the check that stops something that is not an image at all being
 * passed along to storage because it arrived labelled as one.
 *
 * @param buffer - The raw uploaded bytes.
 * @returns What the bytes are, or null when they are not a PNG or a JPEG whose
 * dimensions can be read.
 */
export function readImageContent(buffer: Buffer): StorytimeImageContent | null {
  return readPngContent(buffer) ?? readJpegContent(buffer);
}

/**
 * Reads a PNG's dimensions from its IHDR chunk.
 *
 * @param buffer - The raw uploaded bytes.
 * @returns The dimensions, or null when the bytes are not a PNG.
 */
function readPngContent(buffer: Buffer): StorytimeImageContent | null {
  if (buffer.length < PNG_HEADER_LENGTH) {
    return null;
  }

  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return null;
  }

  // IHDR is required by the format to be the first chunk, so its width and
  // height are always at a fixed offset and there is nothing to search for.
  return {
    format: 'png',
    width: buffer.readUInt32BE(PNG_WIDTH_OFFSET),
    height: buffer.readUInt32BE(PNG_WIDTH_OFFSET + 4),
  };
}

/**
 * Reads a JPEG's dimensions by walking its segments to the frame header.
 *
 * JPEG has no fixed position for its dimensions: they sit in whichever
 * start-of-frame segment the encoder used, after any number of application and
 * comment segments of arbitrary length. The walk is therefore the only way to
 * find them, and it stops at the first frame rather than reading on into the
 * compressed data.
 *
 * @param buffer - The raw uploaded bytes.
 * @returns The dimensions, or null when the bytes are not a readable JPEG.
 */
function readJpegContent(buffer: Buffer): StorytimeImageContent | null {
  if (
    buffer.length < 4 ||
    buffer[0] !== JPEG_MARKER_PREFIX ||
    buffer[1] !== JPEG_START_OF_IMAGE
  ) {
    return null;
  }

  let offset = 2;

  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== JPEG_MARKER_PREFIX) {
      return null;
    }

    // Segments may be padded with any number of fill bytes, which are all
    // 0xff, so the marker is the first byte after the prefix that is not one.
    while (offset < buffer.length && buffer[offset] === JPEG_MARKER_PREFIX) {
      offset += 1;
    }

    if (offset >= buffer.length) {
      return null;
    }

    const marker = buffer[offset];
    offset += 1;

    if (marker === JPEG_END_OF_IMAGE) {
      return null;
    }

    if (JPEG_STANDALONE_MARKERS.has(marker)) {
      continue;
    }

    if (offset + 2 > buffer.length) {
      return null;
    }

    if (isFrameMarker(marker)) {
      // The segment length takes two bytes and the sample precision one, then
      // the height and the width, each two.
      if (offset + 7 > buffer.length) {
        return null;
      }

      return {
        format: 'jpeg',
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }

    const segmentLength = buffer.readUInt16BE(offset);

    // A length shorter than the two bytes holding it would not advance the
    // walk, so a malformed file cannot spin here.
    if (segmentLength < 2) {
      return null;
    }

    offset += segmentLength;
  }

  return null;
}

/**
 * Determines whether a marker introduces a frame carrying the dimensions.
 *
 * @param marker - The segment marker byte.
 * @returns True when the segment is a start-of-frame.
 */
function isFrameMarker(marker: number): boolean {
  return (
    marker >= 0xc0 && marker <= 0xcf && !JPEG_NON_FRAME_MARKERS.has(marker)
  );
}
