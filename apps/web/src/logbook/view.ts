// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { browserPreferenceStorage } from '@platform-toolkit/preferences';
import {
  LogbookStorageError,
  createRepository,
  createStoragePersistence,
  memoryLogbookStore,
  openLogbookStore,
  type LogbookStore,
  type StoragePersistence,
} from '@platform-toolkit/training-logbook/storage';
import {
  TRAINING_LOGBOOK_TAG,
  defineTrainingLogbook,
  type PtkTrainingLogbook,
} from '@platform-toolkit/training-logbook/element';
import {
  createHandoffSource,
  type HandoffSource,
} from '@platform-toolkit/training-logbook/handoff';

import { localCalendarDay, systemClock, type Clock } from '../clock.js';

/** Identifier for this tool, and what it calls itself in a height message. */
export const TOOL_ID = 'logbook';

export interface TrainingLogbookViewOptions {
  /**
   * Defaults to the device's clock. Injected in tests and by anything that wants
   * a fixed day.
   */
  readonly clock?: Clock;

  /**
   * Where the training is kept. Defaults to IndexedDB, or memory where the
   * browser will not give this page a database.
   *
   * A function rather than a store, because opening one is asynchronous and this
   * view has to return an element before it finishes -- see below.
   */
  readonly openStore?: () => Promise<LogbookStore>;

  /**
   * Where a session handed over by the warm-up calculator would be waiting.
   *
   * No default, unlike the two above, and the asymmetry is the point: the two
   * routes want different answers. `standalone.ts` supplies one, `embed.ts`
   * deliberately does not, and a default here would quietly give the framed copy
   * a reader for a key it can never see -- a third-party frame's storage is
   * partitioned away from the origin the calculator's own page writes to.
   */
  readonly handoff?: HandoffSource;

  /**
   * How the browser is asked to keep this origin's storage. Section 10.3.
   *
   * Undefined by default and supplied only by `standalone.ts`, the same asymmetry
   * the handoff has and for a closely related reason. Persistence is granted to a
   * top-level site, and a third-party frame's storage belongs to whoever embedded
   * it; a framed copy asking would be asking on behalf of a page it does not own,
   * collecting an answer it cannot act on, and printing it as though it were about
   * the lifter's own device.
   */
  readonly persistence?: StoragePersistence;

  /**
   * Set when the document already carries a visible heading naming this tool.
   *
   * The same asymmetry as the two above and the same shape of reason: the
   * standalone page draws an `<h1>Training Logbook</h1>` in its own header, and
   * the element draws a clipped one of its own so that a framed copy -- a
   * document whose entire body is this tool -- is not a page with no heading.
   * Both together is the outline saying it twice, and only the page entry knows
   * which route it is. Left out, the element keeps its heading, which is the
   * answer that is merely redundant rather than wrong.
   */
  readonly pageTitled?: boolean;
}

/**
 * The handoff reader over this device's own storage.
 *
 * `browserPreferenceStorage()` goes straight in with no adapter, because
 * `HandoffStorage` is the three methods it already has, and its `null` for an
 * origin that refuses access travels through unchanged -- a logbook that cannot
 * read storage simply never finds a record, which is correct, because a
 * calculator on that origin could not have written one either.
 *
 * Its own `systemClock()` rather than the view's, matching `browserLogbookHandoff`
 * on the writing side. The clock is read once, to ask how old a record is; sharing
 * one instance would buy nothing and would put a clock in the signature of the one
 * page entry that has no other use for it.
 */
export function browserHandoffSource(): HandoffSource {
  const clock = systemClock();
  return createHandoffSource(browserPreferenceStorage(), { now: () => clock.now() });
}

/**
 * The persistence port over this browser's storage manager.
 *
 * Handed over unguarded, which is deliberate: the DOM lib declares `navigator.storage`
 * as always present and it is `undefined` on an insecure origin -- every plain-HTTP
 * copy of this tool somebody runs off a laptop in a gym. A guard here would be a
 * condition this file's own compiler calls dead, so the factory takes `undefined` and
 * the reasoning lives in `persistence.ts` with it. Either way the element is handed a
 * port that knows nothing and draws no offer.
 */
export function browserStoragePersistence(): StoragePersistence {
  return createStoragePersistence(navigator.storage);
}

