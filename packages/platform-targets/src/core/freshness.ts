// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * How old the figures on screen are, and whether they are the current ones.
 *
 * Pure, like `selection.ts` and `goals.ts` beside it: it takes what the transport
 * knows and returns a sentence. No `navigator`, no `Date`, no clock -- the one
 * date it prints comes out of the published index, and a module that also read
 * the device clock would be a module that could say "verified today" about a file
 * downloaded last week.
 *
 * WHY A TOOL LIKE THIS HAS TO SAY IT AT ALL
 *
 * The tool is built to be read at a rack, and a rack is where the signal is
 * worst. The service worker will happily serve the last publication it saw, which
 * is the behaviour to want -- a lifter with no bars is better off with last
 * week's records than with a spinner. What is not acceptable is showing them
 * without saying so: a record that moved on Saturday and a phone showing Friday's
 * copy look identical, and the difference is an attempt that does not count.
 *
 * So every state below is a different sentence, and the one thing none of them
 * does is present old data as current.
 *
 * WHICH DATE IS PRINTED
 *
 * The **oldest** `retrievedAt` across every source in the index, not the newest
 * and not the build time. `SourceFreshnessSchema` says why the sources are
 * tracked apart: they refresh on different cadences, and one figure implying the
 * slowest is as fresh as the fastest is the misreading the per-source shape
 * exists to prevent. Collapsing to the oldest keeps one short line at the foot of
 * a phone screen and can only ever understate, which is the safe direction.
 */
import type { DataMeta } from '@platform-toolkit/data-contracts';
import { formatPlainDateLong, parsePlainDate } from '@platform-toolkit/domain';

/**
 * Fired when a lifter asks for the reads to be attempted again.
 *
 * It lives here, in the module about how current the data is, because the two
 * elements that offer the action -- the footer and the report's own failure
 * notice -- have no other module in common, and an event name written out twice
 * is two spellings that agree until one of them is edited. Composed, so it
 * reaches the transport listening on the tool's host element the same way an
 * applied selection does; nothing between them has to forward it.
 */
export const REFRESH_REQUEST_EVENT = 'ptk-refresh-request';

declare global {
  interface HTMLElementEventMap {
    [REFRESH_REQUEST_EVENT]: CustomEvent<void>;
  }
}

/** Whether this device currently believes it can reach the network. */
export type Connection = 'online' | 'offline';

/** Where the read of the published index has got to. */
export type DataMetaStatus = 'loading' | 'ready' | 'failed';

export interface FreshnessInput {
  readonly connection: Connection;
  /** The published index, once it has been read. */
  readonly meta: DataMeta | null;
  readonly metaStatus: DataMetaStatus;
  /**
   * Whether any published figure is on screen.
   *
   * The whole distinction between "you are offline and reading a saved copy" and
   * "you are offline and there is no saved copy" turns on this, and the caller is
   * the only thing that knows: an index that read successfully is not yet a
   * screen with numbers on it.
   */
  readonly showingData: boolean;
  /**
   * What the federation calls itself, from the published catalogue.
   *
   * `null` until it has been read -- which is exactly the state the offline
   * sentence below is written for, so that sentence has to work without it. Never
   * defaulted to a name in code: see `federation.ts`.
   */
  readonly federationLabel: string | null;
}

/**
 * How loudly to draw the line.
 *
 * `quiet` is the ordinary case and is muted footnote text. `caution` is data a
 * reader can still use but must know the age of. `error` is a screen with nothing
 * true on it. Tone never carries the meaning on its own -- each one has its own
 * words -- because a colour is discarded under forced colours and by a reader who
 * cannot separate two hues.
 */
export type FreshnessTone = 'quiet' | 'caution' | 'error';

export interface Freshness {
  /** The line to draw, or `null` when there is nothing true to say yet. */
  readonly sentence: string | null;
  /** The same date in ISO form, for a `time datetime`. `null` when unknown. */
  readonly verifiedOn: string | null;
  readonly tone: FreshnessTone;
  /**
   * What to announce politely, once, or `null` for the states not worth saying.
   *
   * The ordinary "Last verified …" is deliberately silent. It is true on every
   * visit, it changes nothing about what a reader should do, and a live region
   * that speaks on every load is a live region a reader learns to ignore before
   * the one time it matters.
   */
  readonly announce: string | null;
}

