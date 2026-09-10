import { ApiProperty } from '@nestjs/swagger';

/**
 * Markdown rendered exactly as a reader will receive it.
 *
 * Only the HTML. The figures the renderer also derives — word count, reading
 * minutes, how many blocks it produced — belong to a saved Chapter and are
 * served with it; repeating them against unsaved text would invite a client to
 * show a creator a reading time for a draft nobody can read.
 */
export class ContentPreviewDto {
  @ApiProperty({
    description:
      'The rendered, sanitised HTML. Identical to what the same source would produce on save.',
  })
  readonly html: string;
}
