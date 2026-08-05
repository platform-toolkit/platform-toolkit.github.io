// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type {
  AgeDivision,
  EquipmentCategory,
  SexCategory,
  WeightClass,
} from '@platform-toolkit/data-contracts';
import { WeightClassLadder, eligibleAgeDivisions } from '@platform-toolkit/domain';

import type {
  CatalogVocabulary,
  CategoryProposal,
  DivisionCandidate,
  ObservedAge,
  ProposalBasis,
} from '../types.js';

/**
 * Getting from what an archive printed to what a federation publishes.
 *
 * This is the hardest thing in the package and the place a plausible wrong answer
 * would be easiest to produce, so it is worth being explicit about the trap. The
 * archive keeps its own vocabulary on purpose (section 5.15): it spans hundreds of
 * federations and no catalogue covers them, and mapping its `Division` string onto
 * a federation's own division would be this project asserting an equivalence
 * nobody has checked. A tool that quietly resolved those strings would be exactly
 * the thing the mirror was built to avoid.
 *
 * But something has to bridge the gap, because a classification table is keyed on
 * federation identifiers and a lifter's total arrives with an archive label
 * attached. So the bridge is built out of two materials that are not the same
 * strength, and the type system keeps them apart:
 *
 * - **Measured.** Arithmetic against a boundary the federation published. A
 *   bodyweight of 108.4 kg makes the 110 kg class because 108.4 is at or under
 *   110. An age of 47 admits a division whose band is 45 to 49. No vocabulary was
 *   crossed to say either, so these are safe to fill in for somebody.
 * - **Spelled.** Two documents used the same word. That is not evidence, and the
 *   flagship case is right here in this federation: the archive's `Raw` and this
 *   federation's `Raw` differ over knee wraps, so the exact-match proposal is
 *   *actively wrong* for the most common entry in the corpus. A spelled proposal
 *   is a place to start a conversation with the reader, never an answer to hand
 *   them.
 *
 * {@link mayPreselect} is the one rule that keeps the second kind off a form as a
 * default, and it lives here so that every screen that grows later inherits it
 * rather than re-deciding it.
 */

/**
 * Whether a proposal on this basis may be filled in without being confirmed.
 *
 * Only measurement. See the note above for why matching a word is not enough --
 * and note that the failure it prevents is silent: a lifter graded against the
 * wrong equipment ladder sees a plausible number, on the right screen, under the
 * right heading.
 */
export function mayPreselect(basis: ProposalBasis): boolean {
  return basis === 'measured';
}

/**
 * The weight classes one sex competes in, and an empty ladder until the sex is known.
 *
 * The only thing anywhere that reads {@link CatalogVocabulary.weightClassLadders}, so
 * that the rule below is written once. Every screen, proposer and label goes through
 * here.
 *
 * `null` returns `[]` rather than every class the federation publishes, and that is the
 * whole point of the function. A weight class is proposed by *measurement* -- a
 * bodyweight against a published boundary -- and a measured proposal is one
 * {@link mayPreselect} lets a form fill in unasked. Fall back to the union and the
 * screen opens with a class preselected off whichever ladder happened to contain a
 * matching boundary: a 115 kg woman is put in a 125 kg class her federation does not
 * offer her, and a 115 kg man is graded against a women's 110+ standard. Both look
 * exactly like an answer.
 *
 * An empty ladder proposes nothing, so the axis lands in
 * {@link import('./registration.js').RegistrationProposal.unsettled} and the reader is
 * asked -- which is what "this cannot be known yet" is supposed to look like
 * (section 5.5). It is also what a federation publishing no ladder for a sex looks
 * like, and the two want the same screen: a picker with nothing in it and a note
 * saying so.
 */
export function weightClassesFor(
  vocabulary: CatalogVocabulary,
  sex: SexCategory | null,
): readonly WeightClass[] {
  if (sex === null) return [];
  return vocabulary.weightClassLadders.find((ladder) => ladder.sex === sex)?.classes ?? [];
}

/**
 * Folds a label for comparison: case, surrounding space, inner runs of space, and
 * the punctuation federations disagree about (`Single-ply` against `Single Ply`).
 *
 * Nothing else. No stemming, no synonym list, no prefix matching. Every one of
 * those would turn "these two documents wrote the same word" into "these two
 * documents probably mean the same thing", which is the claim this file exists to
 * refuse to make.
 */
function fold(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/gu, '');
}

