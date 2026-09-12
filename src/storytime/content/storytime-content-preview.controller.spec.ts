import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeContentPreviewController } from './storytime-content-preview.controller';
import { StorytimeMarkdownService } from './storytime-markdown.service';

describe('StorytimeContentPreviewController', () => {
  let controller: StorytimeContentPreviewController;
  let featureService: { assertFlagEnabled: jest.Mock };

  beforeEach(async () => {
    featureService = { assertFlagEnabled: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeContentPreviewController],
      providers: [
        StorytimeMarkdownService,
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<StorytimeContentPreviewController>(
      StorytimeContentPreviewController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('renders Markdown to the HTML a reader would receive', async () => {
    const { html } = await controller.preview({
      contentSource: 'The **Enterprise** broke orbit.',
    });

    expect(html).toBe(
      '<p id="b1">The <strong>Enterprise</strong> broke orbit.</p>',
    );
  });

  // The whole reason the preview is a round trip: the client has no renderer
  // that demotes headings or anchors blocks, so these are what it cannot fake.
  it('demotes headings and anchors every block, as the reader gets them', async () => {
    const { html } = await controller.preview({
      contentSource: '# Landfall\n\nShe went first.',
    });

    expect(html).toBe(
      '<h2 id="b1">Landfall</h2>\n<p id="b2">She went first.</p>',
    );
  });

  it('drops links that leave the site', async () => {
    const { html } = await controller.preview({
      contentSource: '[elsewhere](https://example.com)',
    });

    expect(html).toBe('<p id="b1"></p>');
  });

  it('escapes markup rather than rendering it', async () => {
    const { html } = await controller.preview({
      contentSource: '<script>alert(1)</script>',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders nothing for an empty body', async () => {
    await expect(controller.preview({})).resolves.toEqual({ html: '' });
  });

  it('requires that writing is switched on', async () => {
    await controller.preview({ contentSource: 'anything' });

    expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );
  });

  it('renders nothing when writing is switched off', async () => {
    featureService.assertFlagEnabled.mockRejectedValue(new NotFoundException());

    await expect(
      controller.preview({ contentSource: 'anything' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
