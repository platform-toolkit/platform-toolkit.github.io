// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  LogbookStorageError,
  createRepository,
  memoryLogbookStore,
  openLogbookStore,
  type LogbookStore,
} from '@platform-toolkit/training-logbook/storage';
import {
  TRAINING_LOGBOOK_TAG,
  defineTrainingLogbook,
  type PtkTrainingLogbook,
} from '@platform-toolkit/training-logbook/element';

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
 */
export function createTrainingLogbookView(
  options: TrainingLogbookViewOptions = {},
): PtkTrainingLogbook {
  defineTrainingLogbook();
  const element = document.createElement(TRAINING_LOGBOOK_TAG);
  const clock = options.clock ?? systemClock();

  element.now = () => new Date(clock.now()).toISOString();
  element.applicationVersion = __PTK_APPLICATION_VERSION__;

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
