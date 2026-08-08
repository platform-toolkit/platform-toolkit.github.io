// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { CategoryCatalog, WeightClassLadderData } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import {
  NO_SELECTION,
  contextSummary,
  partitionKey,
  resolveSelection,
  testedFlag,
  type ContextSummary,
  type SelectionPicker,
  type SelectionQuestion,
} from './selection.js';
import type { CategorySelection, SelectionField } from '../types.js';

/**
 * Invented figures. Real class boundaries and age bands belong in published
 * data, where a stale one can be refreshed.
 */
const FEMALE_LADDER: WeightClassLadderData = {
  id: 'example-female',
  label: 'Female classes',
  sex: 'female',
  classes: [
    { id: 'f-52', label: '52 kg', maximumKilograms: 52 },
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
      // Open is deliberately *not* both-bounds-null here. The real published
      // Open division starts at the youngest age the federation competes at, and
      // a fixture that made Open the only unbounded division would let a wrong
      // implementation -- one that tests for two nulls -- pass.
      { id: 'open', label: 'Open', minimumAge: 13, maximumAge: null },
      { id: 'teen-3', label: 'Teen 3', minimumAge: null, maximumAge: 19 },
      { id: 'masters-1', label: 'Masters 1', minimumAge: 40, maximumAge: 49 },
      { id: 'masters-4', label: 'Masters 4', minimumAge: 70, maximumAge: null },
    ],
  },

  // Two unsubdivided levels and one subdivided one, which is the shape the
  // report was built for: world and national records are always read, state
  // records join them only once a state is picked.
  levels: [
    {
      id: 'state',
      label: 'State',
      regions: [
        { id: 'north-example', label: 'North Example' },
        { id: 'south-example', label: 'South Example' },
      ],
    },
    { id: 'national', label: 'National', regions: [] },
    { id: 'world', label: 'World', regions: [] },
  ],
  disciplines: [
    { id: 'full-power', label: 'Full power', lifts: ['squat', 'bench', 'deadlift', 'total'] },
    { id: 'bench-only', label: 'Bench only', lifts: ['bench'] },
  ],
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

/**
 * Every required answer given and nothing optional.
 *
 * `division` is `null` rather than `'open'` on purpose: Open is not something a
 * lifter picks, it is the column the report always draws, so a fixture that
 * answered it would exercise a state the interface cannot produce.
 */
