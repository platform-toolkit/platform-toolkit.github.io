// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { SexCategory } from '@platform-toolkit/data-contracts';

import { weightClassesFor } from '../core/category-match.js';
import type { CatalogVocabulary, ResolvedRegistration } from '../types.js';

/**
 * Turning the identifiers a report is keyed on back into words a lifter reads.
 *
 * A {@link ResolvedRegistration} holds four federation identifiers and one sex,
 * because that is what selects a table. None of them is showable: `m-110` and
 * `masters-1` are what the catalogue calls things, not what an entry form does.
 * So every screen in this tool has to cross back, and it crosses back *here* --
 * one place, one behaviour for an identifier the catalogue does not hold.
 *
 * That behaviour is the only decision in the file and it is worth stating. An
 * unknown identifier renders as `null`, which every caller turns into a visible
 * absence, rather than falling back to the raw identifier. A screen printing
 * `m-110` looks like a rendering bug and gets reported as one; a screen saying the
 * catalogue does not hold the class says the true thing, which is that a report
 * was built against a catalogue that has since been republished without it.
 */

/**
 * The two published sex categories, in words rather than in catalogue spelling.
 *
 * Written out rather than title-cased from the identifier, because
 * `SexCategorySchema` is a closed picklist -- one of the few places in this
 * project where a fixed list is right (`categories.ts` argues it) -- and a
 * `Record` over a picklist stops compiling if the picklist grows. A title-casing
 * helper would silently render whatever arrived.
 */
export const SEX_LABELS: Readonly<Record<SexCategory, string>> = {
  female: 'Female',
  male: 'Male',
};

/**
 * Whether a string read off the DOM is one of the two published categories.
 *
 * Checked against {@link SEX_LABELS} rather than against the valibot picklist, and
 * the reason is not that valibot is unavailable -- it is that the picklist is a
 * runtime dependency an element does not otherwise need, and this record is already
 * compiler-checked against the same union. A category added to `SexCategory` fails
 * to compile here before it can reach this as a silent `false`.
 *
 * A check and not a cast, because the input is an attribute value: a typo in a
 * template would otherwise write an arbitrary string into a registration and the
 * symptom is a table selected for a category the federation does not publish.
 */
export function isSexCategory(value: string): value is SexCategory {
  return Object.hasOwn(SEX_LABELS, value);
}

/** Anything the catalogue publishes with a name. */
interface Named {
  readonly id: string;
  readonly label: string;
}

/** The published name for an identifier, or `null` where the catalogue has none. */
export function labelOf(published: readonly Named[], id: string): string | null {
  return published.find((item) => item.id === id)?.label ?? null;
}

/** One axis of a settled registration, ready to render. */
export interface RegistrationLabel {
  /** The question the entry form asks. */
  readonly axis: string;
  /** The answer, or `null` where the catalogue no longer names the identifier. */
  readonly value: string | null;
}

/**
 * A settled registration as five question-and-answer pairs.
 *
 * Every grade on this screen is read under these five answers, and the brief's
 * requirement is that the reader can check the answer rather than trust it. So
 * they are rendered in full beside the grades and not folded away: a grade with
 * its assumptions one tap behind it is a verdict, and this tool does not issue
 * those (section 29).
 */
export function registrationLabels(
  registration: ResolvedRegistration,
  vocabulary: CatalogVocabulary,
): readonly RegistrationLabel[] {
  return [
    { axis: 'Sex', value: SEX_LABELS[registration.sex] },
    { axis: 'Equipment', value: labelOf(vocabulary.equipment, registration.equipmentId) },
    // Read from this lifter's own ladder, not from every class the federation
    // publishes. A registration that survived a switch of sex can be holding a class
    // from the other ladder, and looking it up across both would print that class
    // back as though it were an answer -- the one place on the screen a reader is
    // meant to be able to catch it. Absent from their ladder, it renders as "not in
    // this federation's current catalogue", which is the true statement.
    {
      axis: 'Weight class',
      value: labelOf(weightClassesFor(vocabulary, registration.sex), registration.weightClassId),
    },
    { axis: 'Division', value: labelOf(vocabulary.divisions, registration.divisionId) },
    // Two words, not three states. This axis is settled by the time a registration
    // resolves -- `resolveRegistration` refuses to produce one until the reader has
    // answered it -- so the "not recorded" of `copy.ts`'s `testedLabel` cannot
    // occur here and offering it would suggest an answer the form does not accept.
    { axis: 'Drug tested', value: registration.tested ? 'Yes' : 'No' },
  ];
}
