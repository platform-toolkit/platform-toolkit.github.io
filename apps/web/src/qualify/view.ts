// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { DataSourceError, type DataSource } from '@platform-toolkit/data-access';
import type { CategoryCatalog } from '@platform-toolkit/data-contracts';
import type { CalendarDay, CatalogVocabulary } from '@platform-toolkit/qualification-check';
import {
  ATHLETE_SEARCH_EVENT,
  QUALIFICATION_CHECK_TAG,
  STANDARDS_NEEDED_EVENT,
  defineQualificationCheck,
  type PtkQualificationCheck,
  type StandardsNeededDetail,
} from '@platform-toolkit/qualification-check/element';

import { systemClock, type Clock } from '../clock.js';
import { dataSource } from '../data-source.js';

/** Identifier for this tool, and what it calls itself in a height message. */
export const TOOL_ID = 'qualify';

export interface QualificationCheckViewOptions {
  /**
   * Whose categories, standards and meets to read. Required, for the reason
   * every other tool's is required: a default here is a federation named in
   * code, which reads as correct while one is published and is silently wrong
   * once two are. The page declares it -- see `../federation.ts`.
   */
  readonly federationId: string;

  /** Defaults to the site's configured source. Injected in tests. */
  readonly source?: DataSource;

  /**
   * Defaults to the device's clock. Injected in tests and by anything that
   * wants a fixed day.
   *
   * The tool needs the date for one thing only: whether a meet's entry window
   * is open, closing or shut. That is a caption on a published deadline rather
   * than a countdown, which is why nothing here calls `watch` -- see
   * {@link startToday}.
   */
  readonly clock?: Clock;
}

/**
 * Builds the tool and starts loading what it needs.
 *
 * The element is returned before any read finishes, showing the empty form, so
 * the page has something with a height immediately -- the embed route reports
 * that height to its parent, and a frame that starts at zero and then jumps is
 * worse than one that starts the size of a screen.
 *
 * This is the only file in the tool that knows a transport exists, and unlike
 * the other tools that is not merely a convention here: the element lives in
 * `@platform-toolkit/qualification-check`, which has no dependency on
 * `data-access` at all. A third-party consumer supplies these properties from
 * wherever its own data lives, and this file is the shell's answer to the same
 * question -- section 15's rule that the shell may do nothing a consumer cannot.
 *
 * No preference store is passed, and that is a decision rather than an
 * omission. Everything a reader types here is a competition result belonging to
 * a named person, and section 2.3 says imported athlete information is not
 * persisted by default. The sharpest version is the meet director looking up
 * somebody else: a remembered form would leave a third party's bodyweight and
 * lifts on a shared laptop, and the subject of that lookup consented to nothing
 * beyond their results being public.
 */
export function createQualificationCheckView(
  options: QualificationCheckViewOptions,
): PtkQualificationCheck {
  defineQualificationCheck();
  const element = document.createElement(QUALIFICATION_CHECK_TAG);
  const source = options.source ?? dataSource;

  startCatalog(element, source, options.federationId);
  startMeets(element, source);
  startAthleteMirror(element, source);
  watchForStandards(element, source, options.federationId);
  watchForAthleteSearch(element, source);
  startToday(element, options.clock ?? systemClock());

  return element;
}

/**
 * Reads the federation's vocabulary: what it calls its equipment categories,
 * weight classes and age divisions.
 *
 * Nothing on the registration form can be drawn without it. The element renders
 * its own "no vocabulary yet" state in the meantime rather than being held back,
 * because the result form above it needs none of this and a reader can be
 * typing their first meet while the catalogue is still in flight.
 */
function startCatalog(
  element: PtkQualificationCheck,
  source: DataSource,
  federationId: string,
): void {
  void (async (): Promise<void> => {
    try {
      const catalog = await source.getCategoryCatalog(federationId);
      // `null` is an answer, not a failure: nothing is published for this
      // federation yet. The element already draws that as a sentence.
      element.vocabulary = catalog === null ? null : vocabularyOf(catalog);
    } catch (caught) {
      reportFailure('category catalogue', caught);
    }
  })();
}

/**
 * The three lists the tool asks about, taken from the artifact that carries
 * seven.
 *
 * Narrower than the catalogue on purpose. The package is written against a
 * vocabulary rather than against this project's catalogue schema, so a consumer
 * with its own category source has three arrays to produce instead of a whole
 * artifact to imitate -- and the tool cannot quietly grow a dependency on a
 * field it was never given.
 *
 * The ladders are carried across still separated by sex, which is the one line
 * here worth reading twice. A weight class is proposed by *measurement* -- a
 * bodyweight against a published boundary -- and a measured proposal is one the
 * form is allowed to fill in without asking. Merge the ladders and a 115 kg
 * woman opens the screen already placed in a 125 kg class her federation does
 * not offer her. `weightClassesFor` in the package is the only reader, and it
 * answers with an empty ladder until the sex is known.
 *
 * The divisions come out of `ageDivisions.divisions` rather than off the top of
 * the catalogue: the artifact wraps them in a set that also names the *basis*
 * the federation ages a lifter on, which is a fact about the whole set and not
 * about any one division in it.
 */
