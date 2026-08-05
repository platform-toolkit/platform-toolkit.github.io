// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type {
  AgeDivision,
  EquipmentCategory,
  SexCategory,
  WeightClass,
} from '@platform-toolkit/data-contracts';

import type {
  CatalogVocabulary,
  CategoryProposal,
  DivisionCandidate,
  ObservedAge,
  ObservedStanding,
  ProposalBasis,
  ResolvedRegistration,
} from '../types.js';
import {
  divisionsForAge,
  mayPreselect,
  proposeDivisionFromAgeClass,
  proposeEquipment,
  proposeSex,
  proposeWeightClassFromBodyweight,
  proposeWeightClassFromEntry,
} from './category-match.js';

/**
 * Turning what a lifter's history says into the five answers an entry form asks.
 *
 * A classification table is chosen with five settled answers -- sex, equipment,
 * weight class, division and drug-tested status -- and a lifter's history settles
 * some of them and genuinely cannot settle the rest. This module is where that
 * line is drawn, and where it is drawn *out loud*: the screen asks about exactly
 * the axes {@link RegistrationProposal.unsettled} names, and about nothing else.
 *
 * The division axis is unsettled far more often than it looks like it should be,
 * and that is correct rather than a gap. A Junior may enter Junior and/or Open; a
 * Master may enter Master and/or Open; an Open lifter may enter only Open (USPA
 * Item 8.1.19). So for most lifters over 40 the eligible set has two members and
 * choosing between them is a strategic decision about which standards to be read
 * against -- one this tool would be ruling on if it picked (section 29).
 */

/** An answer the entry form needs. */
export type RegistrationAxis = 'sex' | 'equipment' | 'weight-class' | 'division' | 'tested';

/**
 * A registration being filled in, one field at a time.
 *
 * The published {@link ResolvedRegistration} is deeply readonly so that a report
 * cannot be handed a query that something later edits out from under it. Building
 * one needs somewhere to write, and this is that place and nowhere else -- it is
 * not exported, so no caller can hold a half-built registration and mistake it for
 * a settled one.
 */
type RegistrationDraft = {
  -readonly [K in keyof ResolvedRegistration]?: ResolvedRegistration[K];
};

/** A drug-tested status the history states, or an honest absence of one. */
export interface TestedProposal {
  /** What the archive recorded: `true`, or `null` where it said nothing. */
  readonly observed: boolean | null;
  readonly proposed: boolean | null;
  readonly basis: ProposalBasis;
}

/** Which divisions one recorded age admits, and on which reading of it. */
export interface AgeDivisionCandidates {
  readonly age: ObservedAge;
  readonly candidates: readonly DivisionCandidate[];
}

/** Everything known about how a standing would be registered, and what is not. */
export interface RegistrationProposal {
  readonly sex: CategoryProposal<SexCategory>;
  readonly equipment: CategoryProposal<EquipmentCategory>;

  /**
   * The class the archive says was entered, and the class the bodyweight makes.
   *
   * Both, always. They disagree whenever a lifter entered above their weigh-in,
   * which is allowed and common, and a screen showing one number without the
   * other has hidden the reason it looks wrong.
   */
  readonly enteredWeightClass: CategoryProposal<WeightClass>;
  readonly weighedWeightClass: CategoryProposal<WeightClass>;

  /** The division whose published band matches the one the meet printed. */
  readonly divisionFromBand: CategoryProposal<AgeDivision>;

  /**
   * Every division the recorded ages admit, one group per age.
   *
   * Grouped rather than merged because the sentence a reader needs is "at 39 --
   * or 40, the archive does not say -- you were eligible for these", and a merged
   * list cannot say it. Usually one group: the meet's age band is part of what
   * separates one standing from another.
   */
  readonly divisionsByAge: readonly AgeDivisionCandidates[];

  /** The distinct divisions across every age, in the federation's own order. */
  readonly divisionOptions: readonly AgeDivision[];

  readonly tested: TestedProposal;

  /**
   * What the form may fill in for somebody, and it is deliberately little.
   *
   * A field appears here only when a proposal was measured against a published
   * boundary ({@link mayPreselect}). Two documents agreeing on a word is not
   * enough -- see `category-match.ts` for the case where it is worse than
   * nothing.
   */
  readonly defaults: Partial<ResolvedRegistration>;

  /** The axes the reader has to answer. Empty means the form is already complete. */
  readonly unsettled: readonly RegistrationAxis[];
}

