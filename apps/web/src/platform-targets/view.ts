import { DataSourceError, type DataSource } from '@platform-toolkit/data-access';
import type { SexCategory } from '@platform-toolkit/data-contracts';

import { dataSource } from '../data-source.js';
import './ptk-platform-targets.js';
import type { PtkPlatformTargets } from './ptk-platform-targets.js';
import { SELECTION_CHANGE_EVENT } from './ptk-target-categories.js';
import type { CategorySelection } from './selection.js';

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
}

/**
 * Builds the tool and starts loading what it needs.
 *
 * The element is returned before either read finishes, showing its own loading
 * state, so the page has something with a height immediately -- the embed route
 * reports that height to its parent, and a frame that starts at zero and then
 * jumps is worse than one that starts the size of a sentence.
 *
 * This is the only file in the tool that knows a transport exists. Everything
 * below it takes what it renders as properties, which is what lets the whole
 * interface be exercised without one.
 */
export function createPlatformTargetsView(options: PlatformTargetsViewOptions): PtkPlatformTargets {
  const element = document.createElement('ptk-platform-targets');
  const source = options.source ?? dataSource;

  void loadCatalog(element, source, options.federationId);
  watchForStandards(element, source, options.federationId);
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

  element.addEventListener(SELECTION_CHANGE_EVENT, (event) => {
    const partition = partitionOf(event.detail.selection);
    if (partition === null) {
      // Not an error and not worth clearing anything over: the lifter is part
      // way through the questions, and the standards panel says so itself.
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
    // flight can settle out of order, and the loser would overwrite the panel
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
    // sex and equipment category. The panel says exactly that, per lift.
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