function vocabularyOf(catalog: CategoryCatalog): CatalogVocabulary {
  return {
    equipment: catalog.equipment,
    weightClassLadders: catalog.weightClassLadders,
    divisions: catalog.ageDivisions.divisions,
  };
}

/**
 * Reads the meets whose entry criteria have been ingested.
 *
 * One artifact for every federation rather than one per federation, because a
 * lifter shopping for a qualifier is not shopping within a federation -- the
 * question "what can I get into" spans them, and the book carries each meet's
 * own federation with it.
 *
 * A failure leaves the property `null`, which is also what "nobody has ingested
 * a meet yet" looks like. Those two really are the same screen here: the tool's
 * third and most important path is the one where no meet is chosen at all (a
 * standing read against a window), and that path works with an empty book. A
 * failure notice over a picker nobody needs to touch would be the tool
 * reporting its own plumbing to somebody who came to check a total.
 */
function startMeets(element: PtkQualificationCheck, source: DataSource): void {
  void (async (): Promise<void> => {
    try {
      element.book = await source.getQualifyingMeets();
    } catch (caught) {
      reportFailure('qualifying meets', caught);
    }
  })();
}

/**
 * Asks whether there is an athlete archive to search at all.
 *
 * `null` is the answer in production today and will be until root section 9's
 * mirror gate is opened, which is a decision about publishing 217 MB and not a
 * decision this file gets to make. The element renders no search box for a
 * `null` mirror, so the whole import path simply is not on the page — which is
 * the right shape for a feature whose data may or may not exist, and the reason
 * nothing here reports its absence.
 *
 * A failure is swallowed into the same `null` for that reason, and the element's
 * own documentation says so. "The archive index could not be fetched" is a
 * sentence about this deployment's plumbing, and putting it over a search box
 * that would not have worked anyway tells a lifter checking a total something
 * they can do nothing with.
 */
function startAthleteMirror(element: PtkQualificationCheck, source: DataSource): void {
  void (async (): Promise<void> => {
    try {
      element.mirror = await source.getAthleteMirror();
    } catch (caught) {
      reportFailure('athlete archive', caught);
    }
  })();
}

/**
 * Fetches a partition of the classification standards whenever the tool says it
 * needs one.
 *
 * Standards are published one artifact per (sex, equipment) pair and the tool
 * only knows which pair once the reader has answered those two questions, so
 * this read cannot be started with the others. The element asks by event rather
 * than being told, which is what keeps the decision about *which* partition in
 * the one place that knows the answers.
 */
function watchForStandards(
  element: PtkQualificationCheck,
  source: DataSource,
  federationId: string,
): void {
  let inFlight: AbortController | null = null;

  element.addEventListener(STANDARDS_NEEDED_EVENT, (event) => {
    // The previous read is abandoned rather than awaited. Two partitions in
    // flight can settle out of order, and the loser would overwrite the report
    // with standards for the category the reader just left -- a plausible table
    // for the wrong equipment, which is the failure this screen exists to stop.
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    element.standardsStatus = 'loading';
    void loadStandards(element, source, federationId, event.detail, controller.signal);
  });
}

async function loadStandards(
  element: PtkQualificationCheck,
  source: DataSource,
  federationId: string,
  partition: StandardsNeededDetail,
  signal: AbortSignal,
): Promise<void> {
  try {
    const book = await source.getClassifications(
      { federationId, sex: partition.sex, equipmentId: partition.equipmentId },
      { signal },
    );
    if (signal.aborted) {
      return;
    }
    // `null` is an answer here too, and the empty list is how it is spelled: the
    // report renders "no published standards for this category", which is a true
    // thing about eleven quarantined rows and about every category a federation
    // simply does not grade. Leaving the previous partition's tables in place
    // would grade the lifter against the category they just left.
    element.tables = book?.tables ?? [];
    element.standardsStatus = 'ready';
  } catch (caught) {
    if (signal.aborted) {
      // The reader changed category mid-read. Reporting it would put a failure
      // on screen for a request nobody is waiting on any more.
      return;
    }
    element.standardsStatus = 'failed';
    reportFailure('classification standards', caught);
  }
}

