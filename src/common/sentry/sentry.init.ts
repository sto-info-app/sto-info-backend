import * as Sentry from '@sentry/nestjs';

import { getAppVersion } from '../../shared/utilities/version.utility';

/** What a request may carry that must never reach Sentry. */
interface SentryRequest {
  headers?: Record<string, string>;
  data?: unknown;
  query_string?: unknown;
  cookies?: unknown;
}

/**
 * Takes out of an event's request everything a person sent: credentials,
 * the body and the query (FC-038). A roster, a chat message or a form's
 * content travels in one of those, and none of it may reach a provider.
 *
 * @param event - The event.
 * @param event.request - Its request, if any.
 * @returns The event.
 */
export function stripRequest<T extends { request?: SentryRequest }>(
  event: T,
): T {
  const request = event.request;

  if (request?.headers) {
    delete request.headers['authorization'];
    delete request.headers['cookie'];
    delete request.headers['set-cookie'];
  }

  if (request) {
    delete request.data;
    delete request.query_string;
    delete request.cookies;
  }

  return event;
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'dev',
    release: `sto-info-backend@${getAppVersion()}`,

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
      return stripRequest(event);
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
      return stripRequest(event);
    },
  });
}
