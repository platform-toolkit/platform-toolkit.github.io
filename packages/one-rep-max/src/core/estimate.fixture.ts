// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Described sets, and the domain's real answer for each.
 *
 * Every story and every browser test in this tool needs an `OneRepMaxEstimate`,
 * and there are exactly two ways to get one: hand-write the object, or describe
 * a set and let `estimateOneRepMax` answer. Hand-writing looks cheaper and is
 * the worse of the two -- twenty formula outcomes, five disagreement figures and
 * a grade all have to agree with each other, and a fixture whose grade does not
 * follow from its advisories is a screenshot of a state the tool cannot produce.
 * Worse, it keeps rendering after a rule changes, so the story that exists to
 * show the new behaviour is the one place it never appears.
 *
 * So the sets below are invented and the numbers are not. `describedSet` builds
 * an entry through the same mappers the tool uses, and `estimateFor` pushes it
 * through `requestFor` and the domain.
 *
 * Nothing that ships may import this file.
 */
import {
  estimateOneRepMax,
  type OneRepMaxEstimate,
  type OneRepMaxProblem,
  type Weight,
} from '@platform-toolkit/domain';

import { EMPTY_ENTRY, requestFor, setLift, typeReps, typeWeight } from './session.js';
import type { EstimateEntry } from '../types.js';

/**
 * A set somebody could have done, with anything about it replaced.
 *
 * 142.5 kg for five is the default because it is unremarkable in every way that
 * matters here: mid-range for the equations, a loadable figure on a real bar,
 * and far enough from the twenty-rep ceiling that a story changing the count
 * does not accidentally change the outcome's kind as well.
 *
 * `lift` is routed through `setLift` rather than spread, because a technique
 * identifier is unique within a lift and not across lifts: `{ lift: 'deadlift' }`
 * on its own leaves the squat's standard behind it, and the domain refuses that
 * request outright. Spreading it would make every caller that changes the lift
 * remember to change the standard too, and the one that forgot would fail as a
 * thrown fixture rather than as the state it meant to show.
 */
export function describedSet(overrides: Partial<EstimateEntry> = {}): EstimateEntry {
  const base = typeReps(typeWeight(EMPTY_ENTRY, '142.5'), '5');
  const { lift, ...rest } = overrides;
  return { ...(lift === undefined ? base : setLift(base, lift)), ...rest };
}

/**
 * The fields a typed weight sets, for a caller that wants a different one.
 *
 * Four of them move together -- the text, the drift-free origin behind it, the
 * unit a suffix may have changed, and the rounding step that follows the unit --
 * and a caller writing `{ weightText: '315 lb' }` by hand would set the first
 * and leave the tool estimating from 142.5 kg under a field reading 315 lb.
 */
export function weighing(text: string): Partial<EstimateEntry> {
  const { weightText, weight, unit, roundTo } = typeWeight(EMPTY_ENTRY, text);
  return { weightText, weight, unit, roundTo };
}

/**
 * The domain's answer for that set.
 *
 * Throws rather than returning null on a set the domain refuses, because every
 * caller here has already decided which of the three kinds it is showing. A
 * fixture that quietly answered `null` would render the empty state under a
 * story titled for a grade, and the failure would be a screenshot nobody reads
 * twice.
 */
export function estimateFor(overrides: Partial<EstimateEntry> = {}): OneRepMaxEstimate {
  const request = requestFor(describedSet(overrides));
  if (request === null) throw new Error('The fixture set has no weight or no repetition count.');
  const result = estimateOneRepMax(request);
  if (!result.ok) {
    throw new Error(
      `The fixture set was refused: ${result.problems.map((p) => p.code).join(', ')}`,
    );
  }
  return result.estimate;
}

/**
 * Just the middle figure, for the two elements that are handed a number.
 *
 * `estimateFor` answers the whole union, and only one of its three members has a
 * middle figure at all -- a single was observed, and a withheld set has nothing.
 * A caller reaching straight for `.toolkit` therefore does not compile, and the
 * obvious way out is a cast, which would keep compiling the day a fixture's
 * outcome changed kind and hand `undefined` to an element that renders it as
 * `NaN kg`. Narrowing here throws instead, naming the kind that arrived.
 */
export function toolkitFigureFor(overrides: Partial<EstimateEntry> = {}): Weight {
  const estimate = estimateFor(overrides);
  if (estimate.kind !== 'estimated') {
    throw new Error(`The fixture set was ${estimate.kind}, so it has no middle figure.`);
  }
  return estimate.toolkit;
}

/**
 * The domain's refusal for a set it will not read, the mirror of `estimateFor`.
 *
 * Also throws on the wrong outcome, and for the same reason: a set that quietly
 * started answering would leave the error panel rendering an empty list under a
 * heading saying the set cannot be read, which is a state the tool has no way to
 * reach and nobody would recognise as a regression.
 */
export function problemsFor(overrides: Partial<EstimateEntry>): readonly OneRepMaxProblem[] {
  const request = requestFor(describedSet(overrides));
  if (request === null) throw new Error('The fixture set has no weight or no repetition count.');
  const result = estimateOneRepMax(request);
  if (result.ok) throw new Error('The fixture set was accepted, so there are no problems to show.');
  return result.problems;
}
