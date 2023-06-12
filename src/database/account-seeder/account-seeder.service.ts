import { Injectable } from '@nestjs/common';
import { LauncherService } from 'src/sto/launcher/launcher.service';
import { PlatformLauncherService } from 'src/sto/platform-launcher/platform-launcher.service';
import { PlatformService } from 'src/sto/platform/platform.service';

@Injectable()
export class AccountSeederService {
  constructor(
    private platformService: PlatformService,
    private launcherService: LauncherService,
    private platformLauncherService: PlatformLauncherService,
  ) {}

  async seed() {
    await this.seedPlatforms();
    await this.seedLaunchers();
    await this.seedPlatformLaunchers();
  }

  private async seedPlatforms() {
    const platforms = ['Windows', 'PlayStation', 'Xbox'];
    for (const platform of platforms) {
      const existingPlatform = await this.platformService.findOneByName(
        platform,
      );
      if (!existingPlatform) {
        await this.platformService.create({ name: platform });
      }
    }
  }

  private async seedLaunchers() {
    const launchers = ['Arc', 'Epic', 'Steam', 'N/A'];
    for (const launcher of launchers) {
      const existingLauncher = await this.launcherService.findOneByName(
        launcher,
      );
      if (!existingLauncher) {
        await this.launcherService.create({ name: launcher });
      }
    }
  }

  private async seedPlatformLaunchers() {
    const platformLauncherCombinations = [
      { platform: 'Windows', launcher: 'Arc' },
      { platform: 'Windows', launcher: 'Epic' },
      { platform: 'Windows', launcher: 'Steam' },
      { platform: 'Windows', launcher: 'N/A' },
      { platform: 'PlayStation', launcher: 'N/A' },
      { platform: 'Xbox', launcher: 'N/A' },
    ];

    for (const combo of platformLauncherCombinations) {
      const platform = await this.platformService.findOneByName(combo.platform);
      const launcher = await this.launcherService.findOneByName(combo.launcher);

      if (platform && launcher) {
        const existingCombo = await this.platformLauncherService.findOne(
          platform.id,
          launcher.id,
        );
        if (!existingCombo) {
          await this.platformLauncherService.addPlatformLauncherRelation(
            platform.id,
            launcher.id,
          );
        }
      }
    }
  }
}
