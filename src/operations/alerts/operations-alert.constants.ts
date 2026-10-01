import { REDIS_TIMEOUT_MS } from 'src/shared/queue/redis-within.utility';

/**
 * The thresholds the operations alert cron judges by (FC-042).
 *
 * Fixed in code rather than configured, by Steve's choice of 30 September
 * 2026: a threshold that can be edited is one that gets edited until it
 * stops firing. Changing one is a code change, reviewed like any other.
 */

/** How long the oldest waiting scan request may wait, in minutes. */
export const SCAN_QUEUE_LAG_MINUTES = 15;

/**
 * How long the oldest waiting publication job may wait, in minutes. Not
 * judged while publication is paused, when waiting is the point.
 */
export const PUBLICATION_QUEUE_LAG_MINUTES = 15;

/**
 * How recently a worker must have beaten to count as live, in seconds. It
 * beats every 30 seconds, so four missed beats in a row.
 */
export const WORKER_LIVE_SECONDS = 120;

/** How long every live worker may stay paused, in minutes. */
export const WORKER_PAUSED_MINUTES = 10;

/**
 * How old the newest signatures a live worker holds may be, in hours. The
 * worker itself stops scanning at `CLAMAV_MAX_DEFINITION_AGE_HOURS`, 48, so
 * this leaves twelve hours to find out why `freshclam` is not updating.
 */
export const SIGNATURES_STALE_HOURS = 36;

/** How long publication may stay paused, in minutes. */
export const PUBLICATION_PAUSED_LONG_MINUTES = 60;

/**
 * How long Redis may go unanswering, across consecutive alert runs, in
 * minutes.
 */
export const QUEUES_UNREACHABLE_MINUTES = 2;

/**
 * How long one alert run waits for Redis to answer, in milliseconds: the
 * limit every Redis read on the diagnostics side shares. A client with
 * nothing to talk to queues commands rather than failing them, so without a
 * limit the run would wait for as long as the outage lasts.
 */
export const QUEUE_PROBE_TIMEOUT_MS = REDIS_TIMEOUT_MS;

/**
 * How many prioritised jobs are looked at to find the oldest. Only rescans
 * are prioritised, and a campaign holds back once 25 requests are waiting,
 * so this is every one of them in practice without ever loading a queue.
 */
export const PRIORITISED_SAMPLE = 100;

/**
 * The PostgreSQL advisory lock one alert run holds, so two instances do not
 * both open, and announce, the same alert.
 */
export const OPERATIONS_ALERT_LOCK = 1_797_500_000;

/** Where a site admin reads about it. */
export const SCAN_DIAGNOSTICS_LINK = '/admin/scan-diagnostics';
