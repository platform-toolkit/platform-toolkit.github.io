// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §16: a lifter thinks in pounds and the platform runs in kilograms.
 *
 * Two rules govern everything here, and both are about not deciding on somebody's
 * behalf.
 *
 * THE POUND FIGURE IS READ, NEVER COMPUTED
 *
 * §16 says to reuse the federation's published kilogram conversion chart rather
 * than independently calculating and rounding a displayed value. That is not
 * fussiness about a decimal place: a lifter who reads 402 lb on the tool and 402.3
 * lb on the federation's own chart has been given two numbers for one attempt, and
 * the one that counts is the federation's. So the pound figure beside an attempt
 * comes out of the chart or comes back `null` with a reason. The exact conversion
 * is carried alongside, labelled as reference, because it is the honest answer to
 * "what is this really" and is never the figure presented as the attempt.
 *
 * THE HEAVIER RESULT IS NEVER CHOSEN SILENTLY
 *
 * A typed pound figure almost never lands on a legal bar weight. §16 asks for the
 * next lower legal attempt, the closest, and the next higher -- three fields, and
 * the closest is deliberately the same object as one of the other two rather than a
 * third weight invented to fill the slot. Rounding up by default would hand a
 * lifter a heavier attempt than they asked for at the one moment in the day when
 * that matters most, so the tie in `closest` goes down, which is `MeetRules`'
 * existing rule and not a second one written here.
 *
 * What is legal is `MeetRules`' answer and what is published is the chart's. They
 * are kept apart on purpose: a chart printed in 5 kg steps at the top does not make
 * 2.5 kg illegal, and a bar multiple of 2.5 does not put a row on the chart.
 */
import type { ConversionChart } from './conversion-chart.js';
import type { MeetRules } from './meet-rules.js';
import { convertWeight, type Weight } from './weight.js';

/** Why an attempt has no published pound figure beside it. */
export type PublishedPoundsReason =
  /** The chart names this exact kilogram figure. */
  | 'published'
  /** The chart has no row for it, which a coarser chart than the bar produces. */
  | 'not-on-the-chart'
  /** No chart was supplied: the federation publishes none, or the read failed. */
  | 'no-chart';

/** One weight the bar can be loaded to, with what the federation prints beside it. */
export interface AttemptWeight {
  readonly kilograms: number;
  /** What the federation's chart prints for this attempt, or `null`. Never computed. */
  readonly publishedPounds: number | null;
  readonly publishedPoundsReason: PublishedPoundsReason;
  /**
   * The real conversion, unrounded.
   *
   * Reference only, and rounded by whoever displays it. Shown as "about", never as
   * the attempt, and never used to decide anything -- §16 gives that job to the
   * chart.
   */
  readonly exactPounds: number;
  /** Whether this is the legal weight nearest the figure that was typed. */
  readonly closest: boolean;
}

export type AttemptEntryAdvisoryCode =
  /** The typed figure is not a legal bar weight, so a choice has to be made. */
  | 'between-legal-attempts'
  /** Said out loud, because the alternative is to round up quietly. */
  | 'the-heavier-attempt-was-not-chosen-for-you'
  /** Nothing legal sits below the figure: it is under one bar increment. */
  | 'nothing-legal-below'
  /** At least one attempt has no published pound figure. */
  | 'no-published-pound-figure'
  /** No chart was in hand, so every pound figure shown is a conversion. */
  | 'no-chart-in-hand';

export interface AttemptEntryAdvisory {
  readonly code: AttemptEntryAdvisoryCode;
  readonly message: string;
}

export interface AttemptEntry {
  /** What the lifter typed, in the unit they typed it in. */
  readonly entered: Weight;
  /**
   * The kilogram figure the entry means, before the bar is consulted.
   *
   * An exact conversion when the entry was in pounds; the entry itself when it was
   * in kilograms. Not necessarily loadable, which is the whole reason the rest of
   * this type exists.
   */
  readonly exactKilograms: number;
  /** Whether the entry already names a legal bar weight and there is nothing to choose. */
  readonly alreadyLegal: boolean;
  /** §16's "next lower legal attempt". `null` when nothing legal is below it. */
  readonly nextLower: AttemptWeight | null;
  /**
   * §16's "closest legal attempt".
   *
   * The same weight as one of its neighbours rather than a third figure: between
   * two legal attempts there are two legal attempts, and manufacturing a third to
   * fill the field would be the tool inventing a weight nobody can load. A midpoint
   * goes to the lighter one.
   */
  readonly closest: AttemptWeight;
  /** §16's "next higher legal attempt". */
  readonly nextHigher: AttemptWeight;
  /** The distinct weights above, lightest first, for a list that repeats nothing. */
  readonly choices: readonly AttemptWeight[];
  readonly advisories: readonly AttemptEntryAdvisory[];
}

