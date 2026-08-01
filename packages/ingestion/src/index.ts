/**
 * Ingestion entry point.
 *
 * Everything in this package runs in CI and never reaches the browser. External
 * fetching lives here and only here, which is what keeps the published
 * application free of any code path that requests a user-supplied URL.
 *
 * Source adapters land in P1 (classifications), P2 (OpenPowerlifting mirror),
 * P3 (qualification rules), and P4 (records).
 */

export {
  SOURCE_FETCH_TIMEOUT_MS,
  ALLOWED_SOURCE_HOSTS,
  assertAllowedSourceUrl,
} from './fetch-policy.js';
