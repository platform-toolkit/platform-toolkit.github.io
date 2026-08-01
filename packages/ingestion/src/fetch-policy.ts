/**
 * Outbound fetch policy for the ingestion pipeline.
 *
 * The published application never fetches a user-supplied URL -- it reads static
 * JSON from its own origin and computes everything client-side. That removes the
 * request-forgery surface from the app entirely, but it does not remove it from
 * the project: this package still reaches out to third-party hosts on a schedule.
 * So the allowlisting, protocol enforcement, and timeouts live here, where the
 * external requests actually happen.
 *
 * The allowlist is exact-match on host, not a suffix check. Suffix matching is a
 * recurring source of bypasses, because an attacker-controlled `uspa.net.example`
 * ends with a permitted string without being the permitted host.
 */

/** Hosts this project is permitted to fetch from, with why each is needed. */
export const ALLOWED_SOURCE_HOSTS: readonly string[] = [
  // Classification standards and the events REST API.
  'uspa.net',
  'www.uspa.net',
  // Record tables (rendered headlessly; see the records adapter).
  'records.uspa.net',
  // Bulk competition dataset and its change-detection file.
  'openpowerlifting.gitlab.io',
  // Source repository for the dataset, used for change detection and self-build.
  'gitlab.com',
];

/** Upper bound on any single ingestion request. */
export const SOURCE_FETCH_TIMEOUT_MS = 60_000;

export class DisallowedSourceUrlError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DisallowedSourceUrlError';
  }
}

/**
 * Validates that a URL may be fetched by the ingestion pipeline.
 *
 * @throws {DisallowedSourceUrlError} if the URL is malformed, not HTTPS, carries
 *   embedded credentials, or targets a host outside the allowlist.
 */
export function assertAllowedSourceUrl(candidate: string): URL {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new DisallowedSourceUrlError(`Not a valid absolute URL: ${JSON.stringify(candidate)}`);
  }

  if (url.protocol !== 'https:') {
    throw new DisallowedSourceUrlError(
      `Only https is permitted for source fetches, received ${url.protocol}`,
    );
  }

  // Credentials in a source URL would mean this project had invented an
  // authentication scheme for public data. Every source here is unauthenticated.
  if (url.username !== '' || url.password !== '') {
    throw new DisallowedSourceUrlError('Source URLs must not contain embedded credentials');
  }

  if (!ALLOWED_SOURCE_HOSTS.includes(url.hostname)) {
    throw new DisallowedSourceUrlError(`Host is not on the source allowlist: ${url.hostname}`);
  }

  return url;
}
