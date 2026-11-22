import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `character_fleet_proposal` and the `proposalId` column that
 * references it (FC-014).
 *
 * The two tables named in `1791600000000`'s note as deliberately absent. They
 * were held back because the answer, not the question, is the part that has to
 * be right: a proposal is a suggestion that somebody's Character is in a Fleet,
 * and until there is a rule for who may answer one and what accepting it does
 * to their history, a table full of them is a liability.
 *
 * ## The constraints are the design
 *
 * **One unanswered proposal per Character and Fleet**, as a partial unique
 * index over `PENDING` rows. A Fleet whose roster is imported weekly must not
 * accumulate a stack of identical questions, and re-raising should find the
 * existing one rather than add to it. It is scoped to the pair rather than the
 * Character, so two Fleets may both be asking at once — FC-014's third
 * acceptance criterion, and the honest model, since a Character may genuinely
 * have been in both.
 *
 * **An answer implies an answer instant, and the absence of one implies
 * neither.** `CHK_character_fleet_proposal_answer` compares `status` against
 * `answeredAt` in both directions. It is safe from the usual trap where a
 * `CHECK` passes on a NULL because `status` is `NOT NULL`, so one side of every
 * comparison is always a value.
 *
 * **`CONFIRMED_IMPORT` requires a proposal.** The membership enum says that
 * value means "the owner accepted a proposal raised from roster evidence", and
 * `CHK_character_fleet_membership_confirmed_proposal` makes that checkable
 * rather than merely documented. A row claiming the source without citing the
 * question is refused.
 *
 * ## No expiry status
 *
 * `expiresAt` is written once and read thereafter. The alternative is a status
 * meaning "expired" and a job to write it, which is wrong for the whole
 * interval between a proposal lapsing and the job next running — and, during an
 * outage, leaves dead proposals answerable. A date cannot be stale.
 *
 * The column is `NOT NULL` with no default. The expiry window is a published
 * figure in `fleet-policy.constants`, and a database default would be a second
 * copy of it that nobody updates.
 */
export class CreateCharacterFleetProposals1793300000000 implements MigrationInterface {
  name = 'CreateCharacterFleetProposals1793300000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."character_fleet_proposal_status_enum" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED')`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."character_fleet_proposal" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "characterId" uuid NOT NULL,
      "fleetId" uuid NOT NULL,
      "status" "sto_info_app"."character_fleet_proposal_status_enum" NOT NULL DEFAULT 'PENDING',
      "observedAt" timestamptz,
      "raisedAt" timestamptz NOT NULL DEFAULT now(),
      "expiresAt" timestamptz NOT NULL,
      "proposedByUserId" uuid,
      "answeredAt" timestamptz,
      "answeredByUserId" uuid,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      CONSTRAINT "PK_character_fleet_proposal" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_character_fleet_proposal_expiry" CHECK ("expiresAt" > "raisedAt"),
      CONSTRAINT "CHK_character_fleet_proposal_answer" CHECK (("status" = 'PENDING' AND "answeredAt" IS NULL) OR ("status" <> 'PENDING' AND "answeredAt" IS NOT NULL)),
      CONSTRAINT "FK_character_fleet_proposal_character" FOREIGN KEY ("characterId") REFERENCES "sto_info_app"."character"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_character_fleet_proposal_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_character_fleet_proposal_proposer" FOREIGN KEY ("proposedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_character_fleet_proposal_answerer" FOREIGN KEY ("answeredByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_character_fleet_proposal_open" ON "sto_info_app"."character_fleet_proposal" ("characterId", "fleetId") WHERE "status" = 'PENDING' AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_character_fleet_proposal_character_status" ON "sto_info_app"."character_fleet_proposal" ("characterId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_character_fleet_proposal_fleet_raised" ON "sto_info_app"."character_fleet_proposal" ("fleetId", "raisedAt")`,
    );

    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character_fleet_membership"
        ADD COLUMN "proposalId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character_fleet_membership"
        ADD CONSTRAINT "FK_character_fleet_membership_proposal"
        FOREIGN KEY ("proposalId")
        REFERENCES "sto_info_app"."character_fleet_proposal"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character_fleet_membership"
        ADD CONSTRAINT "CHK_character_fleet_membership_confirmed_proposal"
        CHECK ("source" <> 'CONFIRMED_IMPORT' OR "proposalId" IS NOT NULL)
    `);
  }

  /**
   * Reverts the migration.
   *
   * The membership column goes first, because the foreign key on it is what
   * holds the table down.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character_fleet_membership"
        DROP CONSTRAINT "CHK_character_fleet_membership_confirmed_proposal"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character_fleet_membership"
        DROP CONSTRAINT "FK_character_fleet_membership_proposal"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character_fleet_membership"
        DROP COLUMN "proposalId"
    `);
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."character_fleet_proposal"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."character_fleet_proposal_status_enum"`,
    );
  }
}
