import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StorytimeContentValidatorService } from './storytime-content-validator.service';

describe('StorytimeContentValidatorService', () => {
  let service: StorytimeContentValidatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorytimeContentValidatorService],
    }).compile();

    service = module.get<StorytimeContentValidatorService>(
      StorytimeContentValidatorService,
    );
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('accepted content', () => {
    it('accepts ordinary prose', () => {
      expect(service.validate('The Enterprise went to warp.').isValid).toBe(
        true,
      );
    });

    it('accepts empty content', () => {
      expect(service.validate('').isValid).toBe(true);
    });

    it('accepts a site-relative link', () => {
      expect(
        service.validate('[Chapter Two](/storytime/stories/a/chapters/b)')
          .isValid,
      ).toBe(true);
    });

    it('accepts an in-page fragment link', () => {
      expect(service.validate('[Back to the top](#b1)').isValid).toBe(true);
    });

    // Guessing at bare domain names would reject ordinary writing.
    it('accepts prose that merely resembles a domain', () => {
      expect(
        service.validate('The U.S.S. Voyager. Stardate 47.3. Section 31.')
          .isValid,
      ).toBe(true);
    });

    // A URL shown as an example is text, and is never rendered as a link.
    it('accepts a URL inside a fenced code block', () => {
      expect(
        service.validate('```\nhttps://example.com/api\n```').isValid,
      ).toBe(true);
    });
  });

  describe('rejected content', () => {
    it('rejects an external Markdown link', () => {
      const result = service.validate('[Away](https://example.com)');

      expect(result.isValid).toBe(false);
      expect(result.offendingUrls).toContain('https://example.com');
    });

    it('rejects a bare absolute URL', () => {
      const result = service.validate('Visit https://example.com for more.');

      expect(result.isValid).toBe(false);
    });

    it('rejects an http URL as well as https', () => {
      expect(service.validate('http://example.com').isValid).toBe(false);
    });

    // No scheme, but it still leaves the site.
    it('rejects a scheme-relative URL', () => {
      const result = service.validate('See //example.com for more.');

      expect(result.isValid).toBe(false);
      expect(result.offendingUrls).toContain('//example.com');
    });

    it('rejects a scheme-relative Markdown link', () => {
      expect(service.validate('[Away](//example.com)').isValid).toBe(false);
    });

    it('rejects a javascript URL', () => {
      expect(service.validate('[Click](javascript:alert(1))').isValid).toBe(
        false,
      );
    });

    it('rejects a mailto link', () => {
      expect(
        service.validate('[Mail](mailto:someone@example.com)').isValid,
      ).toBe(false);
    });

    it('rejects a data URL', () => {
      expect(
        service.validate('[X](data:text/html;base64,PHNjcmlwdD4=)').isValid,
      ).toBe(false);
    });

    it('reports each offending URL once', () => {
      const result = service.validate(
        'https://example.com and https://example.com again',
      );

      expect(result.offendingUrls).toHaveLength(1);
    });

    it('reports several distinct offending URLs', () => {
      const result = service.validate(
        '[a](https://one.test) and [b](https://two.test)',
      );

      expect(result.offendingUrls).toHaveLength(2);
    });

    // A URL outside the fence must still be caught when a fence is present.
    it('still rejects a URL outside a code block', () => {
      expect(
        service.validate('```\ncode\n```\n\nVisit https://example.com').isValid,
      ).toBe(false);
    });
  });

  describe('assertValid', () => {
    it('passes acceptable content', () => {
      expect(() => service.assertValid('Ordinary prose.')).not.toThrow();
    });

    it('throws on external links', () => {
      expect(() => service.assertValid('https://example.com')).toThrow(
        BadRequestException,
      );
    });

    // The creator has to be able to find what to remove.
    it('names the offending URL in the error', () => {
      expect(() => service.assertValid('https://example.com/page')).toThrow(
        /https:\/\/example\.com\/page/,
      );
    });
  });
});
