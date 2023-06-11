import { Controller } from '@nestjs/common';
// import { LauncherService } from './launcher.service';
// import { CreateLauncherDto } from './dto/create-launcher.dto';
// import { UpdateLauncherDto } from './dto/update-launcher.dto';

@Controller('launcher')
export class LauncherController {
  /*constructor(private readonly launcherService: LauncherService) {}

  @Post()
  create(@Body() createLauncherDto: CreateLauncherDto) {
    return this.launcherService.create(createLauncherDto);
  }

  @Get()
  findAll() {
    return this.launcherService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.launcherService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateLauncherDto: UpdateLauncherDto,
  ) {
    return this.launcherService.update(+id, updateLauncherDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.launcherService.remove(+id);
  }*/
}
