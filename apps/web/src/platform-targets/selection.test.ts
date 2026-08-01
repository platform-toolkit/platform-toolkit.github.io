import type { CategoryCatalog, WeightClassLadderData } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import {
  NO_SELECTION,
  resolveSelection,
  type CategorySelection,
  type SelectionField,
  type SelectionQuestion,
} from './selection.js';

/**
 * Invented figures. Real class boundaries and age bands belong in published
 * data, where a stale one can be refreshed.
 */
const FEMALE_LADDER: WeightClassLadderData = {
  id: 'example-female',
  label: 'Female classes',
  sex: 'female',
  classes: [
    { id: 'f-56', label: '56 kg', maximumKilograms: 56 },
    { id: 'f-plus', label: '56+ kg', maximumKilograms: null },
  ],
};

const MALE_LADDER: WeightClassLadderData = {
  id: 'example-male',
  label: 'Male classes',
  sex: 'male',
  classes: [{ id: 'm-75', label: '75 kg', maximumKilograms: 75 }],
};

const CATALOG: CategoryCatalog = {
  id: 'example',
  label: 'Example Federation',
  equipment: [
    { id: 'raw', label: 'Raw' },
    { id: 'single-ply', label: 'Single-ply' },
  ],
  weightClassLadders: [FEMALE_LADDER, MALE_LADDER],
  ageDivisions: {
    id: 'example-divisions',
    label: 'Divisions',
    basis: 'age-on-meet-date',
    divisions: [
      { id: 'open', label: 'Open', minimumAge: null, maximumAge: null },
      { id: 'teen-3', label: 'Teen 3', minimumAge: null, maximumAge: 19 },
      { id: 'masters-1', label: 'Masters 1', minimumAge: 40, maximumAge: 49 },
      { id: 'masters-4', label: 'Masters 4', minimumAge: 70, maximumAge: null },
    ],
  },
};

/** A federation that published the female ladder twice. */
const AMBIGUOUS: CategoryCatalog = {
  ...CATALOG,
  weightClassLadders: [
    FEMALE_LADDER,
    MALE_LADDER,
    { ...FEMALE_LADDER, id: 'example-female-alternate' },
  ],
};

/** A complete, valid set of answers. Individual tests spoil one field. */
const CHOSEN: CategorySelection = {
  sex: 'female',
  equipment: 'raw',
  weightClass: 'f-56',
  division: 'open',
};

function question(
  catalog: CategoryCatalog,
  selection: CategorySelection,
  field: SelectionField,
): SelectionQuestion {
  const found = resolveSelection(catalog, selection).questions.find(
    (candidate) => candidate.field === field,
  );
  if (found === undefined) {
    throw new Error(`No question for "${field}".`);
  }
  return found;
}

function values(
  catalog: CategoryCatalog,
  selection: CategorySelection,
  field: SelectionField,
): string[] {
  return question(catalog, selection, field).choices.map((choice) => choice.value);
}