/** Nothing known yet: the state before the first read settles. */
const UNKNOWN: Freshness = { sentence: null, verifiedOn: null, tone: 'quiet', announce: null };

export function readFreshness(input: FreshnessInput): Freshness {
  const verifiedOn = oldestRetrieval(input.meta);
  const verifiedLabel = longDate(verifiedOn);

  if (input.connection === 'offline' && input.metaStatus === 'failed') {
    // Guarded on the failed read rather than on `!showingData`, so an offline
    // visit with a cached copy does not flash "nothing saved" in the moment
    // between the page painting and the cache answering.
    return {
      sentence: `Targets have not been saved on this device yet. Reconnect once to load ${categoryPhrase(input.federationLabel)}.`,
      verifiedOn,
      tone: 'error',
      announce: 'Offline, and no targets have been saved on this device yet.',
    };
  }

  if (input.connection === 'offline' && input.showingData) {
    const sentence =
      verifiedLabel === null
        ? 'Offline · Showing the copy saved on this device.'
        : `Offline · Showing data last verified ${verifiedLabel}.`;
    return { sentence, verifiedOn, tone: 'caution', announce: sentence };
  }

  if (input.showingData && degraded(input.meta)) {
    // The publisher itself could not refresh every source. Distinct from being
    // offline, and worth its own words: reconnecting will not fix it, and the
    // figures are as current as anybody's until the source comes back.
    const sentence =
      verifiedLabel === null
        ? 'Update unavailable · Showing the last published data.'
        : `Update unavailable · Showing data last verified ${verifiedLabel}.`;
    return { sentence, verifiedOn, tone: 'caution', announce: sentence };
  }

  if (input.showingData && verifiedLabel !== null) {
    return {
      sentence: `Last verified ${verifiedLabel}.`,
      verifiedOn,
      tone: 'quiet',
      announce: null,
    };
  }

  return { ...UNKNOWN, verifiedOn };
}

/**
 * "this USPA category", or "this category" before the catalogue has been read.
 *
 * Exported because the report's empty-panel sentence says the same phrase about
 * the same thing, and two spellings of one phrase on one screen is a reader
 * checking whether they mean the same category.
 *
 * `exact` is the report's spelling and adds one word that is doing real work.
 * Nine axes select a target and eight of them are answered by a control on the
 * screen above, so "nothing published here" is far more often the neighbouring
 * permutation than a gap in the data (§14.3) -- and a lifter who reads it as the
 * latter concludes the federation keeps no record where one stands two taps away.
 * One function rather than two so the two sentences cannot drift.
 */
export function categoryPhrase(
  federationLabel: string | null,
  options: { readonly exact?: boolean } = {},
): string {
  const qualifier = options.exact === true ? 'exact ' : '';
  return federationLabel === null
    ? `this ${qualifier}category`
    : `this ${qualifier}${federationLabel} category`;
}

/**
 * The earliest date any source was last retrieved on, as `YYYY-MM-DD`.
 *
 * The date half is taken first and only then compared. Ordering the whole
 * timestamps would work today -- they are ISO, and ISO sorts -- and would go
 * wrong the first time one arrived with an offset rather than a `Z`, which is a
 * legal timestamp that sorts before an earlier UTC instant. Once both sides are
 * a validated `YYYY-MM-DD`, comparing them as strings *is* comparing them as
 * calendar dates, which is why `parsePlainDate` is used to check the shape and
 * not to produce a comparand.
 */
function oldestRetrieval(meta: DataMeta | null): string | null {
  let oldest: string | null = null;
  for (const source of meta?.sources ?? []) {
    const day = source.retrievedAt.slice(0, 'YYYY-MM-DD'.length);
    const parsed = parsePlainDate(day);
    if (!parsed.ok) {
      // A timestamp the contract accepted but whose date half will not parse is
      // not a reason to hide the whole line; the other sources still answer.
      continue;
    }
    if (oldest === null || day < oldest) {
      oldest = day;
    }
  }
  return oldest;
}

function longDate(iso: string | null): string | null {
  if (iso === null) {
    return null;
  }
  const parsed = parsePlainDate(iso);
  return parsed.ok ? formatPlainDateLong(parsed.date) : null;
}

/** Whether the publisher reported any source as anything other than current. */
function degraded(meta: DataMeta | null): boolean {
  return (meta?.sources ?? []).some((source) => source.status !== 'ok');
}
