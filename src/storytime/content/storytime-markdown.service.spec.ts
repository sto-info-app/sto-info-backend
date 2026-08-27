import { Test, TestingModule } from '@nestjs/testing';
import { CODE_PLACEHOLDER_SENTINEL } from './constants/storytime-markdown.constants';
import { StorytimeMarkdownService } from './storytime-markdown.service';

describe('StorytimeMarkdownService', () => {
  let service: StorytimeMarkdownService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorytimeMarkdownService],
    }).compile();

    service = module.get<StorytimeMarkdownService>(StorytimeMarkdownService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('blocks', () => {
    it('renders a paragraph with an anchor', () => {
      expect(service.render('Hello there.').html).toBe(
        '<p id="b1">Hello there.</p>',
      );
    });

    it('anchors each block in order', () => {
      const { html, blockCount } = service.render(
        'First.\n\nSecond.\n\nThird.',
      );

      expect(html).toContain('<p id="b1">First.</p>');
      expect(html).toContain('<p id="b2">Second.</p>');
      expect(html).toContain('<p id="b3">Third.</p>');
      expect(blockCount).toBe(3);
    });

    // The Chapter title is the page's h1; an author heading must not compete
    // with it or the document outline breaks for screen readers.
    it('shifts headings down so authors cannot emit an h1', () => {
      expect(service.render('# Chapter One').html).toBe(
        '<h2 id="b1">Chapter One</h2>',
      );
    });

    it('clamps the deepest heading at h6', () => {
      expect(service.render('###### Deep').html).toBe('<h6 id="b1">Deep</h6>');
    });

    it('renders a horizontal rule', () => {
      expect(service.render('---').html).toBe('<hr id="b1" />');
    });

    it('renders an unordered list', () => {
      expect(service.render('- one\n- two').html).toBe(
        '<ul id="b1"><li>one</li><li>two</li></ul>',
      );
    });

    it('renders an ordered list', () => {
      expect(service.render('1. one\n2. two').html).toBe(
        '<ol id="b1"><li>one</li><li>two</li></ol>',
      );
    });

    it('renders a blockquote', () => {
      expect(service.render('> Resistance is futile').html).toBe(
        '<blockquote id="b1">Resistance is futile</blockquote>',
      );
    });

    it('joins the lines of a paragraph with breaks', () => {
      expect(service.render('One\nTwo').html).toBe(
        '<p id="b1">One<br />Two</p>',
      );
    });

    it('ignores blank blocks', () => {
      expect(service.render('One.\n\n\n\n\nTwo.').blockCount).toBe(2);
    });

    it('renders empty content as empty', () => {
      const result = service.render('');

      expect(result.html).toBe('');
      expect(result.blockCount).toBe(0);
    });

    it('treats null content as empty', () => {
      expect(service.render(null).html).toBe('');
    });

    it('treats undefined content as empty', () => {
      expect(service.render(undefined).html).toBe('');
    });
  });

  describe('inline formatting', () => {
    it('renders bold with asterisks', () => {
      expect(service.render('**bold**').html).toContain(
        '<strong>bold</strong>',
      );
    });

    it('renders bold with underscores', () => {
      expect(service.render('__bold__').html).toContain(
        '<strong>bold</strong>',
      );
    });

    it('renders italic with asterisks', () => {
      expect(service.render('*italic*').html).toContain('<em>italic</em>');
    });

    it('renders italic with underscores', () => {
      expect(service.render('_italic_').html).toContain('<em>italic</em>');
    });

    it('renders inline code', () => {
      expect(service.render('`warp core`').html).toContain(
        '<code>warp core</code>',
      );
    });
  });

  describe('code blocks', () => {
    it('renders a fenced block as preformatted code', () => {
      const { html } = service.render('```\nconst x = 1;\n```');

      expect(html).toContain('<pre id="b1" class="storytime-code">');
      expect(html).toContain('const x = 1;');
    });

    it('does not interpret Markdown inside a fence', () => {
      const { html } = service.render('```\n# not a heading\n```');

      expect(html).not.toContain('<h2');
      expect(html).toContain('# not a heading');
    });

    // Escaping inside a fence matters just as much as outside it.
    it('escapes markup inside a fence', () => {
      const { html } = service.render('```\n<script>alert(1)</script>\n```');

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    // An author writing the placeholder text must not be able to steal or
    // blank somebody else's extracted code.
    it('cannot be tricked by an author writing the placeholder text', () => {
      const { html } = service.render('CODE0\n\n```\nreal code\n```');

      expect(html).toContain('<p id="b1">CODE0</p>');
      expect(html).toContain('real code');
    });

    it('strips a forged sentinel from the source', () => {
      const forged = `${CODE_PLACEHOLDER_SENTINEL}CODE0${CODE_PLACEHOLDER_SENTINEL}`;
      const { html } = service.render(forged);

      expect(html).toBe('<p id="b1">CODE0</p>');
    });

    it('restores a fence written mid-paragraph as inline code', () => {
      const { html } = service.render('Try ```warp``` now.');

      expect(html).toContain('<code>warp</code>');
      expect(html).not.toContain(CODE_PLACEHOLDER_SENTINEL);
    });
  });

  describe('links', () => {
    it('renders a site-relative link', () => {
      expect(service.render('[Story](/storytime/stories/abc)').html).toContain(
        '<a href="/storytime/stories/abc">Story</a>',
      );
    });

    it('renders an in-page fragment link', () => {
      expect(service.render('[Top](#b1)').html).toContain(
        '<a href="#b1">Top</a>',
      );
    });

    // External targets are accepted rather than refused, so the renderer is
    // the only thing standing between an author and an off-site link.
    // The label goes with the link: "click here" reads as a broken promise
    // once there is nothing to click.
    it('removes an external link entirely, label included', () => {
      const { html } = service.render('[Away](https://example.com)');

      expect(html).not.toContain('Away');
      expect(html).not.toContain('<a');
      expect(html).not.toContain('example.com');
    });

    it('leaves the surrounding sentence intact when a link is removed', () => {
      const { html } = service.render('See [here](https://example.com) later.');

      expect(html).toContain('See');
      expect(html).toContain('later.');
      expect(html).not.toContain('here');
    });

    it('keeps a bare URL visible as plain text', () => {
      const { html } = service.render('Visit https://example.com today');

      expect(html).toContain('https://example.com');
      expect(html).not.toContain('<a');
    });

    it('renders content containing an external link without complaint', () => {
      expect(() =>
        service.render(
          'See [here](https://example.com) and https://other.test',
        ),
      ).not.toThrow();
    });

    it('removes a scheme-relative link entirely', () => {
      const { html } = service.render('[Away](//example.com)');

      expect(html).not.toContain('<a');
      expect(html).not.toContain('Away');
    });

    it('refuses a javascript URL', () => {
      const { html } = service.render('[Click](javascript:alert(1))');

      expect(html).not.toContain('<a');
      expect(html).not.toContain('javascript:');
    });

    it('does not link a bare URL', () => {
      const { html } = service.render('Visit https://example.com today');

      expect(html).not.toContain('<a');
    });
  });

  describe('escaping hostile input', () => {
    const payloads: [string, string][] = [
      ['script tag', '<script>alert(1)</script>'],
      ['img onerror', '<img src=x onerror=alert(1)>'],
      ['iframe', '<iframe src="https://evil.test"></iframe>'],
      ['svg onload', '<svg onload=alert(1)>'],
      ['style block', '<style>body{display:none}</style>'],
      ['object tag', '<object data="evil.swf"></object>'],
      ['form', '<form action="https://evil.test"><input name="a"></form>'],
      ['attribute break-out', '" onmouseover="alert(1)'],
      ['single quote break-out', "' onmouseover='alert(1)"],
      ['html comment', '<!-- <script>alert(1)</script> -->'],
    ];

    // The test is that no payload produces an element or an unescaped quote.
    // An event-handler name surviving as visible text is harmless - it is inert
    // prose inside a paragraph - so asserting on the name alone would fail on
    // correct output.
    it.each(payloads)('neutralises a %s', (_name, payload) => {
      const { html } = service.render(payload);
      const body = html.replace(/^<p id="b\d+">|<\/p>$/g, '');

      expect(html).not.toMatch(/<(script|iframe|img|svg|style|object|form)/i);
      expect(body).not.toContain('<');
      expect(body).not.toContain('"');
      expect(body).not.toContain("'");
    });

    it('escapes every HTML-significant character', () => {
      const { html } = service.render(`& < > " '`);

      expect(html).toContain('&amp;');
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
      expect(html).toContain('&quot;');
      expect(html).toContain('&#39;');
    });

    // The anchor is emitted by this class, so an author cannot break out of
    // the id attribute however they format their content.
    it('never lets author text reach an attribute unescaped', () => {
      const { html } = service.render('[x](/a" onclick="alert(1))');

      expect(html).not.toContain('onclick="alert(1)"');
    });
  });

  describe('word count and reading time', () => {
    it('counts words', () => {
      expect(service.render('one two three four five').wordCount).toBe(5);
    });

    it('ignores Markdown syntax when counting', () => {
      expect(service.render('**one** *two* `three`').wordCount).toBe(3);
    });

    it('counts nothing for empty content', () => {
      const result = service.render('   ');

      expect(result.wordCount).toBe(0);
      expect(result.estimatedReadingMinutes).toBe(0);
    });

    it('rounds reading time up to whole minutes', () => {
      const source = Array.from({ length: 250 }, () => 'word').join(' ');

      expect(service.render(source).estimatedReadingMinutes).toBe(2);
    });

    it('never reports less than a minute for real content', () => {
      expect(service.render('one two').estimatedReadingMinutes).toBe(1);
    });
  });

  describe('buildBlockId', () => {
    it('builds an anchor from a position', () => {
      expect(service.buildBlockId(4)).toBe('b4');
    });
  });

  it('stamps the schema version so content can be re-rendered later', () => {
    expect(service.render('x').schemaVersion).toBe(1);
  });
});
