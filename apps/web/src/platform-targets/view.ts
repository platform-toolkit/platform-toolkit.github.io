// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  DataSourceError,
  type DataSource,
  type RecordSetQuery,
} from '@platform-toolkit/data-access';
import type { RecordBook, SexCategory } from '@platform-toolkit/data-contracts';
import { REFRESH_REQUEST_EVENT, partitionKey } from '@platform-toolkit/platform-targets/core';
import {
  PLATFORM_TARGETS_TAG,
  SELECTION_APPLIED_EVENT,
  definePlatformTargets,
  type PartitionRead,
  type PtkPlatformTargets,
} from '@platform-toolkit/platform-targets/element';
import type { CategorySelection, RecordPartition } from '@platform-toolkit/platform-targets/types';
import {
  browserPreferenceStorage,
  createPreferenceStore,
  type PreferenceStore,
} from '@platform-toolkit/preferences';

import { dataSource } from '../data-source.js';

/** Identifier for this tool, and what it calls itself in a height message. */
export const TOOL_ID = 'platform-targets';

export interface PlatformTargetsViewOptions {
  /**
   * Whose categories to show. Required, and required for a reason: a default
   * here would be a federation named in code, which is the thing that reads as
   * correct while one is published and is silently wrong once two are. The page
   * declares it -- see `../federation.ts`.
   */
  readonly federationId: string;

  /** Defaults to the site's configured source. Injected in tests. */
  readonly source?: DataSource;

  /** Defaults to this device's ordinary storage. Injected in tests. */
  readonly settings?: PreferenceStore;
}

/**
 * Builds the tool and starts loading what it needs.
 *
 * The element is returned before any read finishes, showing its own loading
 * state, so the page has something with a height immediately -- the embed route
 * reports that height to its parent, and a frame that starts at zero and then
 * jumps is worse than one that starts the size of a sentence.
 *
 * This is the only file in the tool that knows a transport exists. Everything
 * below it takes what it renders as properties, which is what lets the whole
 * interface be exercised without one.
 *
 * The storage the tool remembers a context in is reached from here for the same
 * reason: `browserPreferenceStorage` touches `localStorage`, and an origin that
 * refuses access throws on the property getter -- so a module-scope store would
 * take the whole tool down at import time in exactly the third-party iframe this
 * collection is built to be embedded in. Read here it needs no branch either,
 * because it answers `null` when there is no storage to be had and
 * `createPreferenceStore(null)` reads fallbacks and reports `unavailable` on
 * every write.
 *
 * The embed route gets the same store deliberately. A framed copy sees storage
 * partitioned to the embedding site, so a lifter's remembered context there is
 * that site's and not this one's -- which is the behaviour to want, and better
 * than a framed copy that asks the seven questions again on every visit. Nothing
 * stored is sent to the parent; the only message that leaves is a height.
 */
export function createPlatformTargetsView(options: PlatformTargetsViewOptions): PtkPlatformTargets {
  definePlatformTargets();
  const element = document.createElement(PLATFORM_TARGETS_TAG);
  const source = options.source ?? dataSource;
  element.settings = options.settings ?? createPreferenceStore(browserPreferenceStorage());

  const retries: readonly Retry[] = [
    startMeta(element, source),
    startCatalog(element, source, options.federationId),
    watchForStandards(element, source, options.federationId),
    watchForRecords(element, source, options.federationId),
  ];
  const refresh = (): void => {
    for (const retry of retries) {
      retry();
    }
  };

  // One event, from two places -- the footer when there is nothing on screen at
  // all, and the report's notice beside a level of records that did not answer --
  // and it carries no detail. That is deliberate and it is what makes `refresh`
  // right: the element that asked cannot know what else on the page is broken,
  // and a lifter pressing either button means "try the whole thing again".
  element.addEventListener(REFRESH_REQUEST_EVENT, () => {
    refresh();
  });
  watchConnection(element, refresh);

  return element;
}

/**
 * One thing this file can attempt again.
 *
 * Every watcher returns one, and every one of them is a no-op unless the thing it
 * owns is *actually* in a failed state. That is what makes a single detail-less
 * `Try again` safe to fan out to all four: the press costs one request per broken
 * read and none for the rest. On the connection this tool is built for, a blanket
 * refresh that re-fetched the two record partitions a lifter is already reading
 * would be the button making the page worse.
 */
type Retry = () => void;

