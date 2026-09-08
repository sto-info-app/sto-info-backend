import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccessControl1787700000000 implements MigrationInterface {
  name = 'CreateAccessControl1787700000000';

  /**
   * Applies the migration to the database.
   *
   * Adds the application-wide permission framework: `permission` is the
   * registry of capabilities, `permission_group` bundles them, and
   * `role_permission_group` maps the existing coarse `user_role_enum` roles
   * onto those bundles. `user_permission_override` and `user_limit_override`
   * then allow a single user to differ from everyone else holding their role.
   *
   * Both override tables soft-delete, so their uniqueness guarantees are
   * partial indexes scoped to live rows — withdrawing an override has to leave
   * the pair free to be granted again.
   *
   * The seed data is written out in full here rather than imported from the
   * application constants. A migration must keep producing the same result
   * forever, and importing a constant that later gains a permission would
   * retroactively change what this migration did.
   *
   * The seeded grants reproduce the behaviour the application already had:
   * every authenticated user may read and create Storytime content, and
   * administrators additionally moderate, curate and configure. Nothing about
   * existing role checks changes; this framework is purely additive.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TYPE "sto_info_app"."permission_module_enum"
      AS ENUM ('STORYTIME')
    `,
      `
      CREATE TYPE "sto_info_app"."permission_effect_enum"
      AS ENUM ('GRANT', 'DENY')
    `,

      // ---------------------------------------------------------------------
      // Registry of capabilities.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE "sto_info_app"."permission" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" character varying(100) NOT NULL,
        "name" character varying(150) NOT NULL,
        "description" character varying(500),
        "module" "sto_info_app"."permission_module_enum" NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_permission" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_permission_code" UNIQUE ("code")
      )
    `,
      // The administration UI lists permissions grouped by application area.
      `
      CREATE INDEX "IDX_permission_module"
      ON "sto_info_app"."permission" ("module")
    `,

      // ---------------------------------------------------------------------
      // Named bundles of capabilities.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE "sto_info_app"."permission_group" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" character varying(100) NOT NULL,
        "name" character varying(150) NOT NULL,
        "description" character varying(500),
        "isSystem" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_permission_group" PRIMARY KEY ("id")
      )
    `,
      `
      CREATE UNIQUE INDEX "UQ_permission_group_code"
      ON "sto_info_app"."permission_group" ("code")
      WHERE "deletedAt" IS NULL
    `,

      `
      CREATE TABLE "sto_info_app"."permission_group_permission" (
        "permissionGroupId" uuid NOT NULL,
        "permissionId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "createdByUserId" uuid,
        CONSTRAINT "PK_permission_group_permission"
          PRIMARY KEY ("permissionGroupId", "permissionId"),
        CONSTRAINT "FK_permission_group_permission_group"
          FOREIGN KEY ("permissionGroupId")
          REFERENCES "sto_info_app"."permission_group" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_permission_group_permission_permission"
          FOREIGN KEY ("permissionId")
          REFERENCES "sto_info_app"."permission" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_permission_group_permission_creator"
          FOREIGN KEY ("createdByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL
      )
    `,
      // Resolving a user's permissions walks group -> permission, so the
      // reverse lookup (which groups confer this permission?) needs its own
      // index for the administration screens.
      `
      CREATE INDEX "IDX_permission_group_permission_permission"
      ON "sto_info_app"."permission_group_permission" ("permissionId")
    `,

      // ---------------------------------------------------------------------
      // Default grants per existing role.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE "sto_info_app"."role_permission_group" (
        "role" "sto_info_app"."user_role_enum" NOT NULL,
        "permissionGroupId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "createdByUserId" uuid,
        CONSTRAINT "PK_role_permission_group"
          PRIMARY KEY ("role", "permissionGroupId"),
        CONSTRAINT "FK_role_permission_group_group"
          FOREIGN KEY ("permissionGroupId")
          REFERENCES "sto_info_app"."permission_group" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_role_permission_group_creator"
          FOREIGN KEY ("createdByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL
      )
    `,

      // ---------------------------------------------------------------------
      // Per-user departures from the role defaults.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE "sto_info_app"."user_permission_override" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "permissionId" uuid NOT NULL,
        "effect" "sto_info_app"."permission_effect_enum" NOT NULL,
        "reason" character varying(500) NOT NULL,
        "grantedByUserId" uuid NOT NULL,
        "expiresAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_user_permission_override" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_permission_override_user"
          FOREIGN KEY ("userId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_permission_override_permission"
          FOREIGN KEY ("permissionId")
          REFERENCES "sto_info_app"."permission" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_permission_override_granter"
          FOREIGN KEY ("grantedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE
      )
    `,
      `
      CREATE UNIQUE INDEX "UQ_user_permission_override"
      ON "sto_info_app"."user_permission_override" ("userId", "permissionId")
      WHERE "deletedAt" IS NULL
    `,
      // Every authorisation check for a user loads their whole override set at
      // once, so the lookup is by user alone.
      `
      CREATE INDEX "IDX_user_permission_override_user"
      ON "sto_info_app"."user_permission_override" ("userId")
      WHERE "deletedAt" IS NULL
    `,

      `
      CREATE TABLE "sto_info_app"."user_limit_override" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "limitKey" character varying(80) NOT NULL,
        "limitValue" integer NOT NULL,
        "reason" character varying(500) NOT NULL,
        "grantedByUserId" uuid NOT NULL,
        "expiresAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_user_limit_override" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_user_limit_override_value"
          CHECK ("limitValue" >= 0),
        CONSTRAINT "FK_user_limit_override_user"
          FOREIGN KEY ("userId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_limit_override_granter"
          FOREIGN KEY ("grantedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE
      )
    `,
      `
      CREATE UNIQUE INDEX "UQ_user_limit_override"
      ON "sto_info_app"."user_limit_override" ("userId", "limitKey")
      WHERE "deletedAt" IS NULL
    `,
      `
      CREATE INDEX "IDX_user_limit_override_user"
      ON "sto_info_app"."user_limit_override" ("userId")
      WHERE "deletedAt" IS NULL
    `,

      // ---------------------------------------------------------------------
      // Seed the Storytime permissions.
      // ---------------------------------------------------------------------
      `
      INSERT INTO "sto_info_app"."permission" ("code", "name", "description", "module")
      VALUES
        ('storytime.view', 'View Storytime',
         'Read published Stories, Chapters, Characters and Arcs.', 'STORYTIME'),
        ('storytime.story.create', 'Create Stories',
         'Create new Storytime Stories.', 'STORYTIME'),
        ('storytime.story.edit.own', 'Edit own Stories',
         'Edit Stories the user owns, including metadata, Chapters and artwork.', 'STORYTIME'),
        ('storytime.story.publish.own', 'Publish own Stories',
         'Publish and unpublish Stories the user owns. Collaborators never receive this.', 'STORYTIME'),
        ('storytime.collaborate', 'Collaborate on Stories',
         'Accept collaboration invitations and edit Stories owned by other users.', 'STORYTIME'),
        ('storytime.arc.create', 'Create Arcs',
         'Create multi-author Storytime Arcs.', 'STORYTIME'),
        ('storytime.arc.manage.own', 'Manage own Arcs',
         'Edit Arcs the user owns, including membership requests and Story ordering.', 'STORYTIME'),
        ('storytime.comment.create', 'Comment',
         'Post comments on Stories, Chapters and Arcs.', 'STORYTIME'),
        ('storytime.reaction.create', 'React',
         'Add Thumbs Up and Thumbs Down reactions.', 'STORYTIME'),
        ('storytime.report.create', 'Report content',
         'Report Storytime content for moderator review.', 'STORYTIME'),
        ('storytime.moderate', 'Moderate Storytime',
         'Review reports, remove and restore content, and decide appeals.', 'STORYTIME'),
        ('storytime.spotlight.manage', 'Manage Spotlight',
         'Create, schedule and withdraw Storytime Spotlight entries.', 'STORYTIME'),
        ('storytime.configure', 'Configure Storytime',
         'Change Storytime feature flags and grant per-user limit exemptions.', 'STORYTIME')
    `,

      // ---------------------------------------------------------------------
      // Seed the groups.
      // ---------------------------------------------------------------------
      `
      INSERT INTO "sto_info_app"."permission_group" ("code", "name", "description", "isSystem")
      VALUES
        ('storytime.reader', 'Storytime Reader',
         'Read Storytime content, comment, react and report. Granted to every authenticated user.', true),
        ('storytime.creator', 'Storytime Creator',
         'Create and publish own Stories and Arcs, and collaborate on others. Granted to every authenticated user.', true),
        ('storytime.administrator', 'Storytime Administrator',
         'Moderate reported content, curate the Spotlight and configure Storytime.', true)
    `,

      // ---------------------------------------------------------------------
      // Map permissions into groups.
      // ---------------------------------------------------------------------
      `
      INSERT INTO "sto_info_app"."permission_group_permission" ("permissionGroupId", "permissionId")
      SELECT g."id", p."id"
      FROM "sto_info_app"."permission_group" g
      JOIN "sto_info_app"."permission" p ON p."code" = ANY (
        CASE g."code"
          WHEN 'storytime.reader' THEN ARRAY[
            'storytime.view',
            'storytime.comment.create',
            'storytime.reaction.create',
            'storytime.report.create'
          ]
          WHEN 'storytime.creator' THEN ARRAY[
            'storytime.story.create',
            'storytime.story.edit.own',
            'storytime.story.publish.own',
            'storytime.collaborate',
            'storytime.arc.create',
            'storytime.arc.manage.own'
          ]
          WHEN 'storytime.administrator' THEN ARRAY[
            'storytime.moderate',
            'storytime.spotlight.manage',
            'storytime.configure'
          ]
        END
      )
      WHERE g."code" IN ('storytime.reader', 'storytime.creator', 'storytime.administrator')
    `,

      // ---------------------------------------------------------------------
      // Map groups onto roles. Readers and creators are granted to everyone so
      // that enabling the framework changes nobody's effective access.
      // ---------------------------------------------------------------------
      `
      INSERT INTO "sto_info_app"."role_permission_group" ("role", "permissionGroupId")
      SELECT 'USER'::"sto_info_app"."user_role_enum", g."id"
      FROM "sto_info_app"."permission_group" g
      WHERE g."code" IN ('storytime.reader', 'storytime.creator')
    `,
      `
      INSERT INTO "sto_info_app"."role_permission_group" ("role", "permissionGroupId")
      SELECT 'ADMIN'::"sto_info_app"."user_role_enum", g."id"
      FROM "sto_info_app"."permission_group" g
      WHERE g."code" IN ('storytime.reader', 'storytime.creator', 'storytime.administrator')
    `,
    ]);
  }

  /**
   * Reverts the migration from the database.
   *
   * Tables are dropped in reverse dependency order. The seeded rows go with
   * them, so no separate delete is required.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `DROP TABLE "sto_info_app"."user_limit_override"`,
      `DROP TABLE "sto_info_app"."user_permission_override"`,
      `DROP TABLE "sto_info_app"."role_permission_group"`,
      `DROP TABLE "sto_info_app"."permission_group_permission"`,
      `DROP TABLE "sto_info_app"."permission_group"`,
      `DROP TABLE "sto_info_app"."permission"`,
      `DROP TYPE "sto_info_app"."permission_effect_enum"`,
      `DROP TYPE "sto_info_app"."permission_module_enum"`,
    ]);
  }

  /**
   * Executes migration queries in the given order.
   *
   * @param queryRunner - The TypeORM query runner.
   * @param queries - SQL statements to execute.
   */
  private async executeQueries(
    queryRunner: QueryRunner,
    queries: string[],
  ): Promise<void> {
    for (const query of queries) {
      await queryRunner.query(query);
    }
  }
}
