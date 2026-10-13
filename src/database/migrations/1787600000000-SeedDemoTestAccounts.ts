import { randomUUID } from 'node:crypto';

import * as bcrypt from 'bcrypt';
import { MigrationInterface, QueryRunner } from 'typeorm';

import { loadsDemoData } from '../../shared/constants/environment.constants';

interface SeedLookupData {
  generalFactions: Array<{ id: string }>;
  factions: Array<{ id: string }>;
  sexes: Array<{ id: string }>;
  characterClasses: Array<{ id: string }>;
  species: Array<{ id: string }>;
  recruitTypes: Array<{ id: string }>;
  perkIds: string[];
}

interface DemoCharacter {
  index: number;
  accountIndex: number;
  characterIndex: number;
  accountId: string;
  characterId: string;
  characterHandle: string;
  fullHandle: string;
}

interface CharacterLookupIds {
  generalFactionId: string;
  factionId: string;
  sexId: string;
  classId: string;
  recruitTypeId: string;
  speciesId: string;
}

export class SeedDemoTestAccounts1787600000000 implements MigrationInterface {
  name = 'SeedDemoTestAccounts1787600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!this.shouldLoadTestData()) {
      return;
    }

    const password = this.getSeedPassword();

    await queryRunner.startTransaction();

    try {
      const lookupData = await this.loadLookupData(queryRunner);
      const passwordHash = await bcrypt.hash(password, 10);

      for (let index = 0; index < 118; index += 1) {
        await this.seedUser(queryRunner, lookupData, passwordHash, index);
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!this.shouldLoadTestData()) {
      return;
    }

    await queryRunner.startTransaction();

    try {
      await queryRunner.query(
        `DELETE FROM "sto_info_app"."user_profile" WHERE "username" LIKE 'demo-user-%'`,
      );
      await queryRunner.query(
        `DELETE FROM "sto_info_app"."character" WHERE "fullHandle" LIKE '%@demo-%'`,
      );
      await queryRunner.query(
        `DELETE FROM "sto_info_app"."account_endeavour_progress" WHERE "accountId" IN (
          SELECT "id" FROM "sto_info_app"."account" WHERE "handle" LIKE 'demo-%'
        )`,
      );
      await queryRunner.query(
        `DELETE FROM "sto_info_app"."account" WHERE "handle" LIKE 'demo-%'`,
      );
      await queryRunner.query(
        `DELETE FROM "sto_info_app"."user" WHERE "email" LIKE 'demo-user-%@example.com'`,
      );

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    }
  }

  // The seed helpers below keep each statement's SQL exactly as first
  // released, indentation included, because this migration may have run.
  private async seedUser(
    queryRunner: QueryRunner,
    lookupData: SeedLookupData | null,
    passwordHash: string,
    index: number,
  ): Promise<void> {
    const userId = randomUUID();
    const email = this.buildEmail(index);
    const username = this.buildUsername(index);
    const firstName = this.buildFirstName(index);
    const lastName = this.buildLastName(index);
    const accountCount = 1 + (index % 4);

    await queryRunner.query(
      `
            INSERT INTO "sto_info_app"."user"
              ("id", "email", "password", "emailVerified", "role", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, true, 'USER', $4, $5)
          `,
      [
        userId,
        email,
        passwordHash,
        this.buildTimestamp(index, 2024),
        this.buildTimestamp(index, 2024),
      ],
    );

    await queryRunner.query(
      `
            INSERT INTO "sto_info_app"."user_profile"
              ("userId", "username", "firstName", "lastName", "publiclyVisible", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
      [
        userId,
        username,
        firstName,
        lastName,
        index % 3 !== 0,
        this.buildTimestamp(index, 2024),
        this.buildTimestamp(index, 2024),
      ],
    );

    for (let accountIndex = 0; accountIndex < accountCount; accountIndex += 1) {
      await this.seedAccount(
        queryRunner,
        lookupData,
        userId,
        index,
        accountIndex,
      );
    }
  }

  private async seedAccount(
    queryRunner: QueryRunner,
    lookupData: SeedLookupData | null,
    userId: string,
    index: number,
    accountIndex: number,
  ): Promise<void> {
    const accountId = randomUUID();
    const handle = this.buildAccountHandle(index, accountIndex);
    const accountEmail = this.buildAccountEmail(index, accountIndex);
    const accountCreatedDate = this.buildAccountCreatedDate(
      index,
      accountIndex,
    );
    const isPubliclyVisible = accountIndex % 2 === 0;
    const lifetimeSubscription = accountIndex % 3 === 0;

    await queryRunner.query(
      `
              INSERT INTO "sto_info_app"."account"
                ("id", "userId", "handle", "handleNormalized", "handleSlug", "username", "email",
                 "notes", "accountCreatedDate", "publiclyVisible", "lifetimeSubscription", "createdAt", "updatedAt")
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `,
      [
        accountId,
        userId,
        handle,
        this.normalizeHandle(handle),
        this.toSlug(handle),
        `${handle}-demo`,
        accountEmail,
        this.buildAccountNotes(index, accountIndex),
        accountCreatedDate,
        isPubliclyVisible,
        lifetimeSubscription,
        accountCreatedDate,
        accountCreatedDate,
      ],
    );

    const characterCount = this.getCharacterCount(index, accountIndex);
    for (
      let characterIndex = 0;
      characterIndex < characterCount;
      characterIndex += 1
    ) {
      const characterId = randomUUID();
      const characterHandle = this.buildCharacterHandle(
        index,
        accountIndex,
        characterIndex,
      );

      await this.seedCharacter(queryRunner, lookupData, {
        index,
        accountIndex,
        characterIndex,
        accountId,
        characterId,
        characterHandle,
        fullHandle: `${characterHandle}@${handle}`,
      });
    }

    await this.seedProgress(
      queryRunner,
      lookupData,
      accountId,
      index,
      accountIndex,
    );
  }

  private async seedCharacter(
    queryRunner: QueryRunner,
    lookupData: SeedLookupData | null,
    character: DemoCharacter,
  ): Promise<void> {
    if (lookupData) {
      await queryRunner.query(
        `
                  INSERT INTO "sto_info_app"."character"
                    ("id", "accountId", "handle", "fullHandleNormalized", "fullHandleSlug", "fullHandle",
                     "generalFactionId", "factionId", "sexId", "classId", "recruitTypeId", "speciesId",
                     "createdDate", "firstName", "lastName", "biography", "notes", "publiclyVisible",
                     "createdAt", "updatedAt")
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
                `,
        this.buildCharacterParameters(
          character,
          this.pickLookupIds(lookupData, character),
        ),
      );
      return;
    }

    const fallbackIds = this.pickFallbackIds(lookupData, character);

    if (!fallbackIds) {
      return;
    }

    await queryRunner.query(
      `
                INSERT INTO "sto_info_app"."character"
                  ("id", "accountId", "handle", "fullHandleNormalized", "fullHandleSlug", "fullHandle",
                   "generalFactionId", "factionId", "sexId", "classId", "recruitTypeId", "speciesId",
                   "createdDate", "firstName", "lastName", "biography", "notes", "publiclyVisible",
                   "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
              `,
      this.buildCharacterParameters(character, fallbackIds),
    );
  }

  private pickLookupIds(
    lookupData: SeedLookupData,
    character: DemoCharacter,
  ): CharacterLookupIds {
    const offset =
      character.index + character.accountIndex + character.characterIndex;

    return {
      generalFactionId:
        lookupData.generalFactions[offset % lookupData.generalFactions.length]
          .id,
      factionId: lookupData.factions[offset % lookupData.factions.length].id,
      sexId: lookupData.sexes[offset % lookupData.sexes.length].id,
      classId:
        lookupData.characterClasses[offset % lookupData.characterClasses.length]
          .id,
      recruitTypeId:
        lookupData.recruitTypes[offset % lookupData.recruitTypes.length].id,
      speciesId: lookupData.species[offset % lookupData.species.length].id,
    };
  }

  private pickFallbackIds(
    lookupData: SeedLookupData | null,
    character: DemoCharacter,
  ): CharacterLookupIds | null {
    const { index, accountIndex, characterIndex } = character;
    const fallbackLookupData = lookupData ?? {
      generalFactions: [] as Array<{ id: string }>,
      factions: [] as Array<{ id: string }>,
      sexes: [] as Array<{ id: string }>,
      characterClasses: [] as Array<{ id: string }>,
      species: [] as Array<{ id: string }>,
      recruitTypes: [] as Array<{ id: string }>,
      perkIds: [] as string[],
    };

    const fallbackGeneralFactionId = this.getFallbackLookupId(
      fallbackLookupData.generalFactions,
      index,
      accountIndex,
      characterIndex,
      0,
    );
    const fallbackFactionId = this.getFallbackLookupId(
      fallbackLookupData.factions,
      index,
      accountIndex,
      characterIndex,
      1,
    );
    const fallbackSexId = this.getFallbackLookupId(
      fallbackLookupData.sexes,
      index,
      accountIndex,
      characterIndex,
      2,
    );
    const fallbackClassId = this.getFallbackLookupId(
      fallbackLookupData.characterClasses,
      index,
      accountIndex,
      characterIndex,
      3,
    );
    const fallbackRecruitTypeId = this.getFallbackLookupId(
      fallbackLookupData.recruitTypes,
      index,
      accountIndex,
      characterIndex,
      4,
    );
    const fallbackSpeciesId = this.getFallbackLookupId(
      fallbackLookupData.species,
      index,
      accountIndex,
      characterIndex,
      5,
    );

    if (
      !fallbackGeneralFactionId ||
      !fallbackFactionId ||
      !fallbackSexId ||
      !fallbackClassId ||
      !fallbackRecruitTypeId ||
      !fallbackSpeciesId
    ) {
      return null;
    }

    return {
      generalFactionId: fallbackGeneralFactionId,
      factionId: fallbackFactionId,
      sexId: fallbackSexId,
      classId: fallbackClassId,
      recruitTypeId: fallbackRecruitTypeId,
      speciesId: fallbackSpeciesId,
    };
  }

  private buildCharacterParameters(
    character: DemoCharacter,
    ids: CharacterLookupIds,
  ): unknown[] {
    const { index, accountIndex, characterIndex, fullHandle } = character;

    return [
      character.characterId,
      character.accountId,
      character.characterHandle,
      this.normalizeHandle(fullHandle),
      this.toSlug(fullHandle),
      fullHandle,
      ids.generalFactionId,
      ids.factionId,
      ids.sexId,
      ids.classId,
      ids.recruitTypeId,
      ids.speciesId,
      this.buildCharacterCreatedDate(index, accountIndex, characterIndex),
      this.buildFirstName(index + characterIndex),
      this.buildLastName(index + accountIndex + characterIndex),
      this.buildBiography(index, accountIndex, characterIndex),
      this.buildCharacterNotes(index, accountIndex, characterIndex),
      characterIndex % 2 === 0,
      this.buildTimestamp(index + characterIndex, 2024),
      this.buildTimestamp(index + characterIndex, 2024),
    ];
  }

  private async seedProgress(
    queryRunner: QueryRunner,
    lookupData: SeedLookupData | null,
    accountId: string,
    index: number,
    accountIndex: number,
  ): Promise<void> {
    const progressCount = (index + accountIndex) % 3;
    const perkIds = lookupData?.perkIds ?? [];
    for (
      let progressIndex = 0;
      progressIndex < progressCount;
      progressIndex += 1
    ) {
      if (perkIds.length === 0) {
        continue;
      }

      const perkId =
        perkIds[(index + accountIndex + progressIndex) % perkIds.length];
      await queryRunner.query(
        `
                INSERT INTO "sto_info_app"."account_endeavour_progress"
                  ("id", "accountId", "endeavourPerkId", "currentNodes", "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6)
              `,
        [
          randomUUID(),
          accountId,
          perkId,
          (index + accountIndex + progressIndex) % 25,
          this.buildTimestamp(index + progressIndex, 2024),
          this.buildTimestamp(index + progressIndex, 2024),
        ],
      );
    }
  }

  private async loadLookupData(
    queryRunner: QueryRunner,
  ): Promise<SeedLookupData | null> {
    const requiredTables = [
      'character_general_faction',
      'character_faction',
      'character_sex',
      'character_class',
      'character_species',
      'character_recruit_type',
      'endeavour_perk',
    ];

    for (const tableName of requiredTables) {
      const exists = await queryRunner.hasTable(`sto_info_app.${tableName}`);
      if (!exists) {
        return null;
      }
    }

    const [
      generalFactions,
      factions,
      sexes,
      characterClasses,
      species,
      recruitTypes,
      perks,
    ] = await Promise.all([
      queryRunner.query(
        `SELECT "id" FROM "sto_info_app"."character_general_faction" ORDER BY "name"`,
      ),
      queryRunner.query(
        `SELECT "id" FROM "sto_info_app"."character_faction" ORDER BY "name"`,
      ),
      queryRunner.query(
        `SELECT "id" FROM "sto_info_app"."character_sex" ORDER BY "name"`,
      ),
      queryRunner.query(
        `SELECT "id" FROM "sto_info_app"."character_class" ORDER BY "name"`,
      ),
      queryRunner.query(
        `SELECT "id" FROM "sto_info_app"."character_species" ORDER BY "name"`,
      ),
      queryRunner.query(
        `SELECT "id" FROM "sto_info_app"."character_recruit_type" ORDER BY "name"`,
      ),
      queryRunner.query(
        `SELECT "id" FROM "sto_info_app"."endeavour_perk" ORDER BY "name"`,
      ),
    ]);

    return {
      generalFactions,
      factions,
      sexes,
      characterClasses,
      species,
      recruitTypes,
      perkIds: perks.map((perk: { id: string }) => perk.id),
    };
  }

  private buildEmail(index: number): string {
    return `demo-user-${String(index + 1).padStart(3, '0')}@example.com`;
  }

  private buildUsername(index: number): string {
    return `demo-user-${String(index + 1).padStart(3, '0')}`;
  }

  private buildAccountHandle(index: number, accountIndex: number): string {
    return `demo-${String(index + 1).padStart(3, '0')}-${String(accountIndex + 1).padStart(2, '0')}`;
  }

  private buildAccountEmail(index: number, accountIndex: number): string {
    return `demo-account-${String(index + 1).padStart(3, '0')}-${String(accountIndex + 1).padStart(2, '0')}@example.com`;
  }

  private buildCharacterHandle(
    index: number,
    accountIndex: number,
    characterIndex: number,
  ): string {
    return `demo-char-${String(index + 1).padStart(3, '0')}-${String(accountIndex + 1).padStart(2, '0')}-${String(characterIndex + 1).padStart(2, '0')}`;
  }

  private buildFirstName(index: number): string {
    const names = [
      'Ava',
      'Ben',
      'Cora',
      'Dax',
      'Elena',
      'Finn',
      'Gale',
      'Hugo',
      'Iris',
      'Jace',
    ];
    return names[index % names.length];
  }

  private buildLastName(index: number): string {
    const surnames = [
      'Alden',
      'Bristow',
      'Carter',
      'Dawson',
      'Ellis',
      'Foster',
      'Garcia',
      'Hawthorne',
      'Ivers',
      'Jensen',
    ];
    return surnames[index % surnames.length];
  }

  private buildAccountNotes(index: number, accountIndex: number): string {
    return `Demo account ${index + 1} - test record ${accountIndex + 1}.`;
  }

  private buildBiography(
    index: number,
    accountIndex: number,
    characterIndex: number,
  ): string {
    return `Demo character ${index + 1}-${accountIndex + 1}-${characterIndex + 1} seeded for UI and API verification.`;
  }

  private buildCharacterNotes(
    index: number,
    accountIndex: number,
    characterIndex: number,
  ): string {
    return `Seeded test character for demo user ${index + 1}, account ${accountIndex + 1}, character ${characterIndex + 1}.`;
  }

  private buildTimestamp(index: number, year: number): Date {
    return new Date(Date.UTC(year, 0, 1 + (index % 365), 12, 0, 0));
  }

  private buildAccountCreatedDate(index: number, accountIndex: number): Date {
    return new Date(
      Date.UTC(2024, 0, 1 + ((index + accountIndex) % 365), 10, 30, 0),
    );
  }

  private buildCharacterCreatedDate(
    index: number,
    accountIndex: number,
    characterIndex: number,
  ): Date {
    return new Date(
      Date.UTC(
        2024,
        0,
        1 + ((index + accountIndex + characterIndex) % 365),
        14,
        15,
        0,
      ),
    );
  }

  private getCharacterCount(index: number, accountIndex: number): number {
    return 1 + ((index + accountIndex) % 5);
  }

  private normalizeHandle(value: string): string {
    return value.trim().toLowerCase();
  }

  private getFallbackLookupId(
    values: Array<{ id: string }> | undefined,
    index: number,
    accountIndex: number,
    characterIndex: number,
    salt: number,
  ): string | undefined {
    if (!values || values.length === 0) {
      return undefined;
    }

    const offset =
      (index + accountIndex + characterIndex + salt) % values.length;
    return values[offset]?.id;
  }

  private toSlug(value: string): string {
    return value.trim().replaceAll('#', '~');
  }

  private shouldLoadTestData(): boolean {
    return loadsDemoData(process.env.NODE_ENV);
  }

  private getSeedPassword(): string {
    const password = process.env.DATASEED_USER_PASSWORD?.trim();

    if (!password) {
      throw new Error('DATASEED_USER_PASSWORD must be set to seed demo users');
    }

    return password;
  }
}
