import { Injectable } from '@nestjs/common';

import {
  YOUTUBE_DURATION_PATTERN,
  YOUTUBE_HOSTNAMES,
  YOUTUBE_ID_PATH_PREFIXES,
  YOUTUBE_MAX_OFFSET_SECONDS,
  YOUTUBE_PLAYLIST_ID_PATTERN,
  YOUTUBE_SECONDS_PATTERN,
  YOUTUBE_VIDEO_ID_PATTERN,
} from './constants/youtube.constants';

/**
 * A YouTube reference recovered from a share URL.
 */
export interface ParsedYouTubeUrl {
  /** The canonical eleven-character video ID. */
  videoId: string;
  /** The playlist the link was in, when it named one. */
  playlistId: string | null;
  /** Where to start playback, in seconds. */
  startSeconds: number | null;
}

/**
 * Recovers a canonical video reference from a YouTube share URL.
 *
 * Creators paste whatever YouTube gave them, so every ordinary share form is
 * accepted: `watch?v=`, `youtu.be/`, `embed/`, `shorts/`, `live/` and the old
 * `v/` path, across the desktop, mobile, music and no-cookie hosts.
 *
 * Parsing is done with the URL parser and an exact hostname allowlist rather
 * than by matching a pattern against the whole string. This is the part that
 * matters: a pattern looking for "youtu.be" anywhere in the input accepts
 * `https://youtu.be.attacker.net/xyz`, while comparing the parsed hostname
 * cannot be fooled that way.
 *
 * Only the extracted identifiers are ever stored. No creator-supplied markup or
 * URL reaches the page; the embed is built by the application from the video ID.
 */
@Injectable()
export class YouTubeUrlService {
  /**
   * Parses a YouTube share URL.
   *
   * @param url - The URL a creator pasted.
   * @returns The video reference, or null when the URL is not an acceptable
   *   YouTube link.
   */
  parse(url: string | null | undefined): ParsedYouTubeUrl | null {
    const parsed = this.toUrl(url);

    if (!parsed || !this.isYouTubeHost(parsed.hostname)) {
      return null;
    }

    const videoId = this.extractVideoId(parsed);

    if (!videoId || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
      return null;
    }

    return {
      videoId,
      playlistId: this.extractPlaylistId(parsed),
      startSeconds: this.extractStartSeconds(parsed),
    };
  }

  /**
   * Determines whether a URL is an acceptable YouTube link.
   *
   * @param url - The URL to check.
   * @returns True when the URL yields a usable video reference.
   */
  isValid(url: string | null | undefined): boolean {
    return this.parse(url) !== null;
  }

  /**
   * Parses a string into a URL.
   *
   * @param url - The candidate URL.
   * @returns The parsed URL, or null when it is not a URL at all.
   */
  private toUrl(url: string | null | undefined): URL | null {
    if (!url) {
      return null;
    }

    try {
      const parsed = new URL(url.trim());

      // Only web URLs. Without this a `javascript:` or `data:` URL whose text
      // happened to contain a YouTube host would reach the host check.
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Determines whether a hostname is on the allowlist.
   *
   * @param hostname - The parsed hostname.
   * @returns True when the host is an accepted YouTube domain.
   */
  private isYouTubeHost(hostname: string): boolean {
    return YOUTUBE_HOSTNAMES.includes(hostname.toLowerCase());
  }

  /**
   * Extracts the video ID from any accepted URL shape.
   *
   * @param url - The parsed URL.
   * @returns The video ID, or null when the URL names no video.
   */
  private extractVideoId(url: URL): string | null {
    const segments = url.pathname.split('/').filter(Boolean);

    // youtu.be/<id> carries the ID as the only path segment.
    if (url.hostname.toLowerCase().endsWith('youtu.be')) {
      return segments[0] ?? null;
    }

    // watch?v=<id>
    const queryId = url.searchParams.get('v');
    if (queryId) {
      return queryId;
    }

    // embed/<id>, shorts/<id>, live/<id>, v/<id>
    if (
      segments.length >= 2 &&
      YOUTUBE_ID_PATH_PREFIXES.includes(segments[0])
    ) {
      return segments[1];
    }

    return null;
  }

  /**
   * Extracts a playlist ID, when the link names a valid one.
   *
   * @param url - The parsed URL.
   * @returns The playlist ID, or null.
   */
  private extractPlaylistId(url: URL): string | null {
    const playlistId = url.searchParams.get('list');

    if (!playlistId || !YOUTUBE_PLAYLIST_ID_PATTERN.test(playlistId)) {
      return null;
    }

    return playlistId;
  }

  /**
   * Extracts a start offset, accepting both seconds and YouTube's shorthand.
   *
   * @param url - The parsed URL.
   * @returns The offset in seconds, or null when absent or unusable.
   */
  private extractStartSeconds(url: URL): number | null {
    const raw = url.searchParams.get('t') ?? url.searchParams.get('start');

    if (!raw) {
      return null;
    }

    const seconds = this.parseOffset(raw.trim());

    if (seconds === null || seconds > YOUTUBE_MAX_OFFSET_SECONDS) {
      return null;
    }

    return seconds;
  }

  /**
   * Parses an offset expressed either as seconds or as `1h2m3s`.
   *
   * @param raw - The raw offset value.
   * @returns The offset in seconds, or null when it cannot be read.
   */
  private parseOffset(raw: string): number | null {
    if (YOUTUBE_SECONDS_PATTERN.test(raw)) {
      return Number(raw);
    }

    const duration = YOUTUBE_DURATION_PATTERN.exec(raw);

    // The duration pattern makes every component optional, so it also matches
    // an empty string. A match with no components at all is not an offset.
    if (!duration || !duration.slice(1).some(Boolean)) {
      return null;
    }

    const hours = Number(duration[1] ?? 0);
    const minutes = Number(duration[2] ?? 0);
    const seconds = Number(duration[3] ?? 0);

    return hours * 3600 + minutes * 60 + seconds;
  }
}
