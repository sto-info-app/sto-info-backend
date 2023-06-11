import { Controller } from '@nestjs/common';
// import { PlatformLauncherService } from './platform-launcher.service';
// import { CreatePlatformLauncherDto } from './dto/create-platform-launcher.dto';
// import { UpdatePlatformLauncherDto } from './dto/update-platform-launcher.dto';

@Controller('platform-launcher')
export class PlatformLauncherController {
  /*constructor(
    private readonly platformLauncherService: PlatformLauncherService,
  ) {}

  @Post()
  create(@Body() createPlatformLauncherDto: CreatePlatformLauncherDto) {
    return this.platformLauncherService.create(createPlatformLauncherDto);
  }

  @Get()
  findAll() {
    return this.platformLauncherService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.platformLauncherService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updatePlatformLauncherDto: UpdatePlatformLauncherDto,
  ) {
    return this.platformLauncherService.update(+id, updatePlatformLauncherDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.platformLauncherService.remove(+id);
  }*/
}
