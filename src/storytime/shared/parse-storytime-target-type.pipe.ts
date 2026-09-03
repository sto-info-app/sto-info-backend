import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

import { StorytimeTargetType } from '../enums/storytime-target-type.enum';

/**
 * Reads the kind of content out of a URL.
 *
 * The vocabulary is shared with the database, where the values are upper case,
 * but a URL is no place for shouting: the routes read `story` and this turns it
 * back into the `STORY` the rest of the code works in. Upper case is still
 * accepted, so a link made before the routes were lowered still resolves.
 *
 * It is also the first validation these segments have had. Until now an unknown
 * word travelled from the URL all the way into a query as though it named a
 * kind of content, and came back with nothing rather than an explanation.
 */
@Injectable()
export class ParseStorytimeTargetTypePipe implements PipeTransform<
  string,
  StorytimeTargetType
> {
  /**
   * Turns a URL segment into the kind of content it names.
   *
   * @param value - The segment, in either case.
   * @returns The kind of content.
   * @throws BadRequestException When the segment names nothing.
   */
  transform(value: string): StorytimeTargetType {
    const candidate = value.toUpperCase() as StorytimeTargetType;

    if (!Object.values(StorytimeTargetType).includes(candidate)) {
      throw new BadRequestException('Unknown kind of content.');
    }

    return candidate;
  }
}
