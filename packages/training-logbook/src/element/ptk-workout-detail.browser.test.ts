// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One finished workout, opened and read, in a real browser.
 *
 * Mounted on its own, like the history list next door and for the same reason: nothing
 * on this screen is a conversation between elements. It is handed a session and draws
 * it, and there is not a control on it to press.
 *
 * WHAT THIS FILE IS GUARDING
 *
 * A read-only screen fails quietly. Every wrong version of it still renders a page full
 * of plausible numbers, and the only way to notice is to know what the session actually
 * held. So the fixture here is built by hand, one set at a time, with a different number
 * on every row -- a screen that drew row one three times, or drew `planned` where it
 * meant `performed`, cannot pass a case that names all three.
 *
 * The other half is what must *not* be on it. Section 15.3 rules out the tool having an
 * opinion, and the vocabulary case at the bottom is the same walk the root's suite does,
 * pointed at the one screen whose whole job is looking back at work already done.
 *
 * Every weight, rep count, day and duration below is invented (section 5.1).
 */

// Without the stylesheet every declaration reading a custom property is dropped, and the
// accessibility pass measures a screen that never ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type {
  CalendarDay,
  Instant,
  LogbookId,
  SetKind,
  SetPerformance,
  SetStatus,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
  WorkoutStatus,
} from '../types.js';

import { DETAIL_NOTES, HISTORY_NOTES, SET_KINDS, SET_STATUSES, WORKOUT_STATUSES } from './copy.js';
import { defineTrainingLogbook } from './index.js';
import type { PtkWorkoutDetail } from './ptk-workout-detail.js';

/** An invented day, and not today's. */
const A_DAY: CalendarDay = '2026-03-08';

/** Invented instants forty minutes apart. */
const BEGAN: Instant = '2026-03-08T16:00:00.000Z';
const ENDED: Instant = '2026-03-08T16:40:00.000Z';
const FORTY_MINUTES_READS = '40 min';

const teardown: (() => void)[] = [];

beforeAll(() => {
  defineTrainingLogbook();
});

afterEach(() => {
  for (const dispose of teardown.splice(0).reverse()) dispose();
});

/** A barbell load at an invented weight. */
function at(amount: number): SetPerformance['load'] {
  return { kind: 'implement', weight: { amount, unit: 'kg' } };
}

interface SetOptions {
  readonly kind?: SetKind;
  readonly status?: SetStatus;
  readonly planned?: SetPerformance | null;
  readonly performed?: SetPerformance | null;
  readonly note?: string | null;
}

function aSet(id: LogbookId, options: SetOptions = {}): WorkoutSet {
  return {
    id,
    kind: options.kind ?? 'working',
    // Not `??`: `null` is one of the cases on both fields, and the nullish default
    // would quietly replace it with the very thing the case is about.
    planned:
      options.planned === undefined
        ? { load: at(100), repetitions: 5, effort: null }
        : options.planned,
    performed:
      options.performed === undefined
        ? { load: at(100), repetitions: 5, effort: null }
        : options.performed,
    status: options.status ?? 'complete',
    completedAt: null,
    note: options.note ?? null,
  };
}

function aLift(
  id: LogbookId,
  displayName: string,
  sets: readonly WorkoutSet[],
  note: string | null = null,
): WorkoutExercise {
  return {
    id,
    exerciseId: `catalogue-${id}`,
    displayName,
    loading: 'barbell-total-weight',
    warmup: null,
    note,
    sets,
  };
}

interface SessionOptions {
  readonly title?: string | null;
  readonly note?: string | null;
  readonly status?: WorkoutStatus;
  readonly startedAt?: Instant | null;
  readonly completedAt?: Instant | null;
  readonly exercises?: readonly WorkoutExercise[];
}

function aSession(options: SessionOptions = {}): WorkoutSession {
  return {
    id: 'past-a',
    schemaVersion: 1,
    status: options.status ?? 'completed',
    localDate: A_DAY,
    startedAt: options.startedAt === undefined ? BEGAN : options.startedAt,
    completedAt: options.completedAt === undefined ? ENDED : options.completedAt,
    title: options.title === undefined ? 'Squat day' : options.title,
    note: options.note ?? null,
    exercises: options.exercises ?? [aLift('lift-a', 'Squat', [aSet('set-a')])],
    createdAt: BEGAN,
    updatedAt: ENDED,
    source: 'manual',
  };
}

/**
 * A squat with three different sets on it, plus a bench press.
 *
 * Three weights, three rep counts, three kinds: a warm-up, a working set edited down
 * from what it was written as, and one that was skipped. No two rows share a number, so
 * a template that reused one row's data for another has nowhere to hide.
 */
