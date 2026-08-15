import * as fc from 'fast-check';
import { StorytimeMarkdownService } from '../../storytime/content/storytime-markdown.service';
import { YouTubeUrlService } from '../../storytime/content/youtube-url.service';
import { YOUTUBE_HOSTNAMES } from '../../storytime/content/constants/youtube.constants';

/**
 * Property-based tests for the Storytime content pipeline.
 *
 * The renderer is the feature's security boundary and takes text written by any
 * member, so the properties asserted here are the ones that must hold for
 * *every* input rather than for the examples somebody thought to write down.
 */
describe('Storytime content fuzz tests', () => {
  const numRuns = Number(process.env['FUZZ_NUM_RUNS']) || 100;

  const markdownService = new StorytimeMarkdownService();
  const youTubeService = new YouTubeUrlService();

  /** Fragments chosen to provoke the renderer, mixed in with random text. */
  const hostileFragments = [
    '<script>',
    '</script>',
    '<img src=x onerror=alert(1)>',
    '"',
    "'",
    '<',
    '>',
    '&',
    '`',
    '```',
    '[x](javascript:alert(1))',
    '[x](https://evil.test)',
    '[x](/safe)',
    '# ',
    '> ',
    '- ',
    '1. ',
    '---',
    '**',
    '__',
    '\n',
    '\n\n',
    String.fromCharCode(0xe000),
  ];

  /** Arbitrary content built from random text and hostile fragments. */
  const contentArbitrary = fc
    .array(fc.oneof(fc.string(), fc.constantFrom(...hostileFragments)), {
      maxLength: 40,
    })
    .map(parts => parts.join(''));

  it('never emits a dangerous element, whatever the input', () => {
    fc.assert(
      fc.property(contentArbitrary, source => {
        const { html } = markdownService.render(source);

        expect(html).not.toMatch(
          /<\s*(script|iframe|object|embed|form|style|link|meta|base)\b/i,
        );
      }),
      { numRuns },
    );
  });

  it('never emits an inline event handler', () => {
    fc.assert(
      fc.property(contentArbitrary, source => {
        const { html } = markdownService.render(source);

        // An `on...=` sequence only matters inside a tag. The renderer emits
        // every tag itself, so finding one here would mean author text had
        // reached a tag unescaped.
        const tags = html.match(/<[^>]*>/g) ?? [];
        for (const tag of tags) {
          expect(tag).not.toMatch(/\son[a-z]+\s*=/i);
        }
      }),
      { numRuns },
    );
  });

  it('only ever emits site-relative hrefs', () => {
    fc.assert(
      fc.property(contentArbitrary, source => {
        const { html } = markdownService.render(source);

        for (const match of html.matchAll(/href="([^"]*)"/g)) {
          expect(match[1]).toMatch(/^(?:\/(?!\/)|#)/);
        }
      }),
      { numRuns },
    );
  });

  it('never leaks the code placeholder sentinel into the output', () => {
    fc.assert(
      fc.property(contentArbitrary, source => {
        const { html } = markdownService.render(source);

        expect(html).not.toContain(String.fromCharCode(0xe000));
      }),
      { numRuns },
    );
  });

  it('always reports a non-negative word count and reading time', () => {
    fc.assert(
      fc.property(contentArbitrary, source => {
        const result = markdownService.render(source);

        expect(result.wordCount).toBeGreaterThanOrEqual(0);
        expect(result.estimatedReadingMinutes).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(result.wordCount)).toBe(true);
        expect(Number.isInteger(result.estimatedReadingMinutes)).toBe(true);
      }),
      { numRuns },
    );
  });

  // Nothing is refused, so the renderer has to cope with every input rather
  // than relying on something upstream having filtered it.
  it('never throws, whatever the input', () => {
    fc.assert(
      fc.property(contentArbitrary, source => {
        expect(() => markdownService.render(source)).not.toThrow();
      }),
      { numRuns },
    );
  });

  it('only accepts YouTube URLs whose host is on the allowlist', () => {
    fc.assert(
      fc.property(fc.webUrl(), fc.string(), (url, suffix) => {
        const candidate = `${url}${suffix}`;
        const parsed = youTubeService.parse(candidate);

        if (parsed === null) {
          return;
        }

        const hostname = new URL(candidate.trim()).hostname.toLowerCase();
        expect(YOUTUBE_HOSTNAMES).toContain(hostname);
      }),
      { numRuns },
    );
  });

  it('only ever returns a well-formed video id', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...YOUTUBE_HOSTNAMES),
        fc.string(),
        (host, id) => {
          const parsed = youTubeService.parse(`https://${host}/watch?v=${id}`);

          if (parsed === null) {
            return;
          }

          expect(parsed.videoId).toMatch(/^[A-Za-z0-9_-]{11}$/);
        },
      ),
      { numRuns },
    );
  });
});
