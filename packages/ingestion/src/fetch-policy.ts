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
  // The record index. Its pages carry no records themselves -- each one names a
  // table held by the three hosts below, which is why reading records means
  // fetching from a vendor rather than from the federation. See `record-crawl`.
  'records.uspa.net',
  // Resolves a record table's identifiers to the document that holds it. Answers
  // with a redirect, so the host it redirects to has to be permitted as well.
  'app.infoweave.io',
  // Serves the one-line loader that names the document. The subdomain is a
  // generated deployment name and will change if the vendor redeploys; when it
  // does, the crawl fails loudly here rather than following a redirect somewhere
  // nobody chose.
  'embedloader-n2swltlhwq-uc.a.run.app',
  // The vendor's public database, where a record table actually lives. Read
  // anonymously, exactly as the embed reads it; no credential is involved and
  // none would be accepted.
  'firestore.googleapis.com',
  // Technical rulebook PDF behind the IPF meet rule profile, re-digested by
  // `check:upstream`. The edition pinned there takes effect on a date, so an
  // unwatched copy goes wrong on a day nobody set a reminder for.
  'www.powerlifting.sport',
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
