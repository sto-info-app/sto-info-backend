import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { AccountService } from './account.service';
import { CreateAccountRequestDto } from './dto/create-account-request.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@ApiTags('STO Account APIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('account')
export class AccountController {
  /**
   * Creates an instance of AccountController.
   *
   * @param _accountService - The account service.
   */
  constructor(private readonly _accountService: AccountService) {}

  /**
   * Creates a new STO account for the authenticated user.
   *
   * @param userId Authenticated user ID (injected).
   * @param createAccountDto Request payload.
   * @returns The created account.
   */
  @Post()
  @ApiOkResponse({ description: 'Successfully created the account.' })
  @ApiBadRequestResponse({ description: 'Failed to create the account.' })
  create(
    @UserId() userId: string,
    @Body() createAccountDto: CreateAccountRequestDto,
  ) {
    const account: CreateAccountDto = {
      ...createAccountDto,
      userId,
    };

    return this._accountService.create(account);
  }

  /**
   * Lists all STO accounts for the authenticated user.
   *
   * @param userId Authenticated user ID (injected).
   * @returns The user's accounts.
   */
  @Get()
  @ApiOkResponse({ description: "Successfully found the user's STO accounts." })
  @ApiBadRequestResponse({
    description: "The user's accounts cannot be found.",
  })
  @HttpCode(HttpStatus.OK)
  findAllUsersAccounts(@UserId() userId: string) {
    return this._accountService.findAllUsersAccounts(userId);
  }

  /**
   * Retrieves a single STO account by ID for the authenticated user.
   *
   * @param userId Authenticated user ID (injected).
   * @param id Account ID.
   * @returns The requested account.
   */
  @Get(':id')
  @ApiOkResponse({ description: 'Successfully found the account.' })
  @ApiBadRequestResponse({ description: 'Failed to find the account.' })
  findOne(@UserId() userId: string, @Param('id') id: string) {
    return this._accountService.findOneForUser(id, userId);
  }

  /**
   * Updates a STO account for the authenticated user.
   *
   * @param userId Authenticated user ID (injected).
   * @param id Account ID.
   * @param updateAccountDto Partial update payload.
   * @returns The updated account.
   */
  @Put(':id')
  @ApiOkResponse({ description: 'Successfully updated the account.' })
  @ApiBadRequestResponse({ description: 'Failed to update the account.' })
  update(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() updateAccountDto: UpdateAccountDto,
  ) {
    return this._accountService.updateForUser(id, userId, updateAccountDto);
  }

  /**
   * Removes (soft-deletes) a STO account for the authenticated user.
   *
   * @param userId Authenticated user ID (injected).
   * @param id Account ID.
   */
  @Delete(':id')
  @ApiOkResponse({ description: 'Successfully removed the account.' })
  @ApiBadRequestResponse({ description: 'Failed to remove the account.' })
  remove(@UserId() userId: string, @Param('id') id: string) {
    return this._accountService.removeForUser(id, userId);
  }
}
