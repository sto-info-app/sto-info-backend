import { StorytimeChapterMediaEntity } from './storytime-chapter-media.entity';

describe('StorytimeChapterMediaEntity', () => {
  /**
   * Builds a stored video.
   *
   * @param overrides - Fields to change.
   * @returns The media entity.
   */
  const buildMedia = (
    overrides: Partial<StorytimeChapterMediaEntity> = {},
  ): StorytimeChapterMediaEntity =>
    Object.assign(new StorytimeChapterMediaEntity(), {
      externalId: 'dQw4w9WgXcQ',
      playlistId: null,
      startSeconds: null,
      endSeconds: null,
      ...overrides,
    });

  describe('the embed URL', () => {
    // Playback goes through the no-cookie host, so a reader who presses play
    // is not handed a tracking cookie along with the video.
    it('always uses the no-cookie host', () => {
      expect(buildMedia().embedUrl).toContain('youtube-nocookie.com');
    });

    it('embeds the stored video', () => {
      expect(buildMedia().embedUrl).toContain('/embed/dQw4w9WgXcQ');
    });

    it('carries no query at all for a plain video', () => {
      expect(buildMedia().embedUrl).not.toContain('?');
    });

    it('carries the start time when there is one', () => {
      expect(buildMedia({ startSeconds: 90 }).embedUrl).toContain('start=90');
    });

    // Zero is a real starting point and must survive, where a loose check
    // would drop it as falsy.
    it('carries a start time of zero', () => {
      expect(buildMedia({ startSeconds: 0 }).embedUrl).toContain('start=0');
    });

    it('carries the end time when there is one', () => {
      expect(buildMedia({ endSeconds: 120 }).embedUrl).toContain('end=120');
    });

    it('carries the playlist when there is one', () => {
      expect(buildMedia({ playlistId: 'PLtest' }).embedUrl).toContain(
        'list=PLtest',
      );
    });

    it('carries everything at once', () => {
      const url = buildMedia({
        playlistId: 'PLtest',
        startSeconds: 10,
        endSeconds: 20,
      }).embedUrl;

      expect(url).toContain('list=PLtest');
      expect(url).toContain('start=10');
      expect(url).toContain('end=20');
    });
  });

  // The still is served from an image host that sets no cookies, so a reader
  // who never presses play is never announced to anybody.
  it('builds a thumbnail for the stored video', () => {
    const url = buildMedia().thumbnailUrl;

    expect(url).toContain('dQw4w9WgXcQ');
    expect(url).toContain('ytimg.com');
  });
});