function aFullSession(): WorkoutSession {
  return aSession({
    note: 'Back felt fine today.',
    exercises: [
      aLift(
        'lift-a',
        'Squat',
        [
          aSet('set-warmup', {
            kind: 'warmup',
            planned: { load: at(60), repetitions: 8, effort: null },
            performed: { load: at(60), repetitions: 8, effort: null },
          }),
          aSet('set-edited', {
            planned: { load: at(100), repetitions: 5, effort: null },
            performed: { load: at(95), repetitions: 4, effort: { scale: 'rpe', value: 9 } },
            note: 'Cut it short.',
          }),
          aSet('set-skipped', {
            status: 'skipped',
            planned: { load: at(100), repetitions: 5, effort: null },
            performed: null,
          }),
        ],
        'Belt on from the second set.',
      ),
      aLift('lift-b', 'Bench press', [
        aSet('set-bench', {
          planned: { load: at(70), repetitions: 6, effort: null },
          performed: { load: at(70), repetitions: 6, effort: null },
        }),
      ]),
    ],
  });
}

async function mount(session: WorkoutSession | null): Promise<PtkWorkoutDetail> {
  const element = document.createElement('ptk-workout-detail');
  element.session = session;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function shadow(element: Element): ShadowRoot {
  const root = element.shadowRoot;
  if (root === null) throw new Error(`<${element.localName}> has not rendered.`);
  return root;
}

/** Everything the screen says, at any shadow depth. */
function readAll(element: Element): string {
  const parts: string[] = [];
  const visit = (root: DocumentFragment | HTMLElement): void => {
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot !== null) visit(node.shadowRoot);
    }
    parts.push(root.textContent);
  };
  visit(shadow(element));
  return parts.join(' ');
}

