import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from 'src/auth/public.decorator';

import { ImageAddressRenewalService } from './delivery/image-address-renewal.service';
import {
  RenewedImageAddressesDto,
  RenewImageAddressesDto,
} from './dto/renew-image-addresses.dto';

/**
 * Renews expired picture addresses for a page left open.
 *
 * `@Public` because a signed-out visitor sees pictures too. What it gives
 * back is no more than the address it was sent already allowed, and only
 * for a day after that address expired.
 */
@ApiTags('File assets')
@Controller('file-assets')
export class ImageAddressRenewalController {
  /**
   * Creates an instance of ImageAddressRenewalController.
   *
   * @param _renewal - Checks and renews the addresses.
   */
  constructor(private readonly _renewal: ImageAddressRenewalService) {}

  /**
   * Renews picture addresses. The global `ImageUrlSigningInterceptor` signs
   * what this returns, as it signs every response.
   *
   * @param body - The addresses that would not load.
   * @returns Each renewed, or null.
   */
  @Public()
  @Post('image-addresses/renew')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renew expired picture addresses' })
  @ApiBody({ type: RenewImageAddressesDto })
  @ApiOkResponse({ type: RenewedImageAddressesDto })
  renew(@Body() body: RenewImageAddressesDto): RenewedImageAddressesDto {
    return { addresses: this._renewal.renew(body.addresses) };
  }
}
