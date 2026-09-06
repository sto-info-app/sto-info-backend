import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import {
  AcceptCustomTrackingPolicyDto,
  CustomTrackingAgreementDto,
  CustomTrackingPolicyStatusDto,
} from '../dto/custom-tracking-policy.dto';
import { CustomTrackingPolicyService } from './custom-tracking-policy.service';

/**
 * Reading the content agreement, and accepting it.
 *
 * Reading the agreement needs an account but nothing else: a user has to be
 * able to see what they are being asked to agree to before they agree to it,
 * and after, whenever they want to check.
 */
@ApiTags('Custom Tracking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('custom-tracking')
export class CustomTrackingPolicyController {
  /**
   * Creates an instance of CustomTrackingPolicyController.
   *
   * @param _policy - The agreement, and who has accepted which version.
   */
  constructor(private readonly _policy: CustomTrackingPolicyService) {}

  /**
   * Returns the agreement as a user should read it.
   *
   * @returns The current wording, version and dates.
   */
  @Get('agreement')
  @ApiOperation({ summary: 'Read the Custom Tracking content agreement' })
  @ApiOkResponse({ type: CustomTrackingAgreementDto })
  getAgreement(): CustomTrackingAgreementDto {
    const agreement = this._policy.getAgreement();

    return {
      version: agreement.version,
      effectiveDate: agreement.effectiveDate,
      updatedDate: agreement.updatedDate,
      title: agreement.title,
      sections: agreement.sections.map(section => ({
        heading: section.heading,
        paragraphs: [...section.paragraphs],
        bullets: [...section.bullets],
      })),
    };
  }

  /**
   * Reports where the caller stands with the agreement.
   *
   * @param userId - The caller.
   * @returns Their acceptance status.
   */
  @Get('agreement/status')
  @ApiOperation({ summary: 'See whether you have accepted the agreement' })
  @ApiOkResponse({ type: CustomTrackingPolicyStatusDto })
  getStatus(@UserId() userId: string): Promise<CustomTrackingPolicyStatusDto> {
    return this._policy.getStatus(userId);
  }

  /**
   * Records the caller's acceptance.
   *
   * The version the interface displayed has to be sent with it, and has to be
   * the one currently published. A page left open across a wording change
   * would otherwise record agreement to terms the user never saw.
   *
   * @param userId - The caller.
   * @param body - The version they were shown.
   * @returns Their acceptance status afterwards.
   */
  @Post('agreement/acceptance')
  @ApiOperation({ summary: 'Accept the Custom Tracking content agreement' })
  @ApiOkResponse({ type: CustomTrackingPolicyStatusDto })
  @ApiConflictResponse({
    description: 'The agreement changed since the page was opened.',
  })
  accept(
    @UserId() userId: string,
    @Body() body: AcceptCustomTrackingPolicyDto,
  ): Promise<CustomTrackingPolicyStatusDto> {
    return this._policy.accept(userId, body.acceptedVersion);
  }
}