/** One set's row, by its identifier and never by position. */
function setRow(element: PtkWorkoutDetail, id: LogbookId): HTMLElement {
  const found = shadow(element).querySelector(`li[data-set="${id}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`No set "${id}" is on this screen.`);
  return found;
}

function liftRow(element: PtkWorkoutDetail, id: LogbookId): HTMLElement {
  const found = shadow(element).querySelector(`li[data-exercise="${id}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`No exercise "${id}" is on this screen.`);
  return found;
}

describe('the workout it was handed', () => {
  it('heads the screen with what the session was called, and when it was', async () => {
    const element = await mount(aFullSession());

    const heading = shadow(element).querySelector('h2');
    expect(heading?.textContent.trim()).toBe('Squat day');
    // The stored string, printed as stored. Handing it to `Date` for something
    // prettier prints the day before to every lifter west of Greenwich.
    expect(readAll(element)).toContain(A_DAY);
    expect(readAll(element)).toContain(WORKOUT_STATUSES.completed);
  });

  it('falls back to a word rather than an empty heading on an unnamed session', async () => {
    // Most sessions have no title. A blank `h2` is not a heading, and a screen
    // reader landing on it has been given nothing to land on.
    const element = await mount(aSession({ title: null }));

    expect(shadow(element).querySelector('h2')?.textContent.trim()).toBe(DETAIL_NOTES.heading);
  });

  it('counts the working sets and says how long it took', async () => {
    // Two working sets in the fixture -- the edited squat and the bench -- because
    // the warm-up and the skipped set are both excluded, by different rules.
    const element = await mount(aFullSession());

    expect(readAll(element)).toContain(`2 ${HISTORY_NOTES.setsLabel}`);
    expect(readAll(element)).toContain(FORTY_MINUTES_READS);
  });

  it('says nothing about duration where the session was never finished', async () => {
    // Paired with the case above: a screen that always drew a duration would pass
    // that one and print "0 min" over a workout somebody walked away from.
    const element = await mount(aSession({ status: 'active', completedAt: null }));

    expect(readAll(element)).not.toContain('min');
    expect(readAll(element)).toContain(WORKOUT_STATUSES.active);
  });

  it('draws every lift it was given, in the order they were done', async () => {
    const element = await mount(aFullSession());

    const lifts = [...shadow(element).querySelectorAll('li[data-exercise]')];
    expect(lifts.map((li) => li.getAttribute('data-exercise'))).toEqual(['lift-a', 'lift-b']);
    expect(liftRow(element, 'lift-a').querySelector('h3')?.textContent.trim()).toBe('Squat');
    expect(liftRow(element, 'lift-b').querySelector('h3')?.textContent.trim()).toBe('Bench press');
  });
});

describe('a set on the screen', () => {
  it('draws what was done, not what was planned, when the two differ', async () => {
    // The whole reason to open a workout. A screen reading `planned` shows the
    // session somebody intended to have, which on an edited set is the one number
    // they came here to check against.
    const element = await mount(aFullSession());

    const row = setRow(element, 'set-edited').textContent;
    expect(row).toContain('95 kg');
    expect(row).toContain('4');
    expect(row).toContain(SET_STATUSES.complete);
  });

  it('says what was planned underneath, where the set was edited', async () => {
    const element = await mount(aFullSession());

    expect(setRow(element, 'set-edited').textContent).toContain(
      `${DETAIL_NOTES.plannedLabel} 100 kg`,
    );
  });

  it('leaves the planned line off a set that went as written', async () => {
    // Paired with the case above, because a row that always drew it would say every
    // set in the history departed from its plan.
    const element = await mount(aFullSession());

    expect(setRow(element, 'set-bench').textContent).not.toContain(DETAIL_NOTES.plannedLabel);
  });

  it('falls back to the plan on a set nobody got to', async () => {
    // A skipped set has no `performed` at all, and a blank row says less than the
    // numbers it was written down with. The status beside it is what keeps that
    // honest -- "Skipped" next to 100 kg is not a claim that 100 kg was lifted.
    const element = await mount(aFullSession());

    const row = setRow(element, 'set-skipped').textContent;
    expect(row).toContain('100 kg');
    expect(row).toContain(SET_STATUSES.skipped);
    expect(row).not.toContain(DETAIL_NOTES.plannedLabel);
  });

  it('marks a warm-up as one, so it is not read as work', async () => {
    const element = await mount(aFullSession());

    expect(setRow(element, 'set-warmup').textContent).toContain(SET_KINDS.warmup);
    expect(setRow(element, 'set-warmup').dataset['kind']).toBe('warmup');
    expect(setRow(element, 'set-edited').dataset['kind']).toBe('working');
  });

  it('prints an effort on the scale it was recorded on', async () => {
    // Section 7.10, and it is the one number on this screen that could be relabelled
    // by a setting somewhere: an RPE 9 reprinted as RIR 9 means nearly the opposite.
    const element = await mount(aFullSession());

    expect(setRow(element, 'set-edited').textContent).toContain('RPE 9');
    expect(setRow(element, 'set-bench').textContent).not.toContain('RPE');
  });
});

describe('what the lifter wrote', () => {
  it('shows the note on the session, the lift and the set', async () => {
    // Three levels, one case, because a template that rendered only the one it was
    // written for would lose the other two silently -- and a note is the part of a
    // logbook nothing else can reconstruct.
    const element = await mount(aFullSession());

    expect(readAll(element)).toContain('Back felt fine today.');
    expect(liftRow(element, 'lift-a').textContent).toContain('Belt on from the second set.');
    expect(setRow(element, 'set-edited').textContent).toContain('Cut it short.');
  });

  it('leaves no empty paragraph where nothing was written', async () => {
    const element = await mount(aSession());

    expect(shadow(element).querySelectorAll('p.written')).toHaveLength(0);
  });
});

describe('the two screens with nothing on them', () => {
  it('says a workout is empty rather than showing a heading over nothing', async () => {
    // Reachable: a session started and abandoned before a lift was added is still a
    // row in the history, and a heading over blank space reads as a failed read.
    const element = await mount(aSession({ exercises: [] }));

    expect(readAll(element)).toContain(DETAIL_NOTES.empty);
  });

  it('says a workout could not be read, and does not pretend it was empty', async () => {
    // `null` is the root's answer to both a missing row and a database that would
    // not open, and the two say the same thing because a lifter can act on neither.
    // It must not read as "you did nothing that day".
    const element = await mount(null);

    expect(readAll(element)).toContain(DETAIL_NOTES.unreadable);
    expect(readAll(element)).not.toContain(DETAIL_NOTES.empty);
  });

  it('clears the last workout off the screen when the session goes away', async () => {
    // The root reuses one element across opens. A failed second read that left the
    // first workout on screen would show last week's numbers under this week's date.
    const element = await mount(aFullSession());
    expect(readAll(element)).toContain('Squat');

    element.session = null;
    await element.updateComplete;

    expect(readAll(element)).not.toContain('Squat');
    expect(readAll(element)).toContain(DETAIL_NOTES.unreadable);
  });
});

describe('what it refuses to say', () => {
  it('has no opinion about the work it is showing', async () => {
    // Section 15.3, on the one screen where the temptation lives: this is a page of
    // finished numbers, and every one of these words is a sentence away.
    const element = await mount(aFullSession());
    const said = readAll(element).toLowerCase();

    for (const forbidden of [
      'personal best',
      'great',
      'good',
      'easy',
      'hard',
      'ahead',
      'behind',
      'on track',
      'missed',
      'failed',
    ]) {
      expect(said).not.toContain(forbidden);
    }
  });

  it('offers nothing to press', async () => {
    // Section 0.4: no dead controls. Editing a finished session is its own sub-task,
    // and until it lands there is nothing on this screen a thumb can do.
    const element = await mount(aFullSession());

    expect(shadow(element).querySelectorAll('button, ptk-button, a')).toHaveLength(0);
  });
});

describe('accessibility', () => {
  it('has no violations with a whole workout on screen', async () => {
    // `color-contrast` is off for the same reason as everywhere else: it depends on
    // the page background this element does not control.
    const element = await mount(aFullSession());

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('has no violations on the unreadable screen', async () => {
    const element = await mount(null);

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
