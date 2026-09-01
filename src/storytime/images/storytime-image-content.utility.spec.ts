import { readImageContent } from './storytime-image-content.utility';

/**
 * Builds a PNG whose header claims the given dimensions.
 *
 * Only the signature and the IHDR chunk are produced, because those are the
 * only bytes the reader looks at and a real image would make the expectations
 * harder to read rather than more convincing.
 *
 * @param width - The width to declare.
 * @param height - The height to declare.
 * @returns The bytes.
 */
const buildPng = (width: number, height: number): Buffer => {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

/**
 * Builds a JPEG carrying segments before its frame header.
 *
 * @param width - The width to declare.
 * @param height - The height to declare.
 * @param options - Segments to put in front of the frame, and the frame marker.
 * @returns The bytes.
 */
const buildJpeg = (
  width: number,
  height: number,
  options: {
    leading?: Buffer;
    frameMarker?: number;
  } = {},
): Buffer => {
  const frame = Buffer.alloc(11);
  frame.writeUInt8(0xff, 0);
  frame.writeUInt8(options.frameMarker ?? 0xc0, 1);
  frame.writeUInt16BE(8, 2);
  frame.writeUInt8(8, 4);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    options.leading ?? Buffer.alloc(0),
    frame,
  ]);
};

/**
 * Builds an application segment of a given payload length.
 *
 * @param marker - The segment marker.
 * @param payloadLength - How many bytes the payload occupies.
 * @returns The bytes.
 */
const buildSegment = (marker: number, payloadLength: number): Buffer => {
  const segment = Buffer.alloc(4 + payloadLength);
  segment.writeUInt8(0xff, 0);
  segment.writeUInt8(marker, 1);
  segment.writeUInt16BE(payloadLength + 2, 2);
  return segment;
};

describe('readImageContent', () => {
  describe('PNG', () => {
    it('reads the dimensions from the IHDR chunk', () => {
      expect(readImageContent(buildPng(2400, 480))).toEqual({
        format: 'png',
        width: 2400,
        height: 480,
      });
    });

    it('rejects bytes too short to hold a header', () => {
      expect(readImageContent(Buffer.alloc(10))).toBeNull();
    });

    it('rejects bytes whose signature is wrong', () => {
      const notAPng = buildPng(100, 100);
      notAPng.writeUInt8(0x00, 0);

      expect(readImageContent(notAPng)).toBeNull();
    });
  });

  describe('JPEG', () => {
    it('reads the dimensions from the frame header', () => {
      expect(readImageContent(buildJpeg(1920, 1080))).toEqual({
        format: 'jpeg',
        width: 1920,
        height: 1080,
      });
    });

    // The dimensions sit after however many application and comment segments
    // the encoder wrote, so finding them means walking past them.
    it('walks past earlier segments to reach the frame', () => {
      const withMetadata = buildJpeg(800, 600, {
        leading: Buffer.concat([
          buildSegment(0xe0, 14),
          buildSegment(0xfe, 40),
        ]),
      });

      expect(readImageContent(withMetadata)).toEqual({
        format: 'jpeg',
        width: 800,
        height: 600,
      });
    });

    it('treats fill bytes between segments as padding', () => {
      const padded = buildJpeg(640, 360, {
        leading: Buffer.from([0xff, 0xff, 0xff, 0xd0]),
      });

      expect(readImageContent(padded)).toEqual({
        format: 'jpeg',
        width: 640,
        height: 360,
      });
    });

    // 0xc4 sits in the start-of-frame range but describes Huffman tables, so
    // reading dimensions out of it would produce confident nonsense.
    it('does not mistake a Huffman table for a frame', () => {
      expect(
        readImageContent(buildJpeg(640, 360, { frameMarker: 0xc4 })),
      ).toBeNull();
    });

    it('reads a progressive frame', () => {
      expect(
        readImageContent(buildJpeg(320, 180, { frameMarker: 0xc2 })),
      ).toEqual({ format: 'jpeg', width: 320, height: 180 });
    });

    it('rejects bytes that never reach a frame', () => {
      expect(
        readImageContent(
          Buffer.concat([Buffer.from([0xff, 0xd8]), buildSegment(0xe0, 4)]),
        ),
      ).toBeNull();
    });

    it('rejects a file that ends at end-of-image', () => {
      expect(
        readImageContent(Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x00])),
      ).toBeNull();
    });

    it('rejects a segment claiming an impossible length', () => {
      const broken = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00]);

      expect(readImageContent(broken)).toBeNull();
    });

    it('rejects a frame truncated before its dimensions', () => {
      const truncated = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08]);

      expect(readImageContent(truncated)).toBeNull();
    });

    it('rejects bytes that are not a marker at all', () => {
      expect(
        readImageContent(Buffer.from([0xff, 0xd8, 0x12, 0x34, 0x56, 0x78])),
      ).toBeNull();
    });

    it('rejects a file that ends on a run of fill bytes', () => {
      expect(
        readImageContent(Buffer.from([0xff, 0xd8, 0xff, 0xff])),
      ).toBeNull();
    });

    it('rejects a segment header cut short', () => {
      expect(
        readImageContent(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])),
      ).toBeNull();
    });
  });

  it('rejects something that is not an image at all', () => {
    expect(readImageContent(Buffer.from('<svg><script/></svg>'))).toBeNull();
  });
});
