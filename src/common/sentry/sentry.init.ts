import * as Sentry from '@sentry/nestjs';
import { getAppVersion } from '../../shared/utilities/version.utility';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'dev',
    release: `sto-info-backend@${getAppVersion()}`,

    // Setting this option to true will send default PII data to Sentry.
    // For example, automatic IP address collection on events
    sendDefaultPii: false,

    // Error Sampling
    sampleRate: 1,
    tracesSampleRate: 0.2,

    // Drop noisy endpoints from performance data
    /**
     * Sanitizes a transaction before it is sent to Sentry.
     *
     * @param event - The event.
     * @returns The result of the operation.
     */
    beforeSendTransaction(event) {
      const url = event.request?.url ?? '';
      if (url.includes('/health') || url.includes('/metrics')) return null;
      return event;
    },

    // Error Filtering
    ignoreErrors: ['ResizeObserver loop limit exceeded'],

    // Redaction / filtering
    /**
     * Sanitizes an event before it is sent to Sentry.
     *
     * @param event - The event.
     * @returns The result of the operation.
     */
    beforeSend(event) {
      // Strip sensitive headers if present
      if (event.request?.headers) {
        const h = event.request.headers;
        delete h['authorization'];
        delete h['cookie'];
        delete h['set-cookie'];
      }

      // Remove request bodies
      if (event.request?.data) {
        delete event.request.data;
      }

      return event;
    },
  });
}
