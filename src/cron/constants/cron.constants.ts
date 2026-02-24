export const CRON_TIMEZONE = 'UTC';
export const AUDIT_DATA_NUKE_THRESHOLD_DAYS =
  +process.env.AUDIT_DATA_NUKE_THRESHOLD_DAYS!;
export const AUDIT_IP_NUKE_THRESHOLD_DAYS =
  +process.env.AUDIT_IP_NUKE_THRESHOLD_DAYS!;
export const CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS =
  +process.env.CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS!;
export const CONTACT_REQUEST_RECORD_RETENTION_DAYS =
  +process.env.CONTACT_REQUEST_RECORD_RETENTION_DAYS!;

/**
 * How many days to retain audit_ses_event records that do NOT suppress
 * (i.e. soft bounces and deliveries). These are informational only and
 * can be pruned relatively quickly.
 */
export const SES_AUDIT_RETENTION_DAYS = +process.env.SES_AUDIT_RETENTION_DAYS!;

/**
 * How many days to retain audit_ses_event records that DO suppress
 * (i.e. hard bounces and complaints). These must be kept long enough to
 * prevent future sends to the affected address. Typically set to several years.
 */
export const SES_SUPPRESSION_RETENTION_DAYS =
  +process.env.SES_SUPPRESSION_RETENTION_DAYS!;