describe('resolveSelection', () => {
  it('asks every question, in the order a lifter answers them', () => {
    const { questions } = resolveSelection(CATALOG, NO_SELECTION);
    expect(questions.map((entry) => entry.field)).toEqual([
      'sex',
      'equipment',
      'weightClass',
      'division',
    ]);
  });

  it('offers only the sex categories the catalogue publishes classes for', () => {
    // Derived from the ladders, not from the picklist in the contracts package.
    // A category with no ladder is a question whose answer empties the next one.
    const oneLadder: CategoryCatalog = { ...CATALOG, weightClassLadders: [FEMALE_LADDER] };
    expect(values(oneLadder, NO_SELECTION, 'sex')).toEqual(['female']);
  });

  it('names each sex category once even if a federation publishes two ladders for it', () => {
    expect(values(AMBIGUOUS, NO_SELECTION, 'sex')).toEqual(['female', 'male']);
  });

  it('takes the equipment categories from the catalogue', () => {
    expect(values(CATALOG, NO_SELECTION, 'equipment')).toEqual(['raw', 'single-ply']);
  });

  it('has no weight classes to offer until a sex category is chosen', () => {
    const weightClass = question(CATALOG, NO_SELECTION, 'weightClass');
    expect(weightClass.choices).toEqual([]);
    expect(weightClass.emptyMessage).toContain('Choose a sex category');
  });

  it('offers the ladder belonging to the chosen sex category', () => {
    expect(values(CATALOG, { ...NO_SELECTION, sex: 'male' }, 'weightClass')).toEqual(['m-75']);
  });

  it('refuses to guess when two ladders claim one sex category', () => {
    // Document order would produce a plausible list of classes that is wrong
    // half the time, with nothing on screen to say so. Ambiguity is reported.
    const weightClass = question(AMBIGUOUS, { ...NO_SELECTION, sex: 'female' }, 'weightClass');
    expect(weightClass.choices).toEqual([]);
    expect(weightClass.emptyMessage).toContain('More than one set of weight classes');
  });

  it('keeps answers the catalogue offers', () => {
    expect(resolveSelection(CATALOG, CHOSEN).selection).toEqual(CHOSEN);
  });

  it('drops a weight class that belongs to the other ladder', () => {
    // The failure this whole module exists for: correcting the sex category
    // after picking a class would otherwise leave a class from the first ladder
    // in place, and every record and standard drawn afterwards would be for a
    // category the lifter is not in.
    const switched = resolveSelection(CATALOG, { ...CHOSEN, sex: 'male' });
    expect(switched.selection.weightClass).toBeNull();
    expect(switched.selection.sex).toBe('male');
  });

  it('keeps the answers that did not depend on the one that changed', () => {
    const switched = resolveSelection(CATALOG, { ...CHOSEN, sex: 'male' });
    expect(switched.selection.equipment).toBe('raw');
    expect(switched.selection.division).toBe('open');
  });

  it.each(['sex', 'equipment', 'weightClass', 'division'] as const)(
    'drops an unpublished %s outright rather than snapping to a neighbour',
    (field) => {
      const spoiled = resolveSelection(CATALOG, { ...CHOSEN, [field]: 'not-published' });
      expect(spoiled.selection[field]).toBeNull();
    },
  );

  it('reports the surviving answer on the question, not just in the selection', () => {
    // The component hands `value` straight to a choice group, so a stale answer
    // here would render as a checked radio the lifter cannot account for.
    const switched = resolveSelection(CATALOG, { ...CHOSEN, sex: 'male' });
    expect(switched.questions.find((entry) => entry.field === 'weightClass')?.value).toBeNull();
  });

  it('is complete only when every question is answered', () => {
    expect(resolveSelection(CATALOG, CHOSEN).complete).toBe(true);
    expect(resolveSelection(CATALOG, { ...CHOSEN, division: null }).complete).toBe(false);
  });

  it('is not complete when a question has no answers to give', () => {
    // Otherwise "every answer is filled in" would be satisfied by a catalogue
    // that asked nothing, and the tool would move on to showing records for a
    // category nobody identified.
    const noClasses: CategoryCatalog = {
      ...CATALOG,
      weightClassLadders: [{ ...FEMALE_LADDER, classes: [] }],
    };
    expect(resolveSelection(noClasses, CHOSEN).complete).toBe(false);
  });

  it('describes an age division by the band the catalogue published', () => {
    // Division names mean different bands in different federations, and they
    // overlap: a lifter of 45 is eligible for Open and for Masters 1. Showing
    // the band is what lets them notice.
    const descriptions = question(CATALOG, NO_SELECTION, 'division').choices.map(
      (choice) => choice.description,
    );
    expect(descriptions).toEqual([undefined, '19 and under', '40 to 49', '70 and over']);
  });

  it('leaves the top class label as the catalogue wrote it', () => {
    const labels = question(CATALOG, { ...NO_SELECTION, sex: 'female' }, 'weightClass').choices.map(
      (choice) => choice.label,
    );
    expect(labels).toEqual(['56 kg', '56+ kg']);
  });
});
