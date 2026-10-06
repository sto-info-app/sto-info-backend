import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, In } from 'typeorm';

import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { recordSiteAdminAction } from 'src/audit/site-admin/site-admin-action.utility';
import { usernamesFor } from 'src/fleet/recruitment/utilities/recruitment-names.utility';

import { AppSettingEntity } from '../entities/app-setting.entity';
import { SettingsService } from '../settings.service';
import {
  FEATURE_SWITCH_SUBJECT_KIND,
  FEATURE_SWITCHES,
  FeatureSwitch,
  FeatureSwitchDefinition,
} from './feature-switch.constants';
import { FeatureSubFlagDto, FeatureSwitchDto } from './feature-switch.dto';

/**
 * Reads a master switch's stored value as `SettingsService.getBoolean` does:
 * only "true" is on, so a missing or mistyped value leaves the feature off.
 *
 * @param value - The stored value, or null when the row is missing.
 * @returns Whether the feature is on.
 */
function isOn(value: string | null): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/**
 * The site features' master switches, thrown from the Admin page (FC-045):
 * Fleet Communities, Storytime and Custom Tracking.
 *
 * Steve's decisions of 6 October 2026: no feature switch is left needing
 * SQL, each change takes a reason and is kept in the site admin log, and the
 * capability flags beneath each switch, which the environment sets, are shown
 * but cannot be changed here.
 *
 * None of these switches reaches the file gate: scanning, quarantine and
 * publication run whatever they say.
 */
@Injectable()
export class FeatureSwitchesService {
  private readonly _logger = new Logger(FeatureSwitchesService.name);

  /**
   * Creates an instance of FeatureSwitchesService.
   *
   * @param _dataSource - The database, for the switches and their log entry.
   * @param _settings - Writes a switch and drops this instance's cached copy.
   * @param _config - Where the capability flags are read from.
   */
  constructor(
    @InjectDataSource() private readonly _dataSource: DataSource,
    private readonly _settings: SettingsService,
    private readonly _config: ConfigService,
  ) {}

  /**
   * Every switch as the database holds it now, not as the settings cache
   * last read it.
   *
   * @returns The switches, in the order the Admin page lists them.
   */
  async list(): Promise<FeatureSwitchDto[]> {
    const manager = this._dataSource.manager;
    const rows = await manager.find(AppSettingEntity, {
      where: { key: In(FEATURE_SWITCHES.map(({ settingKey }) => settingKey)) },
    });
    const byKey = new Map(rows.map(row => [row.key, row]));
    const names = await usernamesFor(
      manager,
      rows.map(row => row.updatedByUserId),
    );

    return FEATURE_SWITCHES.map(definition =>
      this.describe(definition, byKey.get(definition.settingKey), names),
    );
  }

  /**
   * One switch as the database holds it now.
   *
   * @param feature - The feature.
   * @returns Its switch.
   */
  async read(feature: FeatureSwitch): Promise<FeatureSwitchDto> {
    return (await this.list()).find(entry => entry.feature === feature)!;
  }

  /**
   * Switches a feature on or off, and logs it with the reason.
   *
   * The row is locked while it is read and written, so two site admins
   * throwing the same switch at once cannot both succeed: the second finds it
   * already thrown.
   *
   * @param feature - The feature.
   * @param isEnabled - Whether it should be on.
   * @param adminUserId - The site admin.
   * @param reason - Why, for the site admin log.
   * @returns The switch as it now stands.
   * @throws NotFoundException when the switch's setting is missing.
   * @throws ConflictException when it is already in that position.
   */
  async set(
    feature: FeatureSwitch,
    isEnabled: boolean,
    adminUserId: string,
    reason: string,
  ): Promise<FeatureSwitchDto> {
    const definition = this.definitionOf(feature);

    await this._dataSource.transaction(async manager => {
      const current = await this.lock(manager, definition);

      if (isOn(current.value) === isEnabled) {
        throw new ConflictException(
          `${definition.label} is already switched ${isEnabled ? 'on' : 'off'}.`,
        );
      }

      await this._settings.setValue(
        definition.settingKey,
        String(isEnabled),
        adminUserId,
        manager,
      );
      await recordSiteAdminAction(manager, {
        action: isEnabled
          ? SiteAdminActionKind.FEATURE_SWITCHED_ON
          : SiteAdminActionKind.FEATURE_SWITCHED_OFF,
        actorUserId: adminUserId,
        subject: { kind: FEATURE_SWITCH_SUBJECT_KIND, id: feature },
        reason,
      });
    });

    this._logger.warn(
      `[set] ${feature} switched ${isEnabled ? 'on' : 'off'} - AdminId: ${adminUserId}`,
    );

    return this.read(feature);
  }

  /**
   * A feature's definition.
   *
   * @param feature - The feature.
   * @returns Its definition.
   * @throws NotFoundException for a feature with no switch here.
   */
  private definitionOf(feature: FeatureSwitch): FeatureSwitchDefinition {
    const definition = FEATURE_SWITCHES.find(
      entry => entry.feature === feature,
    );

    if (definition === undefined) {
      throw new NotFoundException('There is no such feature switch.');
    }

    return definition;
  }

  /**
   * Reads a switch's row and holds it until the transaction ends.
   *
   * @param manager - The transaction.
   * @param definition - The switch.
   * @returns Its row.
   * @throws NotFoundException when the row is missing.
   */
  private async lock(
    manager: EntityManager,
    definition: FeatureSwitchDefinition,
  ): Promise<AppSettingEntity> {
    const row = await manager.findOne(AppSettingEntity, {
      where: { key: definition.settingKey },
      lock: { mode: 'pessimistic_write' },
    });

    if (row === null) {
      throw new NotFoundException(
        `${definition.label}'s switch is missing from the database.`,
      );
    }

    return row;
  }

  /**
   * Describes a switch for the Admin page.
   *
   * @param definition - The switch.
   * @param row - Its setting, when it exists.
   * @param names - Usernames by account ID.
   * @returns The description.
   */
  private describe(
    definition: FeatureSwitchDefinition,
    row: AppSettingEntity | undefined,
    names: Map<string, string>,
  ): FeatureSwitchDto {
    const changedBy = row?.updatedByUserId ?? null;

    return {
      feature: definition.feature,
      label: definition.label,
      isEnabled: isOn(row?.value ?? null),
      changedAt: row?.updatedAt ?? null,
      changedByUsername:
        changedBy === null ? null : (names.get(changedBy) ?? null),
      subFlags: definition.subFlags.map((flag): FeatureSubFlagDto => ({
        key: flag.key,
        label: flag.label,
        isEnabled: this.readFlag(flag.key),
      })),
    };
  }

  /**
   * Reads a capability flag as each feature's own service does: unset or
   * unreadable counts as allowed, and only "false" turns it off.
   *
   * @param key - The environment variable.
   * @returns Whether the environment allows it.
   */
  private readFlag(key: string): boolean {
    const configured = this._config.get<string | boolean>(key);

    if (configured === undefined || configured === null) {
      return true;
    }

    return String(configured).trim().toLowerCase() !== 'false';
  }
}