/**
 * Builds the tool and starts opening its database.
 *
 * The element is returned before the store answers, showing the home screen with
 * no storage line on it yet, so the page has something with a height
 * immediately. That blank is deliberate and it is the one piece of state in this
 * tool worth being slow about: the line says whether this browser is keeping the
 * lifter's training, and a screen that guessed "Saved on this device" while
 * IndexedDB was still deciding would be making section 18.9's promise before it
 * knew whether it could keep it.
 *
 * This is the only file in the tool that knows a database exists. The element
 * lives in `@platform-toolkit/training-logbook`, which constructs no storage at
 * all -- section 15's rule, and here it is load-bearing rather than tidy: a
 * package that opened IndexedDB itself would open it in a partitioned third-party
 * frame too, where the database exists, accepts writes and is thrown away when
 * the tab closes. The seam is what lets the shell find that out and say so.
 *
 * No `DataSource` and no preference store. Nothing on this screen is published
 * data -- there is no federation, no catalogue and no artifact to read -- and the
 * settings that would otherwise belong in `packages/preferences` are part of the
 * logbook's own document, because a backup that restored a year of training and
 * not the unit it was typed in would be a backup with a hole in it.
 *
 * The one thing that does reach `packages/preferences` is the *storage*, and not
 * the store: `browserHandoffSource` below borrows `browserPreferenceStorage()` to
 * read the key the warm-up calculator leaves a session under. That is a document
 * this tool validates like a backup file, not a setting, so it deliberately does
 * not go through a preference store -- see the package's `handoff.ts`.
 */
export function createTrainingLogbookView(
  options: TrainingLogbookViewOptions = {},
): PtkTrainingLogbook {
  defineTrainingLogbook();
  const element = document.createElement(TRAINING_LOGBOOK_TAG);
  const clock = options.clock ?? systemClock();

  element.now = () => new Date(clock.now()).toISOString();
  element.applicationVersion = __PTK_APPLICATION_VERSION__;
  element.handoff = options.handoff ?? null;
  element.persistence = options.persistence ?? null;
  element.pageTitled = options.pageTitled ?? false;

  startToday(element, clock);
  startStorage(element, clock, options.openStore ?? (() => openLogbookStore()));

  return element;
}

/**
 * Tells the tool what day it is, and tells it again when the tab comes back.
 *
 * Read once and passed down as a property, never read during a render. This tool
 * writes the day into a record that is kept: a render that asked the clock could
 * straddle midnight and file the second half of a session under tomorrow, which
 * is not a display fault that the next paint corrects -- it is a workout in the
 * wrong place in somebody's history, and there is no screen in Milestone 1 that
 * can move it back.
 *
 * `watch` is deliberately not used. It wakes four times a second, which is right
 * for a declaration countdown and absurd for a boundary that moves once a day.
 * What is worth a listener is the case `watch` exists for and this tool meets
 * more often than any other: a phone left in a bag overnight, opened in the
 * morning still holding yesterday, dating a session that has not happened yet.
 * Assigning the same string to a Lit property is a no-op, so the days it finds
 * nothing changed cost a string comparison.
 *
 * The listener is never removed, for the reason the other tools give: it holds
 * one closure over one element for the lifetime of the page, and tying it to the
 * element being connected would stop the date updating while a host page moved
 * the frame's contents around in the DOM.
 */
function startToday(element: PtkTrainingLogbook, clock: Clock): void {
  const refresh = (): void => {
    element.today = localCalendarDay(clock.now());
  };

  refresh();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refresh();
    }
  });
}

/**
 * Opens the database and hands the tool a repository over it.
 *
 * Setting the property is what starts the first read -- the element reloads on
 * the property rather than on first render, so a store that arrives three ticks
 * after upgrade is the ordinary case and not a race.
 *
 * The failure path lands on the same memory store the absent-database path does,
 * and the element then tells the lifter that this device is not keeping
 * anything. That is the whole answer here. There is nothing else honest to do
 * with a database that will not open: the tool works for this tab either way,
 * and the remedy -- download a backup before closing it -- is the same one the
 * screen already names.
 */
function startStorage(
  element: PtkTrainingLogbook,
  clock: Clock,
  open: () => Promise<LogbookStore>,
): void {
  void (async (): Promise<void> => {
    let store: LogbookStore;
    try {
      store = await open();
    } catch (caught) {
      reportFailure(caught);
      store = memoryLogbookStore();
    }
    element.repository = createRepository(store, {
      now: () => new Date(clock.now()).toISOString(),
      applicationVersion: __PTK_APPLICATION_VERSION__,
    });
  })();
}

/**
 * Says on the console why the database would not open, and says nothing else.
 *
 * The reason code and not the error. A `LogbookStorageError` carries a coarse
 * reason by construction, but its cause is whatever IndexedDB threw and a console
 * expands a cause chain -- and everything in this database is a named person's
 * training. Section 2.3 draws the line at logging identity; the reason is the
 * part that helps and the only part that is safe to keep.
 *
 * This is the developer's copy. The lifter's copy is on the screen, in a sentence
 * that tells them what to do about it, which is where a person between sets will
 * actually read it.
 */
function reportFailure(caught: unknown): void {
  const reason = caught instanceof LogbookStorageError ? caught.reason : 'unexpected';
  console.error(`Training Logbook could not open this device's storage: ${reason}.`);
}