/** Reads a standing against one federation's vocabulary. */
export function proposeRegistration(
  standing: ObservedStanding,
  vocabulary: CatalogVocabulary,
): RegistrationProposal {
  const { registration } = standing;

  const sex = proposeSex(registration.sex);
  const equipment = proposeEquipment(registration.equipment, vocabulary.equipment);
  const enteredWeightClass = proposeWeightClassFromEntry(
    registration.weightClassKg,
    vocabulary.weightClasses,
  );
  const weighedWeightClass = proposeWeightClassFromBodyweight(
    // The lightest weigh-in in the window. A lifter who dropped a class mid-window
    // is two standings, so within one standing the spread is a weigh-in wobble --
    // and the lightest is the only one that certainly made the class they entered.
    standing.bodyweights[0] ?? null,
    vocabulary.weightClasses,
  );
  const divisionFromBand = proposeDivisionFromAgeClass(registration.ageClass, vocabulary.divisions);

  const divisionsByAge = standing.ages.map((age) => ({
    age,
    candidates: divisionsForAge(age, vocabulary.divisions),
  }));

  const tested = proposeTested(registration.tested);

  const defaults: RegistrationDraft = {};
  const unsettled: RegistrationAxis[] = [];

  settle(defaults, unsettled, 'sex', sex, (value) => ({ sex: value }));
  settle(defaults, unsettled, 'equipment', equipment, (value) => ({ equipmentId: value.id }));
  // The *entered* class, not the weighed one: standards are published per class
  // entered, and a lifter who moved up is read against the class they moved to.
  settle(defaults, unsettled, 'weight-class', enteredWeightClass, (value) => ({
    weightClassId: value.id,
  }));
  settle(defaults, unsettled, 'division', divisionFromBand, (value) => ({ divisionId: value.id }));

  if (tested.proposed !== null && mayPreselect(tested.basis)) {
    defaults.tested = tested.proposed;
  } else {
    unsettled.push('tested');
  }

  return {
    sex,
    equipment,
    enteredWeightClass,
    weighedWeightClass,
    divisionFromBand,
    divisionsByAge,
    divisionOptions: distinctDivisions(vocabulary.divisions, divisionsByAge, divisionFromBand),
    tested,
    defaults,
    unsettled,
  };
}

/**
 * Whether every axis has an answer, and the answers if so.
 *
 * A discriminated result rather than a nullable registration, so that a caller
 * that forgot to ask cannot render a report against four fifths of a query.
 */
export type RegistrationResolution =
  | { readonly ok: true; readonly registration: ResolvedRegistration }
  | { readonly ok: false; readonly missing: readonly RegistrationAxis[] };

/** Completes a proposal with whatever the reader answered. */
export function resolveRegistration(
  proposal: RegistrationProposal,
  answers: Partial<ResolvedRegistration>,
): RegistrationResolution {
  const { sex, equipmentId, weightClassId, divisionId, tested } = {
    ...proposal.defaults,
    ...answers,
  };

  const missing: RegistrationAxis[] = [];
  if (sex === undefined) missing.push('sex');
  if (equipmentId === undefined) missing.push('equipment');
  if (weightClassId === undefined) missing.push('weight-class');
  if (divisionId === undefined) missing.push('division');
  if (tested === undefined) missing.push('tested');

  // Restated rather than `missing.length > 0`, because the compiler cannot narrow
  // five fields from the length of a list. It is not a second copy of the rule
  // that can drift: a new axis on `ResolvedRegistration` fails to compile in the
  // literal below until it is checked here too.
  if (
    sex === undefined ||
    equipmentId === undefined ||
    weightClassId === undefined ||
    divisionId === undefined ||
    tested === undefined
  ) {
    return { ok: false, missing };
  }

  // Rebuilt field by field rather than spread, so that an extra key on `answers`
  // cannot travel into a query the caller then reads back as if this package had
  // put it there.
  return { ok: true, registration: { sex, equipmentId, weightClassId, divisionId, tested } };
}

/**
 * A drug-tested status, and why a blank is not a `false`.
 *
 * The archive's column only ever asserts the positive, so a blank is an absence of
 * information rather than a statement that the meet ran no testing. Read as
 * `false` it would put untested standards in front of somebody whose meet was
 * tested and simply not annotated -- and drug-test status is the axis a lifter is
 * turned away at weigh-in over. A `true` is measured, because nothing had to be
 * translated to carry a boolean across.
 */
function proposeTested(observed: boolean | null): TestedProposal {
  if (observed === null) return { observed, proposed: null, basis: 'none' };
  return { observed, proposed: observed, basis: 'measured' };
}

function settle<T>(
  defaults: RegistrationDraft,
  unsettled: RegistrationAxis[],
  axis: RegistrationAxis,
  proposal: CategoryProposal<T>,
  write: (value: T) => RegistrationDraft,
): void {
  if (proposal.proposed !== null && mayPreselect(proposal.basis)) {
    Object.assign(defaults, write(proposal.proposed));
    return;
  }
  unsettled.push(axis);
}

/**
 * Every division any reading admits, plus the band's own, in published order.
 *
 * Filtered out of the federation's own list rather than accumulated from the
 * groups, so the control a reader sees is in the order their entry form prints --
 * accumulating would order the options by which of a lifter's ages was recorded
 * first, which is an ordering nobody could explain.
 */
function distinctDivisions(
  published: readonly AgeDivision[],
  byAge: readonly AgeDivisionCandidates[],
  fromBand: CategoryProposal<AgeDivision>,
): readonly AgeDivision[] {
  const wanted = new Set<string>();
  for (const group of byAge) {
    for (const candidate of group.candidates) wanted.add(candidate.division.id);
  }
  for (const candidate of fromBand.candidates) wanted.add(candidate.id);
  return published.filter((division) => wanted.has(division.id));
}