/** A proposal with nothing in it, carrying whatever the archive printed. */
function noProposal<T>(observed: string | null): CategoryProposal<T> {
  return { observed, candidates: [], proposed: null, basis: 'none' };
}

/** Wraps whatever matched, refusing to pick when more than one did (section 5.5). */
function fromCandidates<T>(
  observed: string | null,
  candidates: readonly T[],
  basis: ProposalBasis,
): CategoryProposal<T> {
  const [only, ...rest] = candidates;
  if (only === undefined) return noProposal(observed);
  return {
    observed,
    candidates,
    proposed: rest.length === 0 ? only : null,
    basis: rest.length === 0 ? basis : 'none',
  };
}

/**
 * The sex category the archive's letter is spelled like.
 *
 * `M` and `F` against `male` and `female`, on the initial. Spelled rather than
 * measured, and it stays that way even though it feels obvious, because `Mx` is a
 * value the archive publishes and the published category vocabulary has nowhere to
 * put it -- so the honest outcome for that row is no proposal and a question, not
 * a coin toss between the two categories that do exist.
 */
export function proposeSex(observed: string | null): CategoryProposal<SexCategory> {
  if (observed === null) return noProposal(observed);
  const folded = fold(observed);
  const categories: readonly SexCategory[] = ['female', 'male'];
  const candidates = categories.filter(
    (category) => folded === category || folded === category.slice(0, 1),
  );
  return fromCandidates(observed, candidates, 'spelled');
}

/**
 * The equipment category spelled the way the archive spelled it.
 *
 * Matched on the federation's own id as well as its label, because a catalogue's
 * id is sometimes the plainer of the two and costs nothing to check. Both are
 * spelling, and neither is safe to pre-select: see the file note.
 */
export function proposeEquipment(
  observed: string | null,
  equipment: readonly EquipmentCategory[],
): CategoryProposal<EquipmentCategory> {
  if (observed === null) return noProposal(observed);
  const folded = fold(observed);
  const candidates = equipment.filter(
    (category) => fold(category.label) === folded || fold(category.id) === folded,
  );
  return fromCandidates(observed, candidates, 'spelled');
}

/** How a printed weight class reads. */
type ReadClass =
  | { readonly kind: 'bounded'; readonly kilograms: number }
  | { readonly kind: 'unbounded'; readonly above: number }
  | { readonly kind: 'unreadable' };

/**
 * Reads the class the archive printed: `90`, `82.5`, `90+`, `SHW`.
 *
 * `SHW` is unreadable on purpose. It plainly means the heaviest class, and the
 * heaviest class of *which ladder* is the whole question -- a lifter who was SHW
 * in a federation topping out at 120 kg is not in this federation's 140+ class,
 * and proposing one for the other is the exact translation this file refuses.
 */
function readClass(printed: string): ReadClass {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(\+?)\s*$/u.exec(printed);
  if (match === null) return { kind: 'unreadable' };
  const kilograms = Number(match[1]);
  if (!Number.isFinite(kilograms) || kilograms <= 0) return { kind: 'unreadable' };
  return match[2] === '+'
    ? { kind: 'unbounded', above: kilograms }
    : { kind: 'bounded', kilograms };
}

/** Whether two published kilogram figures name the same boundary. */
function sameBoundary(left: number, right: number): boolean {
  // A hundredth, which is the precision every published boundary in this project
  // is quoted to. A strict equality would refuse `82.5` against `82.50` the day a
  // source started writing the trailing zero as a number.
  return Math.abs(left - right) < 0.005;
}

/**
 * The class the archive says the lifter *entered*, matched on its boundary.
 *
 * Measured, not spelled: `90` is checked against a published `maximumKilograms` of
 * 90, and `90+` against a ladder whose unbounded class begins above 90 -- which is
 * the boundary of the class below it, and is the check that stops another
 * federation's SHW resolving to this one's.
 *
 * This is the class that decides which standards apply, which is why it is read
 * separately from {@link proposeWeightClassFromBodyweight}: a lifter may enter a
 * class heavier than the one they weigh into, and the two disagreeing is
 * information rather than a fault.
 */