/**
 * Searches the archive whenever the import panel asks it to.
 *
 * The term reaches this file and goes no further than the seam. It is not
 * logged, not stamped into a URL, not put in an error payload, and not kept
 * after the read settles — section 2.3, sharpened by the case the brief names: a
 * meet director looking up a third party is searching for somebody who is not in
 * the room and who agreed to none of this.
 *
 * The seam is what makes that more than a promise. `findAthletes` folds the name
 * into a lookup key *in the browser*, derives a bucket number from it, and
 * fetches the shard for that bucket — so what leaves the tab is an integer, and
 * the name never appears in a request at all. That property lives in
 * `static-data-source.ts` and this file must not undo it: do not add a query
 * parameter, and do not "improve" this into a search endpoint.
 */
function watchForAthleteSearch(element: PtkQualificationCheck, source: DataSource): void {
  let inFlight: AbortController | null = null;

  element.addEventListener(ATHLETE_SEARCH_EVENT, (event) => {
    // Abandoned rather than awaited, the same way a standards partition is, and
    // with a worse failure if it were not: two searches settling out of order
    // put the *first* name's namesakes under the second name's heading, and
    // every one of them is a real person whose results are about to be read as
    // somebody else's.
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    element.lookupStatus = 'searching';
    void lookUpAthletes(element, source, event.detail.term, controller.signal);
  });
}

async function lookUpAthletes(
  element: PtkQualificationCheck,
  source: DataSource,
  term: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    const lookup = await source.findAthletes(term, { signal });
    if (signal.aborted) {
      return;
    }
    element.lookup = lookup;
    element.lookupStatus = 'idle';
  } catch (caught) {
    if (signal.aborted) {
      // Superseded by a later search. The reader is waiting on that one.
      return;
    }
    element.lookupStatus = 'failed';
    reportFailure('athlete archive', caught);
  }
}

/**
 * Tells the tool what day it is, and tells it again when the tab comes back.
 *
 * Read once and passed down as a property, never read during a render. A render
 * that asked the clock could straddle midnight and caption two halves of the
 * same screen from two different days.
 *
 * `watch` is deliberately not used. It wakes four times a second, which is right
 * for a declaration countdown and absurd for a boundary that moves once a day --
 * and the only thing this date decides is whether an entry window is open,
 * closing soon or shut. What it *does* need is the case `watch` exists for:
 * a phone in a pocket overnight, opened in the morning still showing yesterday,
 * captioning a deadline that has since passed as "closes tomorrow". Recomputing
 * when the tab becomes visible covers that at the cost of one listener, and
 * assigning the same string to a Lit property is a no-op, so the days it finds
 * nothing changed cost a string comparison.
 *
 * The listener is never removed, for the reason the other tools give: it holds
 * one closure over one element for the lifetime of the page, and tying it to the
 * element being connected would stop the date updating while a host page moved
 * the frame's contents around in the DOM.
 */
function startToday(element: PtkQualificationCheck, clock: Clock): void {
  const refresh = (): void => {
    element.today = localDayOf(clock.now());
  };

  refresh();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refresh();
    }
  });
}

/**
 * The reader's own calendar day, as `YYYY-MM-DD`.
 *
 * Built from the local fields and never from `toISOString`, which is the same
 * hazard section 5.5 names from the other side: an instant is a point on the
 * globe and a calendar day is not. At ten at night in California `toISOString`
 * already says tomorrow, so a lifter checking a qualifier the evening before the
 * deadline would be told entry had closed. West of Greenwich the error is a day
 * in one direction and east of it a day in the other, and both of them land on
 * exactly the reader who is closest to the deadline and least able to absorb
 * being wrong about it.
 */
function localDayOf(now: number): CalendarDay {
  const when = new Date(now);
  const month = String(when.getMonth() + 1).padStart(2, '0');
  const day = String(when.getDate()).padStart(2, '0');
  return `${String(when.getFullYear())}-${month}-${day}`;
}

/**
 * Says on the console that a read failed, and says nothing else.
 *
 * The error object is not passed through. A `DataSourceError` carries no URL by
 * construction, but its `cause` is whatever the transport threw, and a console
 * expands a cause chain -- which is where a request URL would show up. That
 * matters more here than anywhere else in the collection: this is the tool whose
 * reads sit beside a named person's competition history, and section 2.3 draws
 * the line at logging identity. The reason code is the part that helps and the
 * only part that is safe to keep.
 */
function reportFailure(what: string, caught: unknown): void {
  const reason = caught instanceof DataSourceError ? caught.reason : 'unexpected';
  console.error(`Qualification Check could not load the ${what}: ${reason}.`);
}
