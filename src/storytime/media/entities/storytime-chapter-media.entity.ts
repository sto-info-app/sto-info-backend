import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { YOUTUBE_EMBED_HOST } from '../../content/constants/youtube.constants';
import { MediaProvider } from '../../enums/media-provider.enum';

/**
 * A video a Chapter embeds.
 *
 * Stored as a provider and an identifier, never as embed markup. A creator
 * pastes a share URL, the server recovers the video ID from it, and the page
 * is built from that: no creator-supplied HTML or URL ever reaches a reader's
 * browser, which is what makes embedding somebody else's video safe.
 *
 * Playback goes through YouTube's no-cookie host and only once a reader asks
 * for it, so opening a Chapter does not hand YouTube a record of who read it.
 */
@Entity({ name: 'storytime_chapter_media' })
@Index(['chapterId', 'orderIndex'])
export class StorytimeChapterMediaEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Chapter this belongs to.' })
  @Column({ type: 'uuid', nullable: false })
  chapterId: string;

  @ApiProperty({ enum: MediaProvider, description: 'Where the video lives.' })
  @Column({
    type: 'enum',
    enum: MediaProvider,
    enumName: 'storytime_media_provider_enum',
    default: MediaProvider.YOUTUBE,
  })
  provider: MediaProvider;

  @ApiProperty({ description: 'The canonical video identifier.' })
  @Column({ type: 'varchar', length: 100, nullable: false })
  externalId: string;

  @ApiProperty({
    description: 'The playlist the link named, if any.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  playlistId: string | null;

  @ApiProperty({
    description: 'Where playback should start, in seconds.',
    nullable: true,
  })
  @Column({ type: 'integer', nullable: true, default: null })
  startSeconds: number | null;

  @ApiProperty({
    description: 'Where playback should stop, in seconds.',
    nullable: true,
  })
  @Column({ type: 'integer', nullable: true, default: null })
  endSeconds: number | null;

  @ApiProperty({
    description: 'What the creator calls this video.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  title: string | null;

  @ApiProperty({ description: 'Caption shown with it.', nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  caption: string | null;

  @ApiProperty({ description: 'Position within the Chapter’s media.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  orderIndex: number;

  @ApiProperty({
    description: 'Whether this is the Chapter’s headline video.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  isPrimary: boolean;

  @ApiProperty({ description: 'User who added the video.' })
  @Column({ type: 'uuid', nullable: false })
  createdByUserId: string;

  @ApiProperty({ description: 'User who last changed it.' })
  @Column({ type: 'uuid', nullable: false })
  updatedByUserId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;

  /**
   * Builds the embed URL a reader's browser should load.
   *
   * Built here from the stored identifiers rather than stored as a string, so
   * there is no field a creator could ever have influenced the shape of, and
   * so a change of embed policy applies to every video already saved.
   *
   * @returns The no-cookie embed URL.
   */
  get embedUrl(): string {
    const parameters = new URLSearchParams();

    if (this.playlistId) {
      parameters.set('list', this.playlistId);
    }

    if (this.startSeconds !== null) {
      parameters.set('start', String(this.startSeconds));
    }

    if (this.endSeconds !== null) {
      parameters.set('end', String(this.endSeconds));
    }

    const query = parameters.toString();

    return `${YOUTUBE_EMBED_HOST}/embed/${this.externalId}${query ? `?${query}` : ''}`;
  }

  /**
   * Builds the still image shown before a reader asks for playback.
   *
   * Served from YouTube's image host, which sets no cookies, so a reader who
   * never presses play is never announced to anybody.
   *
   * This is the size YouTube holds for every video ever uploaded, which is
   * what makes it the one to fall back to: 480 across, and 4:3, so a 16:9
   * video arrives with bars that the reader page crops off.
   *
   * @returns The thumbnail URL.
   */
  get thumbnailUrl(): string {
    return `https://i.ytimg.com/vi/${this.externalId}/hqdefault.jpg`;
  }

  /**
   * Builds the largest still YouTube may hold for the video.
   *
   * 1280 across and genuinely 16:9, which is what a still shown at the width
   * of a Chapter needs to be. It is not produced for every video — older and
   * low-resolution uploads have none — so it is offered alongside
   * `thumbnailUrl` rather than in place of it, and the page that asks for it
   * has to be ready for a miss.
   *
   * @returns The full-size thumbnail URL.
   */
  get thumbnailHdUrl(): string {
    return `https://i.ytimg.com/vi/${this.externalId}/maxresdefault.jpg`;
  }
}