/**
 * Keeps the element told whether this device has a network, and tries again when
 * one comes back.
 *
 * `navigator.onLine` is read once, for the seed, and never polled. It is only
 * dependably *false*: a phone on a captive portal or one bar at a rack reports
 * `true` and cannot fetch anything, which is why nothing here treats the property
 * as evidence that a read will work. What the two events add is the *transition*,
 * and the transition is the reason this exists at all -- a lifter who walks out of
 * a basement warm-up room and back into signal should not have to find a button.
 *
 * The listeners are never removed. They hold one closure over one element for the
 * lifetime of the page, and the alternative -- tying them to the element being
 * connected -- would stop the tool noticing the network while it was being moved
 * in the DOM, which host pages really do to a frame's contents, in exchange for a
 * saving that is two closures.
 */
function watchConnection(element: PtkPlatformTargets, refresh: Retry): void {
  element.connection = navigator.onLine ? 'online' : 'offline';
  window.addEventListener('offline', () => {
    element.connection = 'offline';
  });
  window.addEventListener('online', () => {
    element.connection = 'online';
    refresh();
  });
}

/**
 * Reads the published index, which is the only thing that knows how old the
 * figures on screen are.
 *
 * Read out here rather than by the footer that draws it, for the reason every
 * other read is out here: the footer takes the answer *and the state of the read*
 * as properties, so "still fetching", "nothing has ever been saved on this device"
 * and "the publisher itself is behind" stay three sentences instead of one blank
 * line.
 *
 * It costs nothing after the first visit. The source holds the index for its own
 * lifetime -- that is what makes one screen show one build -- so on any later call
 * this is the same fetch the catalogue already made, answered twice.
 *
 * The retry leaves the status at `failed` while it runs, which is the opposite of
 * what the catalogue below does. The failed sentence is the *only* thing on screen
 * in the state that offers this button, and clearing it for the length of a read
 * that will usually fail again in milliseconds is a line that flashes rather than
 * a state that changed. The acknowledgement a lifter needs comes from the
 * questions above, which do go back to loading.
 */
function startMeta(element: PtkPlatformTargets, source: DataSource): Retry {
  let reading = false;

  const load = async (): Promise<void> => {
    reading = true;
    try {
      element.dataMeta = await source.getDataMeta();
      element.dataMetaStatus = 'ready';
    } catch (caught) {
      element.dataMetaStatus = 'failed';
      reportFailure('published index', caught);
    } finally {
      reading = false;
    }
  };

  void load();

  return () => {
    if (reading || element.dataMetaStatus !== 'failed') {
      return;
    }
    void load();
  };
}

/**
 * Reads the catalogue, and can be asked to read it again.
 *
 * Unlike the index, the retry does put the status back to `loading` -- the
 * questions are the entire screen while the catalogue is missing, so the press has
 * to be visibly doing something, and the loading state doubles as the guard that
 * stops a second press issuing a second read.
 */
function startCatalog(
  element: PtkPlatformTargets,
  source: DataSource,
  federationId: string,
): Retry {
  void loadCatalog(element, source, federationId);

  return () => {
    if (element.catalogStatus !== 'failed') {
      return;
    }
    element.catalogStatus = 'loading';
    void loadCatalog(element, source, federationId);
  };
}

async function loadCatalog(
  element: PtkPlatformTargets,
  source: DataSource,
  federationId: string,
): Promise<void> {
  try {
    const catalog = await source.getCategoryCatalog(federationId);
    element.catalog = catalog;
    // `null` is an answer, not a failure: nothing is published for this
    // federation yet. Collapsing it into the error state would tell a reader to
    // reload a page that will never load.
    element.catalogStatus = catalog === null ? 'unavailable' : 'ready';
  } catch (caught) {
    element.catalogStatus = 'failed';
    reportFailure('category catalogue', caught);
  }
}

/**
 * Loads a partition of standards whenever the lifter's sex and equipment change.
 *
 * Those two axes and no others, because those two are what choose the published
 * artifact -- one shard holds every lift, every weight class, and every division
 * for a given sex and equipment category, so a lifter switching divisions or
 * cutting to another class is already looking at data they have. Re-reading on
 * every answer would issue a request per click for a file already in hand.
 *
 * It listens for the *applied* context, not the draft. The draft fires on every
 * tap, and a lifter changing their sex category on the way to changing their
 * equipment would fetch a shard for a combination they never asked to see --
 * one bar of signal at a rack is where that difference is felt.
 *
 * The listener sits on the element rather than inside it. Composed events cross
 * the shadow boundary, and keeping the transport out here is what keeps the
 * components mountable with none.
 */
