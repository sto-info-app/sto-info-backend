import { Test, TestingModule } from '@nestjs/testing';

import { YouTubeUrlService } from './youtube-url.service';

/** A realistic eleven-character video ID. */
const VIDEO_ID = 'UG0aHIOLbV4';

describe('YouTubeUrlService', () => {
  let service: YouTubeUrlService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [YouTubeUrlService],
    }).compile();

    service = module.get<YouTubeUrlService>(YouTubeUrlService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('accepted share forms', () => {
    const accepted: [string, string][] = [
      ['short link', `https://youtu.be/${VIDEO_ID}`],
      ['watch link', `https://www.youtube.com/watch?v=${VIDEO_ID}`],
      ['watch link without www', `https://youtube.com/watch?v=${VIDEO_ID}`],
      ['mobile link', `https://m.youtube.com/watch?v=${VIDEO_ID}`],
      ['music link', `https://music.youtube.com/watch?v=${VIDEO_ID}`],
      ['embed link', `https://www.youtube.com/embed/${VIDEO_ID}`],
      ['shorts link', `https://www.youtube.com/shorts/${VIDEO_ID}`],
      ['live link', `https://www.youtube.com/live/${VIDEO_ID}`],
      ['legacy v link', `https://www.youtube.com/v/${VIDEO_ID}`],
      ['no-cookie link', `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`],
      ['http link', `http://youtu.be/${VIDEO_ID}`],
    ];

    it.each(accepted)('accepts a %s', (_name, url) => {
      expect(service.parse(url)?.videoId).toBe(VIDEO_ID);
    });

    it('ignores surrounding whitespace', () => {
      expect(service.parse(`  https://youtu.be/${VIDEO_ID}  `)?.videoId).toBe(
        VIDEO_ID,
      );
    });

    it('ignores hostname casing', () => {
      expect(service.parse(`https://YouTu.be/${VIDEO_ID}`)?.videoId).toBe(
        VIDEO_ID,
      );
    });
  });

  describe('deceptive and malformed input', () => {
    // The reason parsing uses the URL parser and an exact hostname allowlist
    // rather than searching for "youtu.be" inside the string.
    const rejected: [string, string][] = [
      ['lookalike subdomain', `https://youtu.be.attacker.test/${VIDEO_ID}`],
      ['lookalike suffix', `https://notyoutube.com/watch?v=${VIDEO_ID}`],
      ['host in the path', `https://evil.test/youtu.be/${VIDEO_ID}`],
      [
        'host in the query',
        `https://evil.test/?u=https://youtu.be/${VIDEO_ID}`,
      ],
      ['userinfo trick', `https://youtu.be@evil.test/${VIDEO_ID}`],
      ['javascript URL', 'javascript:alert(1)'],
      ['data URL', 'data:text/html,<script>alert(1)</script>'],
      ['file URL', 'file:///etc/passwd'],
      ['not a URL', 'just some text'],
      ['empty', ''],
      ['no video id', 'https://www.youtube.com/'],
      ['short link with no id', 'https://youtu.be/'],
      ['id too short', 'https://youtu.be/abc'],
      ['id too long', `https://youtu.be/${VIDEO_ID}extra`],
      ['id with invalid characters', 'https://youtu.be/abc$def%ghi'],
      ['unknown path prefix', `https://www.youtube.com/channel/${VIDEO_ID}`],
    ];

    it.each(rejected)('rejects a %s', (_name, url) => {
      expect(service.parse(url)).toBeNull();
    });

    it('rejects null', () => {
      expect(service.parse(null)).toBeNull();
    });

    it('rejects undefined', () => {
      expect(service.parse(undefined)).toBeNull();
    });
  });

  describe('playlists', () => {
    it('records a playlist when the link names one', () => {
      const url = `https://www.youtube.com/watch?v=${VIDEO_ID}&list=PLabcdefghijk`;

      expect(service.parse(url)?.playlistId).toBe('PLabcdefghijk');
    });

    it('ignores a malformed playlist rather than rejecting the video', () => {
      const url = `https://www.youtube.com/watch?v=${VIDEO_ID}&list=no`;
      const parsed = service.parse(url);

      expect(parsed?.videoId).toBe(VIDEO_ID);
      expect(parsed?.playlistId).toBeNull();
    });

    it('reports no playlist when none is named', () => {
      expect(
        service.parse(`https://youtu.be/${VIDEO_ID}`)?.playlistId,
      ).toBeNull();
    });
  });

  describe('start offsets', () => {
    it('reads a plain seconds offset', () => {
      expect(
        service.parse(`https://youtu.be/${VIDEO_ID}?t=90`)?.startSeconds,
      ).toBe(90);
    });

    it('reads the start parameter', () => {
      expect(
        service.parse(`https://www.youtube.com/watch?v=${VIDEO_ID}&start=45`)
          ?.startSeconds,
      ).toBe(45);
    });

    it('reads the hours, minutes and seconds shorthand', () => {
      expect(
        service.parse(`https://youtu.be/${VIDEO_ID}?t=1h2m3s`)?.startSeconds,
      ).toBe(3723);
    });

    it('reads a minutes and seconds shorthand', () => {
      expect(
        service.parse(`https://youtu.be/${VIDEO_ID}?t=2m30s`)?.startSeconds,
      ).toBe(150);
    });

    it('reads a seconds-only shorthand', () => {
      expect(
        service.parse(`https://youtu.be/${VIDEO_ID}?t=45s`)?.startSeconds,
      ).toBe(45);
    });

    it('reads a minutes-only shorthand', () => {
      expect(
        service.parse(`https://youtu.be/${VIDEO_ID}?t=2m`)?.startSeconds,
      ).toBe(120);
    });

    it('reads an hours-only shorthand', () => {
      expect(
        service.parse(`https://youtu.be/${VIDEO_ID}?t=1h`)?.startSeconds,
      ).toBe(3600);
    });

    it('reports no offset when none is given', () => {
      expect(
        service.parse(`https://youtu.be/${VIDEO_ID}`)?.startSeconds,
      ).toBeNull();
    });

    it('ignores an unreadable offset', () => {
      expect(
        service.parse(`https://youtu.be/${VIDEO_ID}?t=soon`)?.startSeconds,
      ).toBeNull();
    });

    it('ignores an absurd offset', () => {
      expect(
        service.parse(`https://youtu.be/${VIDEO_ID}?t=999999`)?.startSeconds,
      ).toBeNull();
    });

    it('ignores an empty offset', () => {
      expect(
        service.parse(`https://youtu.be/${VIDEO_ID}?t=`)?.startSeconds,
      ).toBeNull();
    });
  });

  describe('isValid', () => {
    it('is true for an acceptable link', () => {
      expect(service.isValid(`https://youtu.be/${VIDEO_ID}`)).toBe(true);
    });

    it('is false for a deceptive link', () => {
      expect(
        service.isValid(`https://youtu.be.attacker.test/${VIDEO_ID}`),
      ).toBe(false);
    });
  });
});
