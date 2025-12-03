import { Controller } from '@nestjs/common';
// import { UserRefreshTokenService } from './user-refresh-token.service';

@Controller('refresh-token')
export class UserRefreshTokenController {
  // constructor(private readonly refreshTokenService: UserRefreshTokenService) {}
  constructor() {}

  // @Post()
  // create(@Body() createUserRefreshTokenDto: CreateUserRefreshTokenDto) {
  //   return this.refreshTokenService.create(createUserRefreshTokenDto);
  // }

  // @Get()
  // findAll() {
  //   return this.refreshTokenService.findAll();
  // }

  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.refreshTokenService.findOne(+id);
  // }

  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateUserRefreshTokenDto: UpdateUserRefreshTokenDto) {
  //   return this.refreshTokenService.update(+id, updateUserRefreshTokenDto);
  // }

  // @Delete(':id')
  // remove(@Param('id') id: string) {
  //   return this.refreshTokenService.remove(+id);
  // }
}
