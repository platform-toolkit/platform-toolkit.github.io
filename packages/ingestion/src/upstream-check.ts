/**
 * Comparing a committed snapshot against the dataset it was taken from.
 *
 * The build refuses to run when a snapshot's bytes stop matching the digest its
 * mapping pins, which is what stops a federation's revision from being published
 * under a mapping nobody re-read. That protects the site, but it says nothing
 * until somebody happens to build: upstream can revise its standards in March and
 * the repository will keep serving the old figures, correctly and confidently,
 * until the next release.
 *
 * This closes that gap from the other side. It downloads what upstream is
 * publishing now, digests it, and compares. Nothing here writes a snapshot or
 * changes a pin -- a drifted source is reported, not adopted, because adopting it
 * is the deliberate act the pin exists to require.
 *
 * A source with no recorded URL is reported as `manual` rather than skipped. The
 * two look identical in a passing run and are not the same thing at all: one is
 * watched and unchanged, the other is not watched.
 */
import { createHash } from 'node:crypto';

/** How a source stands relative to what upstream is publishing right now. */
export type UpstreamStatus =
  /** Upstream still serves exactly the bytes the snapshot pins. */
  | 'matched'
  /** Upstream serves something else. A person has to look at it. */
  | 'drifted'
  /** Upstream could not be reached, or answered with something unusable. */
  | 'unreachable'
  /** No URL is recorded, so nothing is watching this source. */
  | 'manual';

/** One source to check: what it pins, and where to look. */
export interface UpstreamSource {
  /** Stable identifier, used as the report key and in issue text. */
  readonly id: string;
  /** The repository path of the document that declares the pin. */
  readonly document: string;
  /** The digest the committed snapshot is pinned to. */
  readonly sha256: string;
  /** Where to fetch, or `null` for a snapshot that was not downloaded. */
  readonly url: string | null;
}

/** What the check found for one source. */
export interface UpstreamFinding {
  readonly id: string;
  readonly document: string;
  readonly status: UpstreamStatus;
  /** The pinned digest, repeated so a report is readable without the source. */
  readonly expectedSha256: string;
  /** What upstream served, when it served something. */
  readonly actualSha256: string | null;
  /** Why, for `unreachable`. Never carries a URL -- see `redact` below. */
  readonly detail: string | null;
}

/** The whole run, in the shape that gets committed. */
export interface UpstreamReport {
  /** When this ran. Supplied, not read from the clock, so the caller owns it. */
  readonly checkedAt: string;
  readonly findings: readonly UpstreamFinding[];
}

/**
 * A cap on what will be pulled into memory.
 *
 * The largest snapshot in the repository is about 1.4 MB. Sixteen is generous
 * enough that a federation doubling its published data is not an incident, and
 * small enough that a misconfigured URL answering with a video does not become
 * one either.
 */
const MAXIMUM_BYTES = 16 * 1024 * 1024;

/** Long enough for a slow origin, short enough that a hung socket is not a job. */
const TIMEOUT_MILLISECONDS = 30_000;

/**
 * Checks every source, in order, and reports on all of them.
 *
 * Sequential rather than concurrent. There are a handful of sources, they are
 * checked once a week, and hitting one origin with parallel requests to save two
 * seconds is a poor trade against being an obviously well-behaved client.
 *
 * Never throws for a source-level problem: an origin being down is a fact to
 * report, not a reason to abandon the other sources. The caller decides what an
 * `unreachable` is worth.
 */
export async function checkUpstream(
  sources: readonly UpstreamSource[],
  checkedAt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpstreamReport> {
  const findings: UpstreamFinding[] = [];
  for (const source of sources) {
    findings.push(await checkOne(source, fetchImpl));
  }
  return {
    checkedAt,
    findings: [...findings].sort((left, right) => (left.id < right.id ? -1 : 1)),
  };
}

async function checkOne(source: UpstreamSource, fetchImpl: typeof fetch): Promise<UpstreamFinding> {
  const base = {
    id: source.id,
    document: source.document,
    expectedSha256: source.sha256,
  } as const;

  if (source.url === null) {
    return {
      ...base,
      status: 'manual',
      actualSha256: null,
      detail: 'No URL is recorded for this snapshot, so nothing is watching it.',
    };
  }

  let actual: string;
  try {
    actual = await download(source.url, fetchImpl);
  } catch (error) {
    return {
      ...base,
      status: 'unreachable',
      actualSha256: null,
      detail: redact(error, source.url),
    };
  }

  return {
    ...base,
    status: actual === source.sha256 ? 'matched' : 'drifted',
    actualSha256: actual,
    detail: null,
  };
}

/**
 * Downloads a URL and returns the digest of exactly the bytes received.
 *
 * Streamed and counted rather than buffered whole, so an origin that answers a
 * 1 MB request with an unbounded body is cut off at the cap instead of deciding
 * how much memory the job uses. A `Content-Length` would be cheaper to check but
 * is a claim, not a measurement.
 */
async function download(url: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MILLISECONDS),
    headers: { accept: 'application/json, text/plain;q=0.5' },
  });

  if (!response.ok) {
    throw new Error(`answered ${String(response.status)} ${response.statusText}`);
  }
  if (response.body === null) {
    throw new Error('answered with an empty body');
  }

  const digest = createHash('sha256');
  let received = 0;
  for await (const chunk of response.body) {
    const bytes = chunk as Uint8Array;
    received += bytes.byteLength;
    if (received > MAXIMUM_BYTES) {
      throw new Error(`answered with more than ${String(MAXIMUM_BYTES)} bytes`);
    }
    digest.update(bytes);
  }
  if (received === 0) {
    throw new Error('answered with no bytes');
  }
  return digest.digest('hex');
}

/**
 * Turns a failure into one line, with the URL taken back out of it.
 *
 * `fetch` puts the URL into several of its messages, and this text is written
 * into a committed file and into a public issue. The URL is already in the
 * repository, so this is not secrecy; it is that a report which quotes a URL back
 * in an error string is a report somebody will eventually paste a credentialed
 * one into. Refusing to carry it at all is the version that stays true.
 */
function redact(error: unknown, url: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(url).join('<url>');
}