function watchForStandards(
  element: PtkPlatformTargets,
  source: DataSource,
  federationId: string,
): Retry {
  let loaded: string | null = null;
  let inFlight: AbortController | null = null;
  /** The last partition asked for, so the retry knows what to ask for again. */
  let wanted: ClassificationPartition | null = null;

  const read = (partition: ClassificationPartition): void => {
    // The previous read is abandoned rather than awaited. Two partitions in
    // flight can settle out of order, and the loser would overwrite the report
    // with standards for the category the lifter just left -- a plausible table
    // for the wrong equipment, which is the failure this screen exists to stop.
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    element.standardsStatus = 'loading';
    void loadStandards(element, source, federationId, partition, controller.signal);
  };

  element.addEventListener(SELECTION_APPLIED_EVENT, (event) => {
    const partition = partitionOf(event.detail.selection);
    if (partition === null) {
      // Unreachable through the action, which is disabled until the required
      // answers are in -- kept because "unreachable" is a claim about a file
      // this one does not own, and the cost of being wrong is a read issued for
      // a category with a missing axis.
      return;
    }
    // A slash cannot make two partitions share a key: the first segment comes
    // from a two-value picklist that contains no slash, so the first slash is
    // always the separator however a federation spells its equipment ids.
    const key = `${partition.sex}/${partition.equipmentId}`;
    if (key === loaded) {
      return;
    }
    loaded = key;
    wanted = partition;
    read(partition);
  });

  return () => {
    const partition = wanted;
    if (partition === null || element.standardsStatus !== 'failed') {
      return;
    }
    // Deliberately not clearing `loaded`. The key still names the partition being
    // re-read, and clearing it would make the *next* applied context re-fetch a
    // shard this read is about to put in hand.
    read(partition);
  };
}

interface ClassificationPartition {
  readonly sex: SexCategory;
  readonly equipmentId: string;
}

/**
 * The two axes that choose the artifact, or `null` while either is unanswered.
 *
 * The sex category is checked against the contract's picklist rather than cast.
 * A cast would compile against whatever string a radio reported and ask for a
 * partition that was never published, which the source renders as "no standards
 * for this category" -- a real answer for several categories already, so nobody
 * would look.
 */
const SEX_CATEGORIES: readonly SexCategory[] = ['female', 'male'];

function partitionOf(selection: CategorySelection): ClassificationPartition | null {
  const sex = SEX_CATEGORIES.find((candidate) => candidate === selection.sex);
  const equipmentId = selection.equipment;
  if (sex === undefined || equipmentId === null) {
    return null;
  }
  return { sex, equipmentId };
}

async function loadStandards(
  element: PtkPlatformTargets,
  source: DataSource,
  federationId: string,
  partition: ClassificationPartition,
  signal: AbortSignal,
): Promise<void> {
  try {
    const book = await source.getClassifications({ federationId, ...partition }, { signal });
    if (signal.aborted) {
      return;
    }
    element.book = book;
    // `null` is again an answer: this federation publishes no standards for this
    // sex and equipment category. The report says exactly that, per lift.
    element.standardsStatus = 'ready';
  } catch (caught) {
    if (signal.aborted) {
      // The lifter changed category mid-read. Reporting it would put a failure
      // on screen for a request nobody is waiting on any more.
      return;
    }
    element.standardsStatus = 'failed';
    reportFailure('classification standards', caught);
  }
}

/**
 * Loads *every* record partition the report is showing, in parallel.
 *
 * SEVERAL AT ONCE, NOT ONE
 *
 * This used to read one artifact, chosen by a level question and a region
 * question the lifter had to answer before seeing anything. Requirements 3 and 4
 * removed both questions -- world and national records are always shown, state
 * records are added when a state is picked -- so the report now wants two or
 * three artifacts at the same time, and the resolver says which in
 * `event.detail.partitions`.
 *
 * They are separate reads on purpose, and they are surfaced separately. Awaiting
 * them together would hold the whole report behind the slowest one, which on a
 * phone at a rack is the difference between a screen and a spinner; instead each
 * lands under its own key with its own status and the report renders what has
 * arrived.
 *
 * Records are partitioned on (level, region, sex, equipment) -- two axes more
 * than classifications, because the whole corpus is far past the 2 MiB budget on
 * level and region alone (ADR 2, amended). Within those four the screen still
 * moves freely: every discipline, class, division and lift for a partition is in
 * the one file, so nothing a lifter does to the report costs another request.
 *
 * WHY THE SELECTION IS TAKEN OFF THE EVENT AND NOT OFF THE ELEMENT
 *
 * `createPlatformTargetsView` registers this listener *before* the element is
 * appended, so it runs before the element's own `connectedCallback` listener has
 * recorded anything: `element.currentSelection` would be the value from before
 * this event, and the symptom is a report one answer behind the questions above
 * it. Everything needed is on the event -- which is also why the partitions ride
 * along on it rather than being derived here, since deriving them needs the
 * catalogue and this file deliberately has no idea what a competition level is.
 */
