import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { User } from './entities/user.entity';
import { UserService } from './user.service';

@ApiTags('App User')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @ApiOkResponse({ description: 'Successfully found the user.' })
  @ApiBadRequestResponse({ description: 'The user cannot be found.' })
  @UseGuards(JwtAuthGuard)
  // @UseGuards(AuthGuard('jwt'))
  @Get()
  @HttpCode(HttpStatus.OK)
  findUser(@Req() req) {
    const user: User = req.user; //NOTE: Force typing!
    return user;
  }

  // @Post()
  // @ApiBody({ type: CreateUserDto })
  // @ApiResponse({ status: 201, type: User })
  // @HttpCode(HttpStatus.OK)
  // async create(@Body() createUserDto: CreateUserDto) {
  //   return await this.userService.create(createUserDto);
  // }

  // @ApiOkResponse({ description: 'Successfully found the user.' })
  // @ApiBadRequestResponse({ description: 'The user cannot be found.' })
  // @Get(':id')
  // @HttpCode(HttpStatus.OK)
  // findById(@Param('id') id: string) {
  //   return this.userService.findById(id);
  // }

  // @Patch(':id')
  // @HttpCode(HttpStatus.OK)
  // update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
  //   return this.userService.update(id, updateUserDto);
  // }

  // @Delete(':id')
  // @HttpCode(HttpStatus.OK)
  // remove(@Param('id') id: string) {
  //   return this.userService.delete(id);
  // }
}
