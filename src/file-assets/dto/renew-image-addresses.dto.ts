import { ApiProperty } from '@nestjs/swagger';

import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';

import { MAX_RENEWED_ADDRESSES } from '../delivery/image-address-renewal.service';

/** The picture addresses a page could not load. */
export class RenewImageAddressesDto {
  @ApiProperty({
    description: 'Signed picture addresses that have expired.',
    type: [String],
    maxItems: MAX_RENEWED_ADDRESSES,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RENEWED_ADDRESSES)
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  readonly addresses: string[];
}

/** The renewed addresses, in the order they were asked for. */
export class RenewedImageAddressesDto {
  @ApiProperty({
    description:
      'Each picture signed again, the "photo unavailable" picture in place ' +
      'of one that may no longer be shown, or null for an address that may ' +
      'not be renewed.',
    type: [String],
    nullable: true,
  })
  readonly addresses: (string | null)[];
}
