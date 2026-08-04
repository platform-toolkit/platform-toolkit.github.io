// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Builds the planner, reads the two published artifacts, and gives the tool
 * somewhere to remember what it was doing.
 *
 * The only file in this tool that knows a transport or a storage exists --
 * §5.8's rule, arriving for the fourth time. Everything below takes the data and
 * the *state of the read* as properties, which is what makes "still loading",
 * "the read failed" and "nothing published yet" three different sentences on
 * screen and three reachable states in a story with no network.
 *
 * WHY THE FEDERATION IS NOT AN OPTION HERE
 *
 * Tools 1 and 4 take a `federationId` because their pages are *about* one
 * federation: the mount point declares it and §5.1 forbids a default. This tool
 * is about a lifter's meet, and which federation the meet is under is §6.2's
 * first question -- so the page cannot declare it, and there is exactly one
 * planner route rather than one per federation. The list of federations is
 * therefore published data like any other, and the answer arrives back from the
 * element as an event.
 *
 * WHICH IS WHY THE CHART READ IS THE INTERESTING ONE
 *
 * §16 gives the pound column to the federation's own printing, so the chart is
 * per federation, and the federation can change at any moment -- three times in
 * five seconds, while a lifter reads the descriptions under the options. Two
 * things follow, and both are guarded below: a slow read for a federation the
 * lifter has since moved off must never land, and a chart already on screen must
 * be cleared the instant the federation changes rather than when its replacement
 * arrives. Getting the second wrong shows one federation's published pounds
 * beside another federation's kilograms, which is precisely the arithmetic §16
 * exists to prevent, dressed up as published data.
 */
import { DataSourceError, type DataSource } from '@platform-toolkit/data-access';
import { ConversionChart } from '@platform-toolkit/domain';
import {
  browserPreferenceStorage,
  createPreferenceStore,
  type PreferenceStore,
} from '@platform-toolkit/preferences';

import { dataSource } from '../data-source.js';
import { noMeetStore, type MeetStore } from './meet-store.js';
import { FEDERATION_CHANGE_EVENT } from './ptk-meet-day-planner.js';
import './ptk-meet-day-planner.js';
import type { PtkMeetDayPlanner } from './ptk-meet-day-planner.js';

/** Identifier for this tool, and what it calls itself in a height message. */
export const TOOL_ID = 'meet-day';

export interface PlannerViewOptions {
  /** Defaults to the site's configured source. Injected in tests. */
  readonly source?: DataSource;

  /** Defaults to this device's ordinary storage. Injected in tests. */
  readonly settings?: PreferenceStore;

  /**
   * Where §24's saved meets go. Supplied by the page entry; injected in tests.
   *
   * Separate from `settings` although both end up on the same storage, because
   * the two answer different questions and the two routes answer this one
   * differently. `settings` is a handful of device preferences and the same
   * store is right everywhere; a saved meet is a document about a person, and
   * §2.5 forbids an embedded copy of this tool keeping one under somebody
   * else's origin.
   *
   * So this one defaults the *other* way from `settings`: omitting it keeps
   * nothing. A route added later that forgets to pass a store loses a lifter's
   * saved meets, which they will notice; the fail-open version writes a
   * bodyweight and three maximums into an embedder's storage, which nobody
   * notices at all.
   */
  readonly store?: MeetStore;
}

/**
 * The tool, ready to append.
 *
 * Returned before either read completes, showing its own loading sentence, so
 * the page has a height immediately -- the embed route reports that height to
 * its parent, and a frame that starts at zero and then jumps is worse than one
 * that starts the size of a sentence.
 */
export function createPlannerView(options: PlannerViewOptions = {}): PtkMeetDayPlanner {
  const element = document.createElement('ptk-meet-day-planner');
  const source = options.source ?? dataSource;
  element.settings = options.settings ?? createPreferenceStore(browserPreferenceStorage());
  // Restating the element's own class-field default rather than leaving the
  // property alone, for the reason `ptk-live-screen` restates `deviceHaptics`
  // (§13.9): a lit-html property binding *assigns*, so the two spellings that
  // look equivalent are not, and the one that reads as "leave it at the
  // default" is the one that overwrites it with `undefined`. Written out here
  // it is also the line somebody sees when they ask what an embed persists.
  element.store = options.store ?? noMeetStore();

  /*
   * Which chart read is still wanted.
   *
   * A counter rather than an `AbortController` because aborting is not the
   * problem being solved -- a superseded read may finish, and its result is
   * simply not the answer to the question now on screen. Comparing the token
   * back is what makes a late arrival a no-op instead of the wrong federation's
   * pound column. It is a shared object rather than a captured `let` so that the
   * function below can read the *current* value at each await point rather than
   * the value it was passed.
   */
  const chartRead: ReadToken = { latest: 0 };

  element.addEventListener(FEDERATION_CHANGE_EVENT, (event) => {
    chartRead.latest += 1;
    // Cleared now rather than when the replacement lands. The element renders
    // published pounds beside every attempt, and between the tap and the
    // response there is no chart that belongs to the federation on screen.
    element.chart = null;
    void loadChart(element, source, event.detail.federationId, chartRead, chartRead.latest);
  });

  void loadProfiles(element, source);
  return element;
}

async function loadProfiles(element: PtkMeetDayPlanner, source: DataSource): Promise<void> {
  try {
    const book = await source.getMeetRuleProfiles();
    // `null` is "nothing published yet", which is an answer rather than a
    // failure: the element says so in its own words, and offers no reload,
    // because a reload cannot change it.
    element.profiles = book?.profiles ?? [];
    element.status = 'ready';
  } catch (caught) {
    element.status = 'failed';
    report('rule profiles', caught);
  }
}

interface ReadToken {
  latest: number;
}

/**
 * Reads one federation's chart, and drops the answer if it is no longer wanted.
 *
 * A refused chart leaves `chart` at `null`, which is the same screen as a
 * federation that publishes none -- and that is the honest answer, because
 * nothing the lifter can do changes it and §16 will not let the tool compute a
 * substitute. The problem codes go to the console for whoever maintains the
 * feed, which is who can act on it.
 */
async function loadChart(
  element: PtkMeetDayPlanner,
  source: DataSource,
  federationId: string,
  read: ReadToken,
  token: number,
): Promise<void> {
  try {
    const data = await source.getConversionChart(federationId);
    if (token !== read.latest) return;
    if (data === null) return;

    const result = ConversionChart.from(data);
    if (!result.ok) {
      console.error(
        `The published conversion chart could not be used: ${result.problems
          .map((problem) => problem.code)
          .join(', ')}.`,
      );
      return;
    }

    element.chart = result.chart;
  } catch (caught) {
    if (token !== read.latest) return;
    report('conversion chart', caught);
  }
}

/**
 * Says on the console that a read failed, and says nothing else.
 *
 * The caught object is not passed through. `DataSourceError` carries no URL by
 * construction, but its `cause` is whatever the transport threw and a console
 * expands a cause chain -- which is where a request URL shows up. The reason
 * code is the part that helps and the only part that is safe to keep.
 */
function report(what: string, caught: unknown): void {
  const reason = caught instanceof DataSourceError ? caught.reason : 'unexpected';
  console.error(`The meet day planner could not load the ${what}: ${reason}.`);
}
