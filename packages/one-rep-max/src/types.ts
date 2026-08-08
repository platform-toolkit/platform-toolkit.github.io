// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type {
  EnteredWeight,
  EstimateLift,
  FormQuality,
  ReportedSex,
  SetFreshness,
  TrainingExperience,
  WeightUnit,
} from '@platform-toolkit/domain';

/**
 * The vocabulary this tool answers in.
 *
 * One rule shapes it: **an estimate describes a set that was performed**, so
 * everything here is a description of that set rather than of a result. The
 * result -- the three figures, the grade, the twenty-two equations behind them
 * -- belongs to `@platform-toolkit/domain`, because a meet-day plan built on
 * this tool's answer has to read the same object the widget renders (§11).
 * What is here is what is being asked, and how a control's answer is spelled on
 * the way to the domain.
 */

/**
 * The reserve question's answers, in the order §5.2 fixes them.
 *
 * A string for every answer, including the numeric ones, because this is what a
 * radio group reports back and what a device stores -- both of which are
 * strings -- and because the domain's own `RepsInReserve` mixes numbers with
 * words. `reserveFrom` and `reserveChoiceOf` are the only crossings, and both
 * are total. A hand-built domain request carrying `'2'` produces an answer, the
 * wrong one, silently.
 */
export type ReserveChoice = '0' | '1' | '2' | '3' | 'four-or-more' | 'unknown';

/**
 * Everything the tool is currently being asked about.
 *
 * `unit` is held beside the weight rather than read off it because an empty
 * field has no weight to read a unit from, and the unit control has to keep
 * working before anything is typed.
 */
export interface EstimateEntry {
  /** Exactly what is in the weight field. */
  readonly weightText: string;
  /**
   * The drift-free origin behind the weight field, or `null` when nothing parses.
   *
   * Tool 4's `EnteredWeight`, reused rather than re-derived: §15 makes
   * "converting between units repeatedly introduces no cumulative drift" an
   * acceptance test, and the only way to pass it is to never rewrite the number
   * the lifter typed. Flicking kg/lb changes which unit the origin is *shown*
   * in and touches the origin not at all.
   */
  readonly weight: EnteredWeight | null;
  readonly unit: WeightUnit;
  /** Exactly what is in the repetitions field. */
  readonly repsText: string;
  readonly reserve: ReserveChoice;
  readonly lift: EstimateLift;
  /** Always an identifier `techniquesFor(lift)` offers. */
  readonly techniqueId: string;
  readonly sex: ReportedSex;
  readonly experience: TrainingExperience;
  readonly freshness: SetFreshness;
  readonly formQuality: FormQuality;
  readonly assisted: boolean;
  /** The step the three displayed figures are rounded to, in `unit`. */
  readonly roundTo: number;
  /** The gap between rows of the training-percentage table, in whole percent. */
  readonly percentageStep: number;
}
