import { MigrationInterface, QueryRunner } from 'typeorm';

/** The enum types this migration creates, in creation order. */
const TYPES = [
  `"scope_event_audience_enum" AS ENUM ('PUBLIC', 'COMMUNITY', 'MEMBERS', 'OFFICERS', 'SELECTED')`,
  `"scope_event_recurrence_enum" AS ENUM ('NONE', 'WEEKLY', 'MONTHLY_DAY', 'MONTHLY_WEEKDAY')`,
  `"scope_event_status_enum" AS ENUM ('ACTIVE', 'CANCELLED')`,
  `"scope_event_occurrence_status_enum" AS ENUM ('SCHEDULED', 'CANCELLED')`,
  `"scope_event_occurrence_adjustment_enum" AS ENUM ('NONE', 'REPEATED_TIME', 'MISSING_TIME')`,
  `"scope_event_rsvp_response_enum" AS ENUM ('GOING', 'MAYBE', 'NOT_GOING')`,
  `"scope_event_action_enum" AS ENUM ('CREATED', 'EDITED', 'CANCELLED', 'OCCURRENCE_CANCELLED', 'OCCURRENCE_MOVED', 'ATTENDANCE_RECORDED', 'CLOSED_WITH_SCOPE')`,
];

/**
 * Events for Communities, Fleets and Armadas (FC-028).
 *
 * With the decisions Steve made on 28 September 2026:
 *
 * - `scope_event` holds the rule: once, every one to twelve weeks on chosen
 *   weekdays, or every one to twelve months on a day or on the first to
 *   fourth or last of a weekday, ending on a day, after up to 500, or never.
 *   Its time is a local one in the timezone the organiser chose, with a
 *   duration of five minutes to a day and an optional capacity of up to a
 *   thousand. `CHK_scope_event_rule` states each kind's shape; every branch
 *   tests the nullable columns it relies on, so the check never passes by
 *   evaluating to NULL.
 * - `scope_event_occurrence` holds each occurrence, a year ahead, keyed by
 *   the day its rule names so that an edit keeping the day keeps its
 *   answers. Each records how the daylight-saving policy placed it. Nothing
 *   is ever deleted: a removed occurrence is cancelled.
 * - `scope_event_rsvp` holds one answer per person per occurrence, Going,
 *   Maybe or Can't go, with a Character of their own. Only Going can wait.
 * - `scope_event_attendance` is what a manager recorded happened, kept apart
 *   from the answer and never worked out from it.
 * - `scope_event_reminder` is who asked to be reminded of an event, and how
 *   long before: fifteen minutes, an hour or a day.
 * - Reminders, cancellations, moves and promotions off the waitlist go
 *   through `notification_outbox`, which every targeted notice shares.
 * - `scope_event_action` is the managers' change log, write-once.
 */
