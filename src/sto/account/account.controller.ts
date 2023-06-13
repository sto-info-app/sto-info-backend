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
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AccountService } from './account.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@ApiTags('STO Account APIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Post()
  @ApiOkResponse({ description: 'Successfully created the account.' })
  @ApiBadRequestResponse({ description: 'Failed to create the account.' })
  create(@Body() createAccountDto: CreateAccountDto) {
    return this.accountService.create(createAccountDto);
  }

  @Get()
  @ApiOkResponse({ description: "Successfully found the user's STO accounts." })
  @ApiBadRequestResponse({
    description: "The user's accounts cannot be found.",
  })
  @HttpCode(HttpStatus.OK)
  findAllUsersAccounts(@Req() req) {
    return this.accountService.findAllUsersAccounts(req.user.id);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Successfully found the account.' })
  @ApiBadRequestResponse({ description: 'Failed to find the account.' })
  findOne(@Param('id') id: string) {
    return this.accountService.findOne(id);
  }

  @Put(':id')
  @ApiOkResponse({ description: 'Successfully updated the account.' })
  @ApiBadRequestResponse({ description: 'Failed to update the account.' })
  update(@Param('id') id: string, @Body() updateAccountDto: UpdateAccountDto) {
    return this.accountService.update(id, updateAccountDto);
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Successfully removed the account.' })
  @ApiBadRequestResponse({ description: 'Failed to remove the account.' })
  remove(@Param('id') id: string) {
    return this.accountService.remove(id);
  }
}
