// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The sessions every story in this directory renders from.
 *
 * Built by the core, not typed out. A `WorkoutSession` written by hand is free to hold a
 * shape the core would never produce -- a set marked `complete` with no `completedAt`, a
 * workout `active` with no `startedAt`, a performed weight in a unit the plan was never
 * typed in -- and those are exactly the pages a reviewer would stop on, because they look
 * wrong and are meant to look right. Everything below goes through `createWorkout`,
 * `addExercise`, `startWorkout`, `completeSet` and `finishWorkout`, so a change to any of
 * them moves the stories with it rather than leaving them describing a tool that no
 * longer exists.
 *
 * Excluded from the package build by the `*.fixture.ts` pattern in `tsconfig.json`, so
 * nothing a consumer installs carries any of it.
 *
 * Every weight here is invented (section 5.1). A logbook has no federation figures in it
 * at all, which makes this the easiest file in the collection to keep honest, but the
 * numbers are still chosen rather than copied: 100 and 70 kilograms because they are
 * round, distinguishable from each other, and distinguishable from a rep count.
 */

import type { Weight } from '@platform-toolkit/domain';

import { findExercise, loadFor } from '../core/catalog.js';
import { AT_LATER, AT_START, ON_DAY } from '../core/context.fixture.js';
import {
  addExercise,
  completeSet,
  createWorkout,
  finishWorkout,
  performance,
  startWorkout,
  type PlannedSet,
  type SessionContext,
} from '../core/session.js';
import { summarize, type WorkoutSummary } from '../core/summary.js';
import { memoryLogbookStore } from '../storage/memory.js';
import type { LogbookStore } from '../storage/port.js';
import { createRepository, type TrainingLogbookRepository } from '../storage/repository.js';
import type {
  CalendarDay,
  EquipmentSnapshot,
  ExerciseOption,
  Instant,
  LogbookId,
  WorkoutSession,
} from '../types.js';

export { AT_LATER, AT_START };

/** The day these sessions were trained on. A literal, never the clock. */
export const A_TRAINING_DAY: CalendarDay = ON_DAY;

/** An invented squat weight. */
const SQUAT_WEIGHT: Weight = { amount: 100, unit: 'kg' };

/** An invented bench weight, deliberately not the squat's. */
const BENCH_WEIGHT: Weight = { amount: 70, unit: 'kg' };

/**
 * A counter like `contextSeries`, but stamping a prefix onto every identifier.
 *
 * The core fixture's plain `id-1` is right for a test, which builds one session and
 * asserts on it. Here the history list renders three finished sessions side by side and a
 * repeated identifier is a repeated list key -- Lit would reuse one row's DOM for
 * another's data, and the symptom is a story that looks correct until something in it
 * changes. Prefixing costs nothing and makes that impossible.
 */
function series(prefix: string): (at: Instant) => SessionContext {
  let next = 0;
  const nextId = (): LogbookId => {
    next += 1;
    return `${prefix}-${String(next)}`;
  };
  return (at: Instant): SessionContext => ({ nextId, at });
}

/** A catalogue exercise, or a loud failure. A story cannot render half a fixture. */
function catalogExercise(id: string): ExerciseOption {
  const found = findExercise(id);
  if (found === null) throw new Error(`no such catalogue exercise: ${id}`);
  return found;
}

const SQUAT = catalogExercise('squat');
const BENCH_PRESS = catalogExercise('bench-press');
const CHIN_UP = catalogExercise('chin-up');

/** The plan for one exercise: the same set, written out as many times as it is done. */
function plan(
  exercise: ExerciseOption,
  count: number,
  reps: number,
  weight: Weight | null,
): readonly PlannedSet[] {
  return Array.from({ length: count }, () => ({
    kind: 'working' as const,
    performance: performance(loadFor(exercise.loading, weight), reps),
  }));
}

interface SessionOptions {
  /** How many of the squat's sets are already ticked off. */
  readonly completed?: number;
  readonly prefix?: string;
}

