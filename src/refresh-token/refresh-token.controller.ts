import { Controller } from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';

@Controller('refresh-token')
export class RefreshTokenController {
  constructor(private readonly refreshTokenService: RefreshTokenService) {}

  // @Post()
  // create(@Body() createRefreshTokenDto: CreateRefreshTokenDto) {
  //   return this.refreshTokenService.create(createRefreshTokenDto);
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
  // update(@Param('id') id: string, @Body() updateRefreshTokenDto: UpdateRefreshTokenDto) {
  //   return this.refreshTokenService.update(+id, updateRefreshTokenDto);
  // }

  // @Delete(':id')
  // remove(@Param('id') id: string) {
  //   return this.refreshTokenService.remove(+id);
  // }
}
