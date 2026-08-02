import {
  DataSourceError,
  type DataSource,
  type RecordSetQuery,
} from '@platform-toolkit/data-access';
import type { RecordBook, SexCategory } from '@platform-toolkit/data-contracts';
import {
  browserPreferenceStorage,
  createPreferenceStore,
  type PreferenceStore,
} from '@platform-toolkit/preferences';

import { dataSource } from '../data-source.js';
import './ptk-platform-targets.js';
import type { PtkPlatformTargets } from './ptk-platform-targets.js';
import { SELECTION_APPLIED_EVENT } from './ptk-target-categories.js';
import type { PartitionRead } from './ptk-target-report.js';
import { partitionKey, type CategorySelection, type RecordPartition } from './selection.js';

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
  const element = document.createElement('ptk-platform-targets');
  const source = options.source ?? dataSource;
  element.settings = options.settings ?? createPreferenceStore(browserPreferenceStorage());

  void loadCatalog(element, source, options.federationId);
  watchForStandards(element, source, options.federationId);
  watchForRecords(element, source, options.federationId);
  return element;
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
): void {
  let loaded: string | null = null;
  let inFlight: AbortController | null = null;

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

    // The previous read is abandoned rather than awaited. Two partitions in
    // flight can settle out of order, and the loser would overwrite the report
    // with standards for the category the lifter just left -- a plausible table
    // for the wrong equipment, which is the failure this screen exists to stop.
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    element.standardsStatus = 'loading';
    void loadStandards(element, source, federationId, partition, controller.signal);
  });
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
): void {
  /** What the report is currently being shown, keyed by partition. */
  let reads: ReadonlyMap<string, PartitionRead> = new Map();
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
   */
  const settle = (key: string, controller: AbortController, read: PartitionRead): void => {
    if (controllers.get(key) !== controller) {
      return;
    }
    const held = reads.get(key);
    if (held === undefined) {
      return;
    }
    const next = new Map(reads);
    next.set(key, read);
    reads = next;
    publish();
  };

  element.addEventListener(SELECTION_APPLIED_EVENT, (event) => {
    const lifter = partitionOf(event.detail.selection);
    if (lifter === null) {
      // Same guard as the standards watcher, for the same reason: the action
      // cannot fire without the required answers, and clearing anything here
      // would drop a book that is still the right one.
      return;
    }

    // Rebuilt in the resolver's order rather than patched in place, so the map's
    // iteration order is the order the report lists partitions in. Patching
    // would leave a state that was cleared and re-picked sitting after the
    // national records it is meant to precede.
    const next = new Map<string, PartitionRead>();
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

      controllers.get(key)?.abort();
      const controller = new AbortController();
      controllers.set(key, controller);
      identities.set(key, identity);
      next.set(key, { partition, status: 'loading', book: null });

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
          sex: lifter.sex,
          equipmentId: lifter.equipmentId,
        },
        controller.signal,
      ).then(
        (outcome) => {
          if (outcome === null) {
            return;
          }
          settle(key, controller, { partition, status: outcome.status, book: outcome.book });
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
  });
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
