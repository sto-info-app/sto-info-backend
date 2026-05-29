import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEndeavourTables1774837200000 implements MigrationInterface {
  name = 'CreateEndeavourTables1774837200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- endeavour_perk table ---
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."endeavour_perk" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(255) NOT NULL,
        "category" character varying(10) NOT NULL,
        "description" text,
        "boostPerRank" numeric(8,4) NOT NULL,
        "boostMax" numeric(8,4) NOT NULL,
        "boostUnit" character varying(10) NOT NULL,
        "maxNodes" integer NOT NULL DEFAULT 25,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_endeavour_perk" PRIMARY KEY ("id"),
        CONSTRAINT "UX_endeavour_perk_name_category" UNIQUE ("name", "category"),
        CONSTRAINT "CK_endeavour_perk_category" CHECK ("category" IN ('Space', 'Ground')),
        CONSTRAINT "CK_endeavour_perk_boost_unit" CHECK ("boostUnit" IN ('percent', 'flat'))
      )
    `);

    // --- account_endeavour_progress table ---
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."account_endeavour_progress" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "accountId" uuid NOT NULL,
        "endeavourPerkId" uuid NOT NULL,
        "currentNodes" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_account_endeavour_progress" PRIMARY KEY ("id"),
        CONSTRAINT "UX_account_endeavour_progress_account_perk" UNIQUE ("accountId", "endeavourPerkId"),
        CONSTRAINT "CK_account_endeavour_progress_nodes" CHECK ("currentNodes" >= 0 AND "currentNodes" <= 25),
        CONSTRAINT "FK_account_endeavour_progress_account" FOREIGN KEY ("accountId")
          REFERENCES "sto_info_app"."account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_account_endeavour_progress_perk" FOREIGN KEY ("endeavourPerkId")
          REFERENCES "sto_info_app"."endeavour_perk"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_account_endeavour_progress_accountId"
      ON "sto_info_app"."account_endeavour_progress" ("accountId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_account_endeavour_progress_perkId"
      ON "sto_info_app"."account_endeavour_progress" ("endeavourPerkId")
    `);

    // --- Seed: Ground Perks (20) ---
    // Bridge officer recharge perks were added by the 2025 update for Space only.
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."endeavour_perk"
        ("name", "category", "description", "boostPerRank", "boostMax", "boostUnit", "maxNodes", "sortOrder")
      VALUES
        ('Armor Penetration',   'Ground', 'Increases the armor penetration by your weapons on Ground.',                                                                0.5000, 12.5000,  'percent', 25, 10),
        ('Captain Ability Recharge',                 'Ground', 'Reduces your Captain Ability recharge times on Ground.',                                               0.4000, 10.0000,  'percent', 25, 20),
        ('Control Resist',                           'Ground', NULL,                                                                                                   2.0000, 50.0000,  'flat',    25, 40),
        ('Critical Chance',                          'Ground', NULL,                                                                                                   0.5000, 12.5000,  'percent', 25, 50),
        ('Critical Severity',                        'Ground', NULL,                                                                                                   2.0000, 50.0000,  'percent', 25, 60),
        ('Damage Resist Alpha',                      'Ground', NULL,                                                                                                   1.0000, 25.0000,  'flat',    25, 70),
        ('Damage Resist Beta',                       'Ground', NULL,                                                                                                   1.0000, 25.0000,  'flat',    25, 80),
        ('Damage Resist Gamma',                      'Ground', NULL,                                                                                                   1.0000, 25.0000,  'flat',    25, 90),
        ('Health Regeneration',                      'Ground', NULL,                                                                                                   4.0000, 100.0000, 'percent', 25, 110),
        ('Kit Performance',                          'Ground', NULL,                                                                                                   4.0000, 100.0000, 'flat',    25, 130),
        ('Max Health',                               'Ground', NULL,                                                                                                   1.0000, 25.0000,  'percent', 25, 140),
        ('Max Shields',                              'Ground', NULL,                                                                                                   1.0000, 25.0000,  'percent', 25, 150),
        ('Melee Weapon Damage',                      'Ground', NULL,                                                                                                   4.0000, 100.0000, 'percent', 25, 160),
        ('Ranged Weapon Damage',                     'Ground', NULL,                                                                                                   4.0000, 100.0000, 'percent', 25, 180),
        ('Shield Hardness',                          'Ground', NULL,                                                                                                   1.0000, 25.0000,  'percent', 25, 200),
        ('Shield Regeneration',                      'Ground', 'Increases your Health regeneration rate on Ground.',                                                   1.0000, 25.0000,  'percent', 25, 210),
        ('Sprint Speed',                             'Ground', NULL,                                                                                                   1.0000, 25.0000,  'percent', 25, 220),
        ('Weapon Damage Alpha',                      'Ground', 'Increases your damage output with Plasma, Phaser, Proton, Psionic, and Cold damage weapons on Ground.',     1.0000, 25.0000,  'flat',    25, 250),
        ('Weapon Damage Beta',                       'Ground', 'Increases your damage output with Disruptor, Polaron, Physical, Radiation, and Fire damage weapons on Ground.',             1.0000, 25.0000,  'flat',    25, 260),
        ('Weapon Damage Gamma',                      'Ground', 'Increases your damage output with Antiproton, Tetryon, Kinetic, Electrical, and Toxic damage weapons on Ground.',           1.0000, 25.0000,  'flat',    25, 270)
    `);

    // --- Seed: Space Perks (30) ---
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."endeavour_perk"
        ("name", "category", "description", "boostPerRank", "boostMax", "boostUnit", "maxNodes", "sortOrder")
      VALUES
        ('Armor Penetration',                        'Space', 'Increases the armor penetration of your ships'' weapons in Space.',                                                              0.5000, 12.5000,  'percent', 25, 10),
        ('Captain Ability Recharge',                 'Space', 'Reduces your Captain Ability recharge times in Space.',                                                                         0.4000, 10.0000,  'percent', 25, 20),
        ('Command Bridge Officer Recharge',          'Space', 'Reduces your Command Bridge Officer''s recharge times in Space.',                                                               0.4000, 10.0000,  'percent', 25, 30),
        ('Control Resist',                           'Space', NULL,                                                                                                                            2.0000, 50.0000,  'flat',    25, 40),
        ('Critical Chance',                          'Space', NULL,                                                                                                                            0.5000, 12.5000,  'percent', 25, 50),
        ('Critical Severity',                        'Space', NULL,                                                                                                                            2.0000, 50.0000,  'percent', 25, 60),
        ('Damage Resist Alpha',                      'Space', NULL,                                                                                                                            1.0000, 25.0000,  'flat',    25, 70),
        ('Damage Resist Beta',                       'Space', NULL,                                                                                                                            1.0000, 25.0000,  'flat',    25, 80),
        ('Damage Resist Gamma',                      'Space', NULL,                                                                                                                            1.0000, 25.0000,  'flat',    25, 90),
        ('Drain Resist',                             'Space', NULL,                                                                                                                            2.0000, 50.0000,  'flat',    25, 100),
        ('Energy Weapon Damage',                     'Space', NULL,                                                                                                                            2.0000, 50.0000,  'percent', 25, 110),
        ('Engineering Bridge Officer Recharge',      'Space', 'Reduces your Engineering Bridge Officer''s recharge times in Space.',                                                           0.4000, 10.0000,  'percent', 25, 120),
        ('Exotic Damage',                            'Space', NULL,                                                                                                                            2.0000, 50.0000,  'percent', 25, 130),
        ('Hull Regeneration',                        'Space', NULL,                                                                                                                            4.0000, 100.0000, 'percent', 25, 140),
        ('Impulse Speed',                            'Space', NULL,                                                                                                                            2.0000, 50.0000,  'percent', 25, 150),
        ('Intelligence Bridge Officer Recharge',     'Space', 'Reduces your Intelligence Bridge Officer''s recharge times in Space.',                                                          0.4000, 10.0000,  'percent', 25, 160),
        ('Max Hull',                                 'Space', NULL,                                                                                                                            1.0000, 25.0000,  'percent', 25, 170),
        ('Max Shields',                              'Space', NULL,                                                                                                                            1.0000, 25.0000,  'percent', 25, 180),
        ('Miracle Worker Bridge Officer Recharge',   'Space', 'Reduces your Miracle Worker Bridge Officer''s recharge times in Space.',                                                        0.4000, 10.0000,  'percent', 25, 190),
        ('Pilot Bridge Officer Recharge',            'Space', 'Reduces your Pilot Bridge Officer''s recharge times in Space.',                                                                 0.4000, 10.0000,  'percent', 25, 200),
        ('Projectile Weapon Damage',                 'Space', NULL,                                                                                                                            2.0000, 50.0000,  'percent', 25, 210),
        ('Science Bridge Officer Recharge',          'Space', 'Reduces your Science Bridge Officer''s recharge times in Space.',                                                               0.4000, 10.0000,  'percent', 25, 220),
        ('Shield Hardness',                          'Space', NULL,                                                                                                                            1.0000, 25.0000,  'percent', 25, 230),
        ('Shield Regeneration',                      'Space', 'Increases the shield repair rate of your ship.',                                                                                1.0000, 25.0000,  'percent', 25, 240),
        ('Tactical Bridge Officer Recharge',         'Space', 'Reduces your Tactical Bridge Officer''s recharge times in Space.',                                                              0.4000, 10.0000,  'percent', 25, 250),
        ('Temporal Operative Bridge Officer Recharge','Space', 'Reduces your Temporal Operative Bridge Officer''s recharge times in Space.',                                                   0.4000, 10.0000,  'percent', 25, 260),
        ('Turn Rate',                                'Space', NULL,                                                                                                                            1.0000, 25.0000,  'percent', 25, 270),
        ('Weapon Damage Alpha',                      'Space', 'Increases your ships'' damage output with Plasma, Phaser, Proton, Psionic, and Cold damage weapons in Space.',                  1.0000, 25.0000,  'flat',    25, 280),
        ('Weapon Damage Beta',                       'Space', 'Increases your ships'' damage output with Disruptor, Polaron, Physical, Radiation, and Fire damage weapons in Space.',          1.0000, 25.0000,  'flat',    25, 290),
        ('Weapon Damage Gamma',                      'Space', 'Increases your ships'' damage output with Antiproton, Tetryon, Kinetic, Electrical, and Toxic damage weapons in Space.',        1.0000, 25.0000,  'flat',    25, 300)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_account_endeavour_progress_perkId"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_account_endeavour_progress_accountId"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."account_endeavour_progress"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."endeavour_perk"`);
  }
}