/** The same tolerance the rest of the meet code compares kilograms with. */
const SAME_WEIGHT_SLACK = 0.000_5;

function isSameWeight(left: number, right: number): boolean {
  return Math.abs(left - right) <= SAME_WEIGHT_SLACK;
}

/**
 * What the federation prints beside one attempt, and what it really is.
 *
 * The chart is looked up on the kilogram column, because the kilogram figure is
 * the attempt and the pound figure is the federation's rendering of it. Looking up
 * the pound column instead would answer a different question -- which published
 * attempts surround a pound figure -- and is what {@link enterAttemptWeight} does
 * on the way in.
 */
export function attemptWeightFor(
  kilograms: number,
  chart: ConversionChart | null,
  closest = false,
): AttemptWeight {
  const exactPounds = convertWeight({ amount: kilograms, unit: 'kg' }, 'lb').amount;
  if (chart === null) {
    return {
      kilograms,
      publishedPounds: null,
      publishedPoundsReason: 'no-chart',
      exactPounds,
      closest,
    };
  }
  const lookup = chart.lookup(kilograms, 'kilograms');
  return {
    kilograms,
    publishedPounds: lookup.kind === 'exact' ? lookup.row.pounds : null,
    publishedPoundsReason: lookup.kind === 'exact' ? 'published' : 'not-on-the-chart',
    exactPounds,
    closest,
  };
}

/**
 * The legal attempts around something a lifter typed, in either unit.
 *
 * Takes the entry as it stands in the field rather than a parsed structure, so a
 * caller that has already validated the number does not have to re-wrap it. The
 * kilogram path and the pound path differ only in the conversion at the top: both
 * end at `MeetRules`, which is the one authority on what the bar can be, and both
 * read their pound figures off the chart.
 */
export function enterAttemptWeight(
  rules: MeetRules,
  entered: Weight,
  chart: ConversionChart | null,
): AttemptEntry {
  const exactKilograms =
    entered.unit === 'kg' ? entered.amount : convertWeight(entered, 'kg').amount;

  const around = rules.legalWeightsAround(exactKilograms);
  const alreadyLegal = rules.isLegalBarWeight(exactKilograms);

  const lowerIsClosest = around.below !== null && isSameWeight(around.nearest, around.below);
  const nextLower =
    around.below === null ? null : attemptWeightFor(around.below, chart, lowerIsClosest);
  const nextHigher = attemptWeightFor(around.above, chart, !lowerIsClosest);
  const closest = lowerIsClosest && nextLower !== null ? nextLower : nextHigher;

  // The collapsed case offers `closest` rather than `nextHigher`, and the two are
  // the same weight -- what differs is the flag. An interface that renders
  // `choices` and marks the closest of them would otherwise mark none of them for
  // an entry that is already a legal attempt, which reads as the tool having no
  // opinion about the weight the lifter just typed correctly.
  const choices =
    nextLower === null || isSameWeight(nextLower.kilograms, nextHigher.kilograms)
      ? [closest]
      : [nextLower, nextHigher];

  return {
    entered,
    exactKilograms,
    alreadyLegal,
    nextLower,
    closest,
    nextHigher,
    choices,
    advisories: advisoriesFor({ alreadyLegal, nextLower, choices, chart }),
  };
}

function advisoriesFor(input: {
  readonly alreadyLegal: boolean;
  readonly nextLower: AttemptWeight | null;
  readonly choices: readonly AttemptWeight[];
  readonly chart: ConversionChart | null;
}): readonly AttemptEntryAdvisory[] {
  const advisories: AttemptEntryAdvisory[] = [];

  if (!input.alreadyLegal) {
    advisories.push({
      code: 'between-legal-attempts',
      message: 'That figure is between two attempts the bar can be loaded to. Pick one.',
    });
    advisories.push({
      code: 'the-heavier-attempt-was-not-chosen-for-you',
      message:
        'Nothing has been rounded up on your behalf. The lighter attempt is offered first and the heavier one is yours to take if you want it.',
    });
  }

  if (!input.alreadyLegal && input.nextLower === null) {
    advisories.push({
      code: 'nothing-legal-below',
      message: 'There is no lighter legal attempt: the figure is under one bar increment.',
    });
  }

  if (input.chart === null) {
    advisories.push({
      code: 'no-chart-in-hand',
      message:
        'The federation conversion chart is not loaded, so the pound figures shown are conversions rather than the published ones.',
    });
  } else if (input.choices.some((choice) => choice.publishedPounds === null)) {
    advisories.push({
      code: 'no-published-pound-figure',
      message:
        'The published chart has no row for one of these attempts, so no official pound figure is shown for it.',
    });
  }

  return advisories;
}