function watchForRecords(
  element: PtkPlatformTargets,
  source: DataSource,
  federationId: string,
): Retry {
  /** What the report is currently being shown, keyed by partition. */
  let reads: ReadonlyMap<string, PartitionRead> = new Map();
  /**
   * The lifter's own two axes, kept so a retry can reissue a read without an
   * applied context to take them off. Every partition in `reads` was read for
   * these, because a change to either rebuilds the whole map.
   */
  let lifterAxes: ClassificationPartition | null = null;
  /**
   * The full four-axis identity behind each key, so a sex or equipment change
   * re-reads a partition whose level and region did not move.
   *
   * The key alone is (level, region) -- the two axes the report *names* -- and
   * keying the cache on that would leave a lifter switching from raw to
   * single-ply looking at their raw records under an unchanged heading.
   */
  const identities = new Map<string, string>();
  const controllers = new Map<string, AbortController>();

  /**
   * Hands the element a new map rather than mutating the one it holds.
   *
   * Lit compares properties by identity, so filling in the same `Map` as reads
   * settle changes nothing on screen -- the report would sit on "Loading the
   * national records" with the book already in memory.
   */
  const publish = (): void => {
    element.recordReads = reads;
  };

  /**
   * Applies one settled read, if it is still the one being waited for.
   *
   * Two guards, and both are needed. The controller check is the "loser must not
   * win" rule: a slower read for the equipment the lifter just left would
   * otherwise paint plausible figures for the wrong category, with nothing on
   * screen to say so. The presence check covers a partition dropped entirely --
   * clearing a state puts its records out of the report, and a read still in
   * flight for it must not put them back.
   *
   * A failure always settles as `failed`, and there is deliberately no "kept the
   * old book" outcome. Both paths that start a read leave nothing to keep: the
   * applied-context path clears the book because it is reading a *different*
   * artifact (a new category's failure must never leave the old category's numbers
   * on screen under the new heading), and the retry path only re-reads partitions
   * that already have no book. Whether the figures on screen might have been
   * superseded is a question about the whole publication rather than one
   * partition, and `ptk-target-freshness` answers it from `meta.json`.
   */
  const settle = (
    key: string,
    controller: AbortController,
    partition: RecordPartition,
    outcome: { readonly status: 'ready' | 'failed'; readonly book: RecordBook | null },
  ): void => {
    if (controllers.get(key) !== controller) {
      return;
    }
    if (!reads.has(key)) {
      return;
    }
    const read: PartitionRead = { partition, status: outcome.status, book: outcome.book };
    const next = new Map(reads);
    next.set(key, read);
    reads = next;
    publish();
  };

  /**
   * Issues one partition's read and files the controller that owns it.
   *
   * Shared by the applied-context path and the retry, which differ only in what
   * they put in the map first -- an empty loading entry for a category the lifter
   * just changed to, the previous book for one being refreshed. Nothing here
   * touches `reads`, so a caller can settle the map before or after calling this:
   * `then` runs in a microtask and the callers are synchronous.
   */
  const start = (key: string, partition: RecordPartition, axes: ClassificationPartition): void => {
    controllers.get(key)?.abort();
    const controller = new AbortController();
    controllers.set(key, controller);
    identities.set(key, identityOf(partition, axes));

    void readRecords(
      source,
      {
        // The federation and its record book share an identifier by
        // construction: the source document's `id` is the federation's, and it
        // is what the publisher names the book with. Written out here rather
        // than passed as one value so the day a federation publishes two books
        // -- a masters set, an equipped set kept apart -- this is the line that
        // needs a catalogue entry rather than a silently wrong lookup.
        bookId: federationId,
        levelId: partition.levelId,
        regionId: partition.regionId,
        sex: axes.sex,
        equipmentId: axes.equipmentId,
      },
      controller.signal,
    ).then(
      (outcome) => {
        if (outcome === null) {
          return;
        }
        settle(key, controller, partition, outcome);
      },
      (caught: unknown) => {
        // `readRecords` handles every failure it can name, so anything landing
        // here is a defect in this file rather than a failed request. Reported
        // rather than swallowed (§2.4), and with the same reason-only wording,
        // because an unexpected throw is exactly where a cause chain carrying a
        // URL would otherwise reach the console.
        reportFailure('records', caught);
      },
    );
  };

  element.addEventListener(SELECTION_APPLIED_EVENT, (event) => {
    const lifter = partitionOf(event.detail.selection);
    if (lifter === null) {
      // Same guard as the standards watcher, for the same reason: the action
      // cannot fire without the required answers, and clearing anything here
      // would drop a book that is still the right one.
      return;
    }
    lifterAxes = lifter;

    // Rebuilt in the resolver's order rather than patched in place, so the map's
    // iteration order is the order the report lists partitions in. Patching
    // would leave a state that was cleared and re-picked sitting after the
    // national records it is meant to precede.
    const next = new Map<string, PartitionRead>();
    const starting: RecordPartition[] = [];
    for (const partition of event.detail.partitions) {
      const key = partitionKey(partition);
      const identity = identityOf(partition, lifter);
      const held = reads.get(key);
      if (identities.get(key) === identity && held !== undefined) {
        // Same artifact, and it is already read or being read. The label is
        // taken from the new partition anyway: it comes from the catalogue and a
        // refresh could have reworded it, and a stale heading over a live book is
        // the kind of wrong nothing else on screen contradicts.
        next.set(key, { ...held, partition });
        continue;
      }

      // The book is cleared, unlike in a retry. This is a different artifact, so
      // whatever is in hand belongs to the category the lifter has left, and a
      // failure that kept it would print last category's records under this
      // category's heading.
      next.set(key, { partition, status: 'loading', book: null });
      starting.push(partition);
    }

    // Anything the report no longer shows is abandoned. Without this, clearing a
    // state leaves its read running and its slot in the map, and the report keeps
    // a column for records nobody asked for.
    for (const [key, controller] of controllers) {
      if (!next.has(key)) {
        controller.abort();
        controllers.delete(key);
        identities.delete(key);
      }
    }

    reads = next;
    publish();
    for (const partition of starting) {
      start(partitionKey(partition), partition, lifter);
    }
  });

  return () => {
    const axes = lifterAxes;
    if (axes === null) {
      return;
    }
    // Only the partitions that have something wrong with them, which is what lets
    // the footer's button and the report's button be the same event. A blanket
    // re-read would be the button making the page worse: the published index is
    // held for the lifetime of this source so that one screen shows one build
    // (§5.3), so re-reading a partition that already answered can only return the
    // same artifact -- at the cost of replacing figures a lifter is reading with
    // "Updating…" on the connection that made them press the button.
    const again = [...reads.values()].filter((read) => read.status === 'failed');
    if (again.length === 0) {
      return;
    }

    const next = new Map(reads);
    for (const read of again) {
      next.set(partitionKey(read.partition), { ...read, status: 'loading' });
    }
    reads = next;
    publish();
    for (const read of again) {
      start(partitionKey(read.partition), read.partition, axes);
    }
  };
}