/**
 * A squat and a bench press, started, with the first sets optionally already done.
 *
 * Two exercises rather than one, because almost every layout question on the logging
 * screen -- where the progress line sits, how the second heading reads under the first
 * exercise's last set -- is invisible with a single exercise on the page.
 */
export function aStartedSession(options: SessionOptions = {}): WorkoutSession {
  const at = series(options.prefix ?? 'story');
  let session = createWorkout(at(AT_START), {
    localDate: A_TRAINING_DAY,
    title: 'Squat day',
  });
  session = addExercise(session, at(AT_START), {
    exerciseId: SQUAT.id,
    displayName: SQUAT.name,
    loading: SQUAT.loading,
    plan: plan(SQUAT, 3, 5, SQUAT_WEIGHT),
  });
  session = addExercise(session, at(AT_START), {
    exerciseId: BENCH_PRESS.id,
    displayName: BENCH_PRESS.name,
    loading: BENCH_PRESS.loading,
    plan: plan(BENCH_PRESS, 3, 5, BENCH_WEIGHT),
  });
  session = startWorkout(session, at(AT_START));

  const squat = session.exercises[0];
  if (squat === undefined) throw new Error('the fixture lost its first exercise');
  for (const set of squat.sets.slice(0, options.completed ?? 0)) {
    session = completeSet(session, set.id, at(AT_LATER));
  }
  return session;
}

/**
 * The same session with everything ticked, finished twenty minutes after it began.
 *
 * `'leave'` rather than `'skip'`, because there is nothing outstanding to dispose of and
 * the two dispositions are only distinguishable on a session that has work left in it.
 */
export function aFinishedSession(prefix = 'done'): WorkoutSession {
  const started = aStartedSession({ completed: 3, prefix });
  const bench = started.exercises[1];
  if (bench === undefined) throw new Error('the fixture lost its second exercise');
  const at = series(`${prefix}-finish`);
  let session = started;
  for (const set of bench.sets) {
    session = completeSet(session, set.id, at(AT_LATER));
  }
  return finishWorkout(session, 'leave', at(AT_LATER));
}

/**
 * Chin-ups, which record a rep count and no weight at all.
 *
 * Worth a story of its own on both screens. Section 6.2's four loading models are the one
 * part of this tool where a rendering mistake is silent: a set line that printed "Not
 * set" beside a bodyweight movement would be describing a missing weight that is not
 * missing, and nothing about the page would look broken.
 */
export function aBodyweightSession(): WorkoutSession {
  const at = series('bodyweight');
  let session = createWorkout(at(AT_START), { localDate: A_TRAINING_DAY, title: null });
  session = addExercise(session, at(AT_START), {
    exerciseId: CHIN_UP.id,
    displayName: CHIN_UP.name,
    loading: CHIN_UP.loading,
    plan: plan(CHIN_UP, 3, 8, null),
  });
  return startWorkout(session, at(AT_START));
}

/**
 * A well-stocked kilogram rack, for the stories that draw plates.
 *
 * An `EquipmentSnapshot` and not an `Equipment`, because a snapshot is what the logging
 * screen takes -- the editor's shape resolves a bar preset and a collar preset into
 * weights, and the reconstruction back the other way is lossy on purpose (see this
 * package's notes on `equipmentFrom`). A story that went through the editor's shape would
 * be documenting a conversion nothing on this screen performs.
 *
 * Every denomination is invented (section 5.1) in the sense that matters: these are plate
 * sizes, not a governing body's numbers, and they are picked so both story weights load
 * cleanly -- 100 kg is 40 a side as a 25 and a 15, and 70 kg is a single 25.
 */