export function proposeWeightClassFromEntry(
  observed: string | null,
  classes: readonly WeightClass[],
): CategoryProposal<WeightClass> {
  if (observed === null) return noProposal(observed);
  const read = readClass(observed);
  if (read.kind === 'unreadable') return noProposal(observed);

  if (read.kind === 'bounded') {
    const candidates = classes.filter(
      (weightClass) =>
        weightClass.maximumKilograms !== null &&
        sameBoundary(weightClass.maximumKilograms, read.kilograms),
    );
    return fromCandidates(observed, candidates, 'measured');
  }

  const candidates = classes.filter((weightClass, index) => {
    if (weightClass.maximumKilograms !== null) return false;
    const below = index === 0 ? null : (classes[index - 1] ?? null);
    // A ladder of one class has nothing below it, so nothing to check the printed
    // figure against, and the honest answer is no proposal rather than a match on
    // the only candidate available.
    return below?.maximumKilograms != null && sameBoundary(below.maximumKilograms, read.above);
  });
  return fromCandidates(observed, candidates, 'measured');
}

/**
 * The lightest class a weighed-in bodyweight makes.
 *
 * Shown beside {@link proposeWeightClassFromEntry} rather than instead of it. When
 * the two disagree the lifter entered above their bodyweight, which is allowed and
 * common, and a screen showing only one of the two answers has hidden the reason
 * its number looks wrong.
 */
export function proposeWeightClassFromBodyweight(
  bodyweightKilograms: number | null,
  classes: readonly WeightClass[],
): CategoryProposal<WeightClass> {
  if (bodyweightKilograms === null || !(bodyweightKilograms > 0)) return noProposal(null);
  const ladder = WeightClassLadder.from(classes);
  // A ladder the federation published wrongly is a data fault, and this screen is
  // not where it gets reported -- but proposing a class off an unchecked ladder
  // would put an arbitrary answer in front of a lifter, so there is none.
  if (!ladder.ok) return noProposal(null);
  return fromCandidates(null, [ladder.ladder.resolve(bodyweightKilograms)], 'measured');
}

/**
 * Every division an age admits, and which reading of the age admits it.
 *
 * The research finding this exists for: the archive writes a half year when the
 * meet published a birth year rather than a birth date, so the lifter was that age
 * *or one year older* -- and on a division boundary those are two different
 * divisions. An approximate 39 is a Submaster or an Open lifter. Both are
 * returned, each labelled with the reading that reaches it, because rounding
 * either way answers a question the source declined to answer.
 *
 * Ordered as the federation publishes its divisions, which is the order a lifter
 * sees them on the entry form.
 */
export function divisionsForAge(
  age: ObservedAge,
  divisions: readonly AgeDivision[],
): readonly DivisionCandidate[] {
  const younger = new Set(eligibleAgeDivisions(age.years, divisions).map((one) => one.id));
  const older = age.approximate
    ? new Set(eligibleAgeDivisions(age.years + 1, divisions).map((one) => one.id))
    : younger;

  const candidates: DivisionCandidate[] = [];
  for (const division of divisions) {
    const inYounger = younger.has(division.id);
    const inOlder = older.has(division.id);
    if (!inYounger && !inOlder) continue;
    candidates.push({
      division,
      support:
        inYounger && inOlder
          ? 'either-reading'
          : inYounger
            ? 'younger-reading-only'
            : 'older-reading-only',
    });
  }
  return candidates;
}

/**
 * The division whose band is the one the meet printed: `40-44`, `40+`, `13-19`.
 *
 * Measured, because it compares two pairs of published numbers rather than two
 * names -- a band of 40 to 44 is a band of 40 to 44 whatever either document calls
 * it. A band that matches nothing is a meet running a division this federation
 * does not, which is a real and common thing for an archive spanning hundreds of
 * federations, and the honest outcome is no proposal.
 */
export function proposeDivisionFromAgeClass(
  observed: string | null,
  divisions: readonly AgeDivision[],
): CategoryProposal<AgeDivision> {
  if (observed === null) return noProposal(observed);
  const band = readBand(observed);
  if (band === null) return noProposal(observed);
  const candidates = divisions.filter(
    (division) => division.minimumAge === band.from && division.maximumAge === band.to,
  );
  return fromCandidates(observed, candidates, 'measured');
}

/** Reads `40-44` and `40+` into a pair of bounds. `null` for anything else. */
function readBand(printed: string): { readonly from: number; readonly to: number | null } | null {
  const range = /^\s*(\d{1,3})\s*-\s*(\d{1,3})\s*$/u.exec(printed);
  if (range !== null) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    return from <= to ? { from, to } : null;
  }
  const open = /^\s*(\d{1,3})\s*\+\s*$/u.exec(printed);
  return open === null ? null : { from: Number(open[1]), to: null };
}