/**
 * The four axes that choose the artifact, as one string.
 *
 * Newline-separated for the reason `partitionKey` gives: a level, region or
 * equipment identifier is a slug from published data and may contain a hyphen or
 * a colon, so any of those as a separator would let two identities collide and
 * the second read would never be issued. A newline is excluded from all four.
 */
function identityOf(partition: RecordPartition, lifter: ClassificationPartition): string {
  return [partition.levelId, partition.regionId ?? '', lifter.sex, lifter.equipmentId].join('\n');
}

/**
 * Reads one partition, or answers `null` if nobody is waiting for it any more.
 *
 * The abort check happens after the await *and* in the catch, because an aborted
 * fetch can either resolve late or reject, and only one of the two paths is
 * obvious. Reporting the rejection would put a failure on screen for a request
 * the lifter has already navigated past.
 */
async function readRecords(
  source: DataSource,
  query: RecordSetQuery,
  signal: AbortSignal,
): Promise<{ status: 'ready' | 'failed'; book: RecordBook | null } | null> {
  try {
    const book = await source.getRecords(query, { signal });
    if (signal.aborted) {
      return null;
    }
    // `null` is an answer, not a failure: the federation keeps no records for
    // this partition. The report says exactly that, and says what it would take
    // to set one.
    return { status: 'ready', book };
  } catch (caught) {
    if (signal.aborted) {
      return null;
    }
    reportFailure('records', caught);
    return { status: 'failed', book: null };
  }
}

/**
 * Says on the console that a read failed, and says nothing else.
 *
 * The error object is not passed through. A `DataSourceError` carries no URL by
 * construction, but its `cause` is whatever the transport threw, and a console
 * expands a cause chain -- which is exactly where a request URL, and eventually
 * an imported profile URL, would show up. The reason code is the part that helps
 * and the only part that is safe to keep.
 */
function reportFailure(what: string, caught: unknown): void {
  const reason = caught instanceof DataSourceError ? caught.reason : 'unexpected';
  console.error(`Platform Targets could not load the ${what}: ${reason}.`);
}