export function aKilogramRack(): EquipmentSnapshot {
  return {
    barWeight: { amount: 20, unit: 'kg' },
    collarWeight: { amount: 0, unit: 'kg' },
    plateUnit: 'kg',
    plates: [
      { weight: 25, pairs: null, fullDiameter: true },
      { weight: 20, pairs: null, fullDiameter: true },
      { weight: 15, pairs: null, fullDiameter: true },
      { weight: 10, pairs: null, fullDiameter: false },
      { weight: 5, pairs: null, fullDiameter: false },
      { weight: 2.5, pairs: null, fullDiameter: false },
    ],
  };
}

/**
 * The same bar with only two plate sizes on it, which is the interesting rack.
 *
 * 100 kg still loads -- 40 a side is two 20s -- and 70 kg does not: 25 a side is not a sum
 * of 20s and 15s. So one story shows both halves of section 8.3 at once, a diagram above a
 * sentence, which is the arrangement a reviewer has to see to judge. Warning and not
 * refusing is the rule the sentence is there to make visible: the weight the lifter entered
 * stays exactly as they entered it.
 */
export function aSparseRack(): EquipmentSnapshot {
  return {
    barWeight: { amount: 20, unit: 'kg' },
    collarWeight: { amount: 0, unit: 'kg' },
    plateUnit: 'kg',
    plates: [
      { weight: 20, pairs: null, fullDiameter: true },
      { weight: 15, pairs: null, fullDiameter: true },
    ],
  };
}

/**
 * A short history, newest first, the way the repository hands it over.
 *
 * Three rather than one, because the row separator, the wrapping of a long exercise list
 * and the alignment of the dates are all properties of a list and not of a row.
 */
export const RECENT_WORKOUTS: readonly WorkoutSummary[] = [
  summarize(aFinishedSession('history-a')),
  summarize(aFinishedSession('history-b')),
  summarize(finishWorkout(aBodyweightSession(), 'skip', series('history-c')(AT_LATER))),
];

/**
 * A store that keeps the session for as long as the story is open, and says it is
 * durable.
 *
 * The plain memory store reports `durable: false`, which is honest -- it is a `Map` --
 * and which makes the root element render "Not saved on this device" and skip every
 * write. That is a real state and it has a story of its own below, but it is the wrong
 * default: a reviewer opening the tool would read the warning as the tool's normal
 * condition rather than as the one a private-browsing window produces.
 *
 * Nothing is being faked about persistence here. The story is not a claim about storage;
 * it is a claim about what the screen says when storage works, and IndexedDB in a
 * Storybook iframe would leak one story's session into the next.
 */
function storyStore(): LogbookStore {
  return { ...memoryLogbookStore(), durable: true };
}

/**
 * A repository over that store, with the clock pinned.
 *
 * `now` is a literal for the same reason the days are: a story that read the clock would
 * document a different screen every time it was opened, and the duration on the finished
 * screen would grow by a minute a minute.
 */
export function aRepository(store: LogbookStore = storyStore()): TrainingLogbookRepository {
  return createRepository(store, { now: () => AT_START, applicationVersion: '0.0.0-story' });
}

/** The one that tells the truth about a `Map`: no storage, and the tool saying so. */
export function anUnstoredRepository(): TrainingLogbookRepository {
  return aRepository(memoryLogbookStore());
}

/** What the root element needs to be a working tool, and nothing else. */
export interface StoryTool {
  readonly repository: TrainingLogbookRepository;
  /** Counting up rather than random, so a reviewer can trace `new-4` in the DOM. */
  readonly nextId: () => LogbookId;
}

/**
 * A tool with its own store, for one story.
 *
 * One per story and never one shared by the file. Storybook evaluates a `Meta`'s `args`
 * once for the whole module, so a single repository up there would be written to by every
 * play function in turn -- and the empty-logbook story would show the squat session left
 * behind by whichever story the reviewer happened to open before it. The bug only appears
 * when navigating between stories, which is the one thing a screenshot never does.
 */
export function aFreshTool(prefix = 'new'): StoryTool {
  const context = series(prefix)(AT_START);
  return { repository: aRepository(), nextId: () => context.nextId() };
}