const CHOSEN: CategorySelection = {
  sex: 'female',
  equipment: 'raw',
  weightClass: 'f-56',
  comparisonWeightClass: null,
  division: null,
  tested: 'tested',
  region: null,
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

function picker(
  catalog: CategoryCatalog,
  selection: CategorySelection,
  field: SelectionField,
): SelectionPicker {
  const found = resolveSelection(catalog, selection).pickers.find(
    (candidate) => candidate.field === field,
  );
  if (found === undefined) {
    throw new Error(`No picker for "${field}".`);
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

function options(
  catalog: CategoryCatalog,
  selection: CategorySelection,
  field: SelectionField,
): string[] {
  return picker(catalog, selection, field).options.map((option) => option.value);
}

describe('resolveSelection', () => {
  it('asks the three short questions as tiles', () => {
    const { questions } = resolveSelection(CATALOG, NO_SELECTION);
    expect(questions.map((entry) => entry.field)).toEqual(['sex', 'equipment', 'tested']);
  });

  it('asks the long questions as pickers, in the order they are shown', () => {
    // Twelve classes, eighteen divisions and fifty states as radio tiles were
    // most of the screen, and the report underneath them is the thing a lifter
    // came for. Requirement 1.
    const { pickers } = resolveSelection(CATALOG, NO_SELECTION);
    expect(pickers.map((entry) => entry.field)).toEqual([
      'weightClass',
      'comparisonWeightClass',
      'division',
      'region',
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
    const weightClass = picker(CATALOG, NO_SELECTION, 'weightClass');
    expect(weightClass.options).toEqual([]);
    expect(weightClass.emptyMessage).toContain('Choose a sex category');
  });

  it('offers the ladder belonging to the chosen sex category', () => {
    expect(options(CATALOG, { ...NO_SELECTION, sex: 'male' }, 'weightClass')).toEqual(['m-75']);
  });

  it('offers the same ladder to the comparison picker', () => {
    // Requirement 8 is a comparison between two classes on one ladder, not a
    // second lifter: a second list built independently could drift out of step
    // with the first the day either gained a filter.
    expect(options(CATALOG, CHOSEN, 'comparisonWeightClass')).toEqual(
      options(CATALOG, CHOSEN, 'weightClass'),
    );
  });

  it('refuses to guess when two ladders claim one sex category', () => {
    // Document order would produce a plausible list of classes that is wrong
    // half the time, with nothing on screen to say so. Ambiguity is reported.
    const weightClass = picker(AMBIGUOUS, { ...NO_SELECTION, sex: 'female' }, 'weightClass');
    expect(weightClass.options).toEqual([]);
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

  it('drops the comparison class along with the class it was compared to', () => {
    const switched = resolveSelection(CATALOG, {
      ...CHOSEN,
      comparisonWeightClass: 'f-52',
      sex: 'male',
    });
    expect(switched.selection.comparisonWeightClass).toBeNull();
  });

  it('keeps the answers that did not depend on the one that changed', () => {
    const switched = resolveSelection(CATALOG, {
      ...CHOSEN,
      division: 'masters-1',
      sex: 'male',
    });
    expect(switched.selection.equipment).toBe('raw');
    expect(switched.selection.division).toBe('masters-1');
  });

  it.each([
    'sex',
    'equipment',
    'weightClass',
    'comparisonWeightClass',
    'division',
    'tested',
    'region',
  ] as const)('drops an unpublished %s outright rather than snapping to a neighbour', (field) => {
    const spoiled = resolveSelection(CATALOG, { ...CHOSEN, [field]: 'not-published' });
    expect(spoiled.selection[field]).toBeNull();
  });

  it('reports the surviving answer on the control, not just in the selection', () => {
    // The component hands `value` straight to the control, so a stale answer
    // here would render as a chosen option the lifter cannot account for.
    const switched = resolveSelection(CATALOG, { ...CHOSEN, sex: 'male' });
    expect(switched.pickers.find((entry) => entry.field === 'weightClass')?.value).toBeNull();
  });
});

describe('resolveSelection readiness', () => {
  it('is ready on the four required answers alone', () => {
    // Requirement 9. Everything else adds a column; none of it can make what is
    // already on screen wrong, so none of it may hold the report back.
    const resolved = resolveSelection(CATALOG, CHOSEN);
    expect(resolved.ready).toBe(true);
    expect(resolved.outstanding).toEqual([]);
  });

  it('stays ready when every optional answer is given as well', () => {
    const resolved = resolveSelection(CATALOG, {
      ...CHOSEN,
      comparisonWeightClass: 'f-52',
      division: 'masters-1',
      region: 'north-example',
    });
    expect(resolved.ready).toBe(true);
  });

  it.each(['sex', 'equipment', 'weightClass', 'tested'] as const)(
    'is not ready without %s',
    (field) => {
      expect(resolveSelection(CATALOG, { ...CHOSEN, [field]: null }).ready).toBe(false);
    },
  );

  it('names the missing weight class even though it is a picker rather than a tile', () => {
    // The readable-but-wrong version filters only `questions`, so the weight
    // class is never named: the screen says everything is answered while the
    // report stays blank.
    const resolved = resolveSelection(CATALOG, { ...CHOSEN, weightClass: null });
    expect(resolved.outstanding).toEqual(['Weight class']);
  });

  it('names what is missing as labels, in the order the controls are asked', () => {
    const resolved = resolveSelection(CATALOG, NO_SELECTION);
    expect(resolved.outstanding).toEqual([
      'Sex category',
      'Equipment',
      'Drug-tested status',
      'Weight class',
    ]);
  });

  it('is not ready when a required question has no answers to give', () => {
    // Otherwise "every answer is filled in" would be satisfied by a catalogue
    // that asked nothing, and the tool would move on to showing records for a
    // category nobody identified.
    const noClasses: CategoryCatalog = {
      ...CATALOG,
      weightClassLadders: [{ ...FEMALE_LADDER, classes: [] }],
    };
    expect(resolveSelection(noClasses, CHOSEN).ready).toBe(false);
  });
});

describe('resolveSelection weight classes', () => {
  it('has one column for one class', () => {
    expect(resolveSelection(CATALOG, CHOSEN).weightClasses.map((entry) => entry.id)).toEqual([
      'f-56',
    ]);
  });

  it('has two columns when a comparison is asked for', () => {
    const resolved = resolveSelection(CATALOG, { ...CHOSEN, comparisonWeightClass: 'f-plus' });
    expect(resolved.weightClasses.map((entry) => entry.id)).toEqual(['f-56', 'f-plus']);
  });

  it('puts the lighter class first however it was arrived at', () => {
    // Ladder order rather than the order the two controls were touched in. A
    // comparison whose columns swap depending on which one moved last is one a
    // reader has to re-check every time.
    const resolved = resolveSelection(CATALOG, {
      ...CHOSEN,
      weightClass: 'f-plus',
      comparisonWeightClass: 'f-52',
    });
    expect(resolved.weightClasses.map((entry) => entry.id)).toEqual(['f-52', 'f-plus']);
  });

  it('draws one column when both controls name the same class', () => {
    const resolved = resolveSelection(CATALOG, { ...CHOSEN, comparisonWeightClass: 'f-56' });
    expect(resolved.weightClasses.map((entry) => entry.id)).toEqual(['f-56']);
  });
});

describe('resolveSelection divisions', () => {
  it('shows Open when no division is chosen', () => {
    const resolved = resolveSelection(CATALOG, CHOSEN);
    expect(resolved.divisions.map((entry) => entry.id)).toEqual(['open']);
    expect(resolved.openDivisionProblem).toBeNull();
  });

  it('shows Open alongside the chosen division, Open first', () => {
    // Requirement 2. A lifter looking at Masters 1 still needs to see what the
    // same lifts are worth in Open, because that is the division most enter.
    const resolved = resolveSelection(CATALOG, { ...CHOSEN, division: 'masters-1' });
    expect(resolved.divisions.map((entry) => entry.id)).toEqual(['open', 'masters-1']);
  });

  it('finds Open by reach rather than by both bounds being null', () => {
    // The published Open division starts at 13 because the federation runs
    // nothing below it. A structural test for two nulls finds nothing here, and
    // the symptom is a report with no Open column at all.
    expect(resolveSelection(CATALOG, CHOSEN).divisions[0]?.minimumAge).toBe(13);
  });

  it('does not offer Open as something to choose', () => {
    // It is in every report whatever this control says, so listing it would
    // present the always-on column as an option, and choosing it would appear to
    // do nothing.
    expect(options(CATALOG, CHOSEN, 'division')).not.toContain('open');
  });

  it('offers a way back to Open only through the placeholder', () => {
    expect(picker(CATALOG, CHOSEN, 'division').placeholder).toBe('Open only');
  });

  it('calls the division question by the name the divisions are published under', () => {
    // The label went the other way once -- "Masters or Juniors division", to
    // make clear a lifter of thirty could skip it -- and usability review found
    // the cost outweighed it: no published division is named that, so somebody
    // looking for "Master 50-54" had to deduce this was the control offering it.
    // The placeholder carries the skippable half instead; see the test above.
    const label = picker(CATALOG, CHOSEN, 'division').label;
    expect(label).toBe('Age division');
  });

  it('lists the divisions youngest first, whatever order they were published in', () => {
    expect(options(CATALOG, CHOSEN, 'division')).toEqual(['teen-3', 'masters-1', 'masters-4']);
  });

  it('puts the published age band in the label, because an option has one line', () => {
    // Division names mean different bands in different federations, and they
    // overlap: a lifter of 45 is eligible for Open and for Masters 1. Showing
    // the band is what lets them notice.
    expect(picker(CATALOG, CHOSEN, 'division').options.map((option) => option.label)).toEqual([
      'Teen 3 (19 and under)',
      'Masters 1 (40 to 49)',
      'Masters 4 (70 and over)',
    ]);
  });

  it('files the divisions under the family their labels name', () => {
    expect(picker(CATALOG, CHOSEN, 'division').options.map((option) => option.group)).toEqual([
      'Teen',
      'Masters',
      'Masters',
    ]);
  });

  it('groups nothing when every division would get its own heading', () => {
    // An eighteen-item list with eighteen headings in it is worse than no
    // headings at all.
    const distinct: CategoryCatalog = {
      ...CATALOG,
      ageDivisions: {
        ...CATALOG.ageDivisions,
        divisions: [
          { id: 'open', label: 'Open', minimumAge: 13, maximumAge: null },
          { id: 'teen', label: 'Teen', minimumAge: null, maximumAge: 19 },
          { id: 'masters', label: 'Masters', minimumAge: 40, maximumAge: null },
        ],
      },
    };
    expect(picker(distinct, CHOSEN, 'division').options.map((option) => option.group)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('says why Open is missing when two divisions are equally wide', () => {
    const tied: CategoryCatalog = {
      ...CATALOG,
      ageDivisions: {
        ...CATALOG.ageDivisions,
        divisions: [
          { id: 'open-a', label: 'Open A', minimumAge: null, maximumAge: null },
          { id: 'open-b', label: 'Open B', minimumAge: null, maximumAge: null },
        ],
      },
    };
    const resolved = resolveSelection(tied, CHOSEN);
    expect(resolved.openDivisionProblem).toBe('ambiguous');
    expect(resolved.divisions).toEqual([]);
  });
});

describe('resolveSelection record partitions', () => {
  it('reads every unsubdivided level without being asked', () => {
    // Requirement 3. World and national records are always shown; there is no
    // level question left to answer.
    expect(resolveSelection(CATALOG, CHOSEN).partitions).toEqual([
      { levelId: 'national', regionId: null, label: 'National' },
      { levelId: 'world', regionId: null, label: 'World' },
    ]);
  });

  it('adds the subdivided level once a region is chosen', () => {
    const resolved = resolveSelection(CATALOG, { ...CHOSEN, region: 'north-example' });
    expect(resolved.partitions).toEqual([
      { levelId: 'state', regionId: 'north-example', label: 'North Example State' },
      { levelId: 'national', regionId: null, label: 'National' },
      { levelId: 'world', regionId: null, label: 'World' },
    ]);
  });

  it('lists the closest-to-home level first, which is catalogue order', () => {
    const resolved = resolveSelection(CATALOG, { ...CHOSEN, region: 'south-example' });
    expect(resolved.partitions[0]?.levelId).toBe('state');
  });

  it('asks no region question when no level is subdivided', () => {
    const flat: CategoryCatalog = {
      ...CATALOG,
      levels: [{ id: 'national', label: 'National', regions: [] }],
    };
    expect(resolveSelection(flat, CHOSEN).pickers.map((entry) => entry.field)).not.toContain(
      'region',
    );
  });

  it('names the region question after the level it belongs to', () => {
    // Not "Region". There is no federation identifier in `selection.ts`, so
    // which level is subdivided is derived, and the heading has to come from the
    // same place or it will say "State" over a list of provinces.
    expect(picker(CATALOG, CHOSEN, 'region').label).toBe('State');
  });

  it('refuses to attach the region question to one of two subdivided levels', () => {
    const twoSubdivided: CategoryCatalog = {
      ...CATALOG,
      levels: [
        ...CATALOG.levels,
        { id: 'provincial', label: 'Provincial', regions: [{ id: 'north', label: 'North' }] },
      ],
    };
    const region = picker(twoSubdivided, CHOSEN, 'region');
    expect(region.options).toEqual([]);
    expect(region.emptyMessage).toContain('More than one kind of regional record');
  });

  it('reads neither subdivided level when the question cannot be attached', () => {
    // A partition for one of them would put a list of states under a heading
    // naming somewhere else.
    const twoSubdivided: CategoryCatalog = {
      ...CATALOG,
      levels: [
        ...CATALOG.levels,
        { id: 'provincial', label: 'Provincial', regions: [{ id: 'north', label: 'North' }] },
      ],
    };
    expect(
      resolveSelection(twoSubdivided, CHOSEN).partitions.map((entry) => entry.levelId),
    ).toEqual(['national', 'world']);
  });
});

describe('resolveSelection disciplines', () => {
  it('carries every event the federation contests, unfiltered', () => {
    // Requirement 4. A bench-only record is exactly as reachable as a full-power
    // one, and asking which event a lifter had in mind narrowed the report to a
    // third of what the data can say.
    expect(resolveSelection(CATALOG, CHOSEN).disciplines).toEqual(CATALOG.disciplines);
  });
});

describe('partitionKey', () => {
  it('separates the two axes with a character neither can contain', () => {
    // A hyphen or a colon is a character a published slug may legitimately
    // contain, so `level-a` + `b` would collide with `level` + `a-b` and the
    // second read would never be issued.
    expect(partitionKey({ levelId: 'level-a', regionId: 'b', label: '' })).not.toBe(
      partitionKey({ levelId: 'level', regionId: 'a-b', label: '' }),
    );
  });

  it('gives an unsubdivided level a key of its own', () => {
    expect(partitionKey({ levelId: 'national', regionId: null, label: 'National' })).toBe(
      'national\n',
    );
  });

  it('ignores the label, which is presentation rather than identity', () => {
    // The transport files a book under this key and the report looks one up by
    // it; a refresh that reworded a level would otherwise orphan every read.
    expect(partitionKey({ levelId: 'national', regionId: null, label: 'National' })).toBe(
      partitionKey({ levelId: 'national', regionId: null, label: 'Nationals' }),
    );
  });
});

describe('testedFlag', () => {
  it('converts the answer to the boolean the domain asks for', () => {
    expect(testedFlag(CHOSEN)).toBe(true);
    expect(testedFlag({ ...CHOSEN, tested: 'untested' })).toBe(false);
  });

  it('answers null while the question is unanswered', () => {
    // Not `false`. Defaulting an unanswered question to untested would read a
    // tested lifter against untested standards on a screen that looks complete.
    expect(testedFlag(NO_SELECTION)).toBeNull();
  });

  it('answers null for anything it does not recognise', () => {
    // The value originates as a string from the DOM. A conversion written as
    // `value !== 'untested'` would turn a typo into a confident `true`.
    expect(testedFlag({ ...CHOSEN, tested: 'Tested' })).toBeNull();
  });
});

describe('contextSummary', () => {
  function summarise(selection: CategorySelection): ContextSummary {
    return contextSummary(resolveSelection(CATALOG, selection));
  }

  it('puts who is competing on the first line and what is compared on the second', () => {
    // The split is the whole reason there are two lines: the first half does not
    // change within a season, the second is the half a lifter opens the editor
    // for. Reading them as one string is how a summary becomes a paragraph.
    expect(summarise(CHOSEN)).toEqual({
      competition: 'Female · Raw · Tested',
      scope: '56 kg · Open only',
    });
  });

  it('joins two weight classes with "and", not with the separator', () => {
    // They are being compared, not listed, and the report puts them in adjacent
    // columns under exactly this pairing. A middle dot would read as a third
    // answer alongside the divisions.
    expect(summarise({ ...CHOSEN, comparisonWeightClass: 'f-52' }).scope).toContain(
      '52 kg and 56 kg',
    );
  });

  it('names the chosen division before Open, in the order the matrix rows use', () => {
    // A summary that named them the other way round is one a reader has to
    // re-map against the table underneath it.
    expect(summarise({ ...CHOSEN, division: 'masters-1' }).scope).toContain('Masters 1 and Open');
  });

  it('says "Open only" rather than "Open" when no division was chosen', () => {
    // The matrices deliberately decline to name a lone division -- naming it
    // claims the federation singled that division out. Echoing a bare "Open"
    // here would be the summary asserting what the report will not.
    const scope = summarise(CHOSEN).scope;
    expect(scope).toContain('Open only');
    expect(scope).not.toMatch(/(^|·\s)Open($|\s·)/u);
  });

  it('adds the region once one is chosen and omits it otherwise', () => {
    expect(summarise(CHOSEN).scope).not.toContain('North Example');
    expect(summarise({ ...CHOSEN, region: 'north-example' }).scope).toContain('North Example');
  });

  it('summarises a half-answered context without inventing the missing parts', () => {
    // Reachable: the editor is open on a context a lifter is midway through
    // changing, and this is what the button behind it says. A placeholder for an
    // unanswered question would be a summary claiming an answer.
    expect(summarise({ ...NO_SELECTION, sex: 'female' })).toEqual({
      competition: 'Female',
      scope: 'Open only',
    });
  });

  it('leaves the competition line empty when nothing has been answered', () => {
    // The scope line still says "Open only", because that is true of an
    // unanswered division picker and is not derived from anything the lifter
    // has to have said -- the divisions a catalogue publishes do not depend on
    // the sex category. The competition line has nothing to state and states
    // nothing; the element leads its accessible name with "Edit context" so a
    // reader is not handed a bare "Open only" as the name of the control.
    expect(summarise(NO_SELECTION)).toEqual({ competition: '', scope: 'Open only' });
  });

  it('says nothing about divisions when the catalogue publishes none', () => {
    // Not "Open only". That sentence claims a federation drew a distinction it
    // did not draw, which is the same mistake the matrices avoid by declining
    // to label a lone division row.
    const noDivisions: CategoryCatalog = {
      ...CATALOG,
      ageDivisions: { ...CATALOG.ageDivisions, divisions: [] },
    };
    expect(contextSummary(resolveSelection(noDivisions, CHOSEN)).scope).toBe('56 kg');
  });

  it('drops an answer the catalogue does not offer instead of echoing it', () => {
    // It resolves rather than reading the request, which is the reason it lives
    // here and not in the element. A summary naming the class the report was
    // *asked* for, while the report is drawn for the class the resolver kept, is
    // worse than no summary at all.
    expect(summarise({ ...CHOSEN, weightClass: 'm-75' }).scope).not.toContain('75 kg');
  });
});