export class CreateScopeEvents1795700000000 implements MigrationInterface {
  name = 'CreateScopeEvents1795700000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const type of TYPES) {
      await queryRunner.query(`CREATE TYPE "sto_info_app".${type}`);
    }

    await queryRunner.query(`CREATE TABLE "sto_info_app"."scope_event" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "fleetId" uuid,
      "armadaId" uuid,
      "title" varchar(200) NOT NULL,
      "description" text NOT NULL DEFAULT '',
      "externalUrl" varchar(2048),
      "audience" "sto_info_app"."scope_event_audience_enum" NOT NULL,
      "timezone" varchar(64) NOT NULL,
      "recurrence" "sto_info_app"."scope_event_recurrence_enum" NOT NULL,
      "startDate" date NOT NULL,
      "startTime" varchar(5) NOT NULL,
      "interval" smallint NOT NULL DEFAULT 1,
      "weekdays" smallint[] NOT NULL DEFAULT '{}',
      "monthDay" smallint,
      "monthWeek" smallint,
      "monthWeekday" smallint,
      "endsOn" date,
      "occurrenceLimit" integer,
      "durationMinutes" integer NOT NULL,
      "capacity" integer,
      "status" "sto_info_app"."scope_event_status_enum" NOT NULL DEFAULT 'ACTIVE',
      "cancelledAt" timestamptz,
      "materialisedThrough" date NOT NULL,
      "createdByUserId" uuid,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_scope_event" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_scope_event_community" UNIQUE ("id", "communityId"),
      CONSTRAINT "CHK_scope_event_scope" CHECK ("fleetId" IS NULL OR "armadaId" IS NULL),
      CONSTRAINT "CHK_scope_event_title" CHECK (length(btrim("title")) > 0),
      CONSTRAINT "CHK_scope_event_link" CHECK ("externalUrl" IS NULL OR "externalUrl" LIKE 'https://%'),
      CONSTRAINT "CHK_scope_event_time" CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
      CONSTRAINT "CHK_scope_event_interval" CHECK ("interval" BETWEEN 1 AND 12),
      CONSTRAINT "CHK_scope_event_duration" CHECK ("durationMinutes" BETWEEN 5 AND 1440),
      CONSTRAINT "CHK_scope_event_capacity" CHECK ("capacity" IS NULL OR "capacity" BETWEEN 1 AND 1000),
      CONSTRAINT "CHK_scope_event_rule" CHECK (
        ("recurrence" = 'NONE' AND cardinality("weekdays") = 0
          AND "monthDay" IS NULL AND "monthWeek" IS NULL AND "monthWeekday" IS NULL
          AND "endsOn" IS NULL AND "occurrenceLimit" IS NULL)
        OR ("recurrence" = 'WEEKLY' AND cardinality("weekdays") BETWEEN 1 AND 7
          AND "weekdays" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
          AND "monthDay" IS NULL AND "monthWeek" IS NULL AND "monthWeekday" IS NULL)
        OR ("recurrence" = 'MONTHLY_DAY' AND cardinality("weekdays") = 0
          AND "monthDay" IS NOT NULL AND "monthDay" BETWEEN 1 AND 31
          AND "monthWeek" IS NULL AND "monthWeekday" IS NULL)
        OR ("recurrence" = 'MONTHLY_WEEKDAY' AND cardinality("weekdays") = 0
          AND "monthDay" IS NULL
          AND "monthWeek" IS NOT NULL AND "monthWeek" IN (1, 2, 3, 4, -1)
          AND "monthWeekday" IS NOT NULL AND "monthWeekday" BETWEEN 1 AND 7)),
      CONSTRAINT "CHK_scope_event_end" CHECK (
        ("endsOn" IS NULL OR ("occurrenceLimit" IS NULL AND "endsOn" >= "startDate"))
        AND ("occurrenceLimit" IS NULL OR "occurrenceLimit" BETWEEN 1 AND 500)),
      CONSTRAINT "CHK_scope_event_cancelled" CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)),
      CONSTRAINT "FK_scope_event_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_event_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_event_armada" FOREIGN KEY ("armadaId", "communityId") REFERENCES "sto_info_app"."sto_armada"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_event_created_by" FOREIGN KEY ("createdByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_event_scope" ON "sto_info_app"."scope_event" ("communityId", "fleetId", "armadaId", "status")`,
    );

    // Chosen Fleets and roles, for an event shown only to them. A chosen
    // Fleet is in the event's own Community, by the composite key.
    await queryRunner.query(`CREATE TABLE "sto_info_app"."scope_event_audience_member" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "eventId" uuid NOT NULL,
      "communityId" uuid NOT NULL,
      "fleetId" uuid,
      "role" "sto_info_app"."fleet_scope_role_enum",
      CONSTRAINT "PK_scope_event_audience_member" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_scope_event_audience_member_one" CHECK (("fleetId" IS NULL) <> ("role" IS NULL)),
      CONSTRAINT "FK_scope_event_audience_member_event" FOREIGN KEY ("eventId", "communityId") REFERENCES "sto_info_app"."scope_event"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_event_audience_member_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_event_audience_member_fleet" ON "sto_info_app"."scope_event_audience_member" ("eventId", "fleetId") WHERE "fleetId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_event_audience_member_role" ON "sto_info_app"."scope_event_audience_member" ("eventId", "role") WHERE "role" IS NOT NULL`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."scope_event_occurrence" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "eventId" uuid NOT NULL,
      "occurrenceKey" date NOT NULL,
      "localStart" varchar(16) NOT NULL,
      "startsAt" timestamptz NOT NULL,
      "endsAt" timestamptz NOT NULL,
      "adjustment" "sto_info_app"."scope_event_occurrence_adjustment_enum" NOT NULL DEFAULT 'NONE',
      "status" "sto_info_app"."scope_event_occurrence_status_enum" NOT NULL DEFAULT 'SCHEDULED',
      "cancelledAt" timestamptz,
      "isException" boolean NOT NULL DEFAULT false,
      "movedFromStartsAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_scope_event_occurrence" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_scope_event_occurrence_key" UNIQUE ("eventId", "occurrenceKey"),
      CONSTRAINT "CHK_scope_event_occurrence_span" CHECK ("endsAt" > "startsAt"),
      CONSTRAINT "CHK_scope_event_occurrence_cancelled" CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)),
      CONSTRAINT "FK_scope_event_occurrence_event" FOREIGN KEY ("eventId") REFERENCES "sto_info_app"."scope_event"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_event_occurrence_start" ON "sto_info_app"."scope_event_occurrence" ("eventId", "startsAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_event_occurrence_scheduled" ON "sto_info_app"."scope_event_occurrence" ("startsAt") WHERE "status" = 'SCHEDULED'`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."scope_event_rsvp" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "occurrenceId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "response" "sto_info_app"."scope_event_rsvp_response_enum" NOT NULL,
      "characterId" uuid,
      "waitlistedAt" timestamptz,
      "respondedAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_scope_event_rsvp" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_scope_event_rsvp_person" UNIQUE ("occurrenceId", "userId"),
      CONSTRAINT "CHK_scope_event_rsvp_waitlist" CHECK ("waitlistedAt" IS NULL OR "response" = 'GOING'),
      CONSTRAINT "FK_scope_event_rsvp_occurrence" FOREIGN KEY ("occurrenceId") REFERENCES "sto_info_app"."scope_event_occurrence"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_event_rsvp_user" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_event_rsvp_character" FOREIGN KEY ("characterId") REFERENCES "sto_info_app"."character"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_event_rsvp_waitlist" ON "sto_info_app"."scope_event_rsvp" ("occurrenceId", "waitlistedAt") WHERE "waitlistedAt" IS NOT NULL`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."scope_event_attendance" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "occurrenceId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "attended" boolean NOT NULL,
      "characterId" uuid,
      "recordedByUserId" uuid,
      "recordedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_scope_event_attendance" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_scope_event_attendance_person" UNIQUE ("occurrenceId", "userId"),
      CONSTRAINT "FK_scope_event_attendance_occurrence" FOREIGN KEY ("occurrenceId") REFERENCES "sto_info_app"."scope_event_occurrence"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_event_attendance_user" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_event_attendance_character" FOREIGN KEY ("characterId") REFERENCES "sto_info_app"."character"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_event_attendance_recorded_by" FOREIGN KEY ("recordedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);

    await queryRunner.query(`CREATE TABLE "sto_info_app"."scope_event_reminder" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "eventId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "leadMinutes" smallint[] NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_scope_event_reminder" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_scope_event_reminder_person" UNIQUE ("eventId", "userId"),
      CONSTRAINT "CHK_scope_event_reminder_leads" CHECK (cardinality("leadMinutes") BETWEEN 1 AND 3 AND "leadMinutes" <@ ARRAY[15, 60, 1440]::smallint[]),
      CONSTRAINT "FK_scope_event_reminder_event" FOREIGN KEY ("eventId") REFERENCES "sto_info_app"."scope_event"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_event_reminder_user" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);

    await queryRunner.query(`CREATE TABLE "sto_info_app"."scope_event_action" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "eventId" uuid NOT NULL,
      "occurrenceId" uuid,
      "action" "sto_info_app"."scope_event_action_enum" NOT NULL,
      "actorUserId" uuid,
      "subjectUserId" uuid,
      "detail" jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_scope_event_action" PRIMARY KEY ("id"),
      CONSTRAINT "FK_scope_event_action_event" FOREIGN KEY ("eventId") REFERENCES "sto_info_app"."scope_event"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_event_action_occurrence" FOREIGN KEY ("occurrenceId") REFERENCES "sto_info_app"."scope_event_occurrence"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_event_action_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_event_action_subject" FOREIGN KEY ("subjectUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_event_action_event" ON "sto_info_app"."scope_event_action" ("eventId", "createdAt")`,
    );
    // A logged change is evidence. The one change it accepts is a person it
    // names going.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."scope_event_action_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - 'actorUserId' - 'subjectUserId')
            IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId' - 'subjectUserId')
          OR (NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId")
          OR (NEW."subjectUserId" IS NOT NULL AND NEW."subjectUserId" IS DISTINCT FROM OLD."subjectUserId") THEN
          RAISE EXCEPTION 'scope_event_action is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_scope_event_action_guard" BEFORE UPDATE ON "sto_info_app"."scope_event_action" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."scope_event_action_guard"()`,
    );
  }

  /**
   * Reverts the migration, and every event with it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_scope_event_action_guard" ON "sto_info_app"."scope_event_action"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."scope_event_action_guard"()`,
    );

    for (const table of [
      'scope_event_action',
      'scope_event_reminder',
      'scope_event_attendance',
      'scope_event_rsvp',
      'scope_event_occurrence',
      'scope_event_audience_member',
      'scope_event',
    ]) {
      await queryRunner.query(`DROP TABLE "sto_info_app"."${table}"`);
    }

    for (const type of [...TYPES].reverse()) {
      await queryRunner.query(
        `DROP TYPE "sto_info_app".${type.slice(0, type.indexOf(' AS '))}`,
      );
    }
  }
}
