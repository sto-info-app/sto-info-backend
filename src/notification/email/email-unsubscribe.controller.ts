import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from 'src/auth/public.decorator';
import { UserPreferenceService } from 'src/user/user-preference.service';

import {
  EmailUnsubscribeTokenService,
  UnsubscribeClaim,
} from './email-unsubscribe-token.service';
import {
  NOTIFICATION_EMAIL_TYPES,
  NotificationEmailType,
} from './notification-email-type.enum';

/** One email an unsubscribe link turns off. */
export class UnsubscribeTypeDto {
  @ApiProperty({ enum: NotificationEmailType })
  type: NotificationEmailType;

  @ApiProperty({ description: 'Its label on Settings.' })
  label: string;
}

/** What an unsubscribe link turns off. */
export class UnsubscribeDto {
  @ApiProperty({ type: [UnsubscribeTypeDto] })
  types: UnsubscribeTypeDto[];
}

/** Refused for a link this server did not sign. */
const INVALID_LINK = 'That unsubscribe link is not valid.';

/**
 * Turns notification emails off from the links in them, without signing in
 * (sc-1067).
 *
 * Reading a link changes nothing, so a mail scanner fetching it does no
 * harm; the frontend's confirm page and an email client's one-click
 * unsubscribe (RFC 8058) both post.
 */
@ApiTags('Email preferences')
@Controller('email-preferences')
export class EmailUnsubscribeController {
  /**
   * Creates an instance of EmailUnsubscribeController.
   *
   * @param _tokens - Checks the links.
   * @param _preferences - Turns the emails off.
   */
  constructor(
    private readonly _tokens: EmailUnsubscribeTokenService,
    private readonly _preferences: UserPreferenceService,
  ) {}

  /**
   * Says what a link would turn off.
   *
   * @param token - The link's token.
   * @returns The emails it names.
   */
  @Public()
  @Get('unsubscribe')
  @ApiOperation({ summary: 'Say what an unsubscribe link turns off' })
  @ApiQuery({ name: 'token', required: true })
  @ApiOkResponse({ type: UnsubscribeDto })
  @ApiBadRequestResponse({ description: INVALID_LINK })
  preview(@Query('token') token: string): UnsubscribeDto {
    return this.describe(this.claimOf(token));
  }

  /**
   * Turns off the emails a link names.
   *
   * @param token - The link's token.
   * @returns The emails turned off.
   */
  @Public()
  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Turn off the emails an unsubscribe link names',
    description:
      'Also the RFC 8058 one-click address, which posts List-Unsubscribe=One-Click.',
  })
  @ApiQuery({ name: 'token', required: true })
  @ApiOkResponse({ type: UnsubscribeDto })
  @ApiBadRequestResponse({ description: INVALID_LINK })
  async unsubscribe(@Query('token') token: string): Promise<UnsubscribeDto> {
    const claim = this.claimOf(token);

    await this._preferences.update(claim.userId, {
      emailNotifications: Object.fromEntries(
        claim.types.map(type => [type, false]),
      ),
    });

    return this.describe(claim);
  }

  /**
   * Checks a token.
   *
   * @param token - The token.
   * @returns Its claim.
   * @throws BadRequestException when it is not valid.
   */
  private claimOf(token: string): UnsubscribeClaim {
    const claim = this._tokens.verify(token);

    if (claim === null) {
      throw new BadRequestException(INVALID_LINK);
    }

    return claim;
  }

  /**
   * Names the emails a claim covers.
   *
   * @param claim - The claim.
   * @returns Each type with its label.
   */
  private describe(claim: UnsubscribeClaim): UnsubscribeDto {
    return {
      types: claim.types.map(type => ({
        type,
        label: NOTIFICATION_EMAIL_TYPES[type].label,
      })),
    };
  }
}
