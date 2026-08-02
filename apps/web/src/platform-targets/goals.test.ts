import {
  createPreferenceStore,
  memoryPreferenceStorage,
  type PreferenceStore,
} from '@platform-toolkit/preferences';
import { describe, expect, it } from 'vitest';

import {
  MAX_GOALS,
  addGoal,
  describeGoal,
  goalKey,
  loadGoals,
  removeGoal,
  saveGoals,
  tagGoal,
  type Goal,
  type GoalTarget,
} from './goals.js';
import { CATALOG, CLASSIFICATIONS } from './records-fixture.js';

function store(): PreferenceStore {
  return createPreferenceStore(memoryPreferenceStorage());
}

/**
 * A classification target, as `report.ts` builds one.
 *
 * Three axes empty rather than absent, which is the case the whole storage shape
 * turns on: a classification has no level, region or event, and a `shape` refuses
 * a missing key outright.
 */
const CLASS_TARGET: GoalTarget = {
  lift: 'squat',
  kind: 'classification',
  kilograms: 150,
  standardId: 'first',
  weightClassId: 'f-56',
  divisionId: 'masters-1',
  levelId: '',
  regionId: '',
  disciplineId: '',
  attempt: 'none',
};

/** A record target for the subdivided level, so the region reaches the title. */
const RECORD_TARGET: GoalTarget = {
  lift: 'squat',
  kind: 'record',
  kilograms: 130.5,
  standardId: '',
  weightClassId: 'f-56',
  divisionId: 'open',
  levelId: 'state',
  regionId: 'north-example',
  disciplineId: 'full-power',
  attempt: 'chip',
};

/** A target as it looks once saved, for the resolver, which never adds one. */
function one(target: GoalTarget): Goal {
  return { ...target, tag: 'none' };
}

function saved(target: GoalTarget): readonly Goal[] {
  const outcome = addGoal([], target);
  if (outcome.kind !== 'added') {
    throw new Error(`Expected the fixture target to save, got ${outcome.kind}.`);
  }
  return outcome.goals;
}

describe('addGoal', () => {
  it('files a new target under no horizon', () => {
    // The default is not a lesser answer: a goal set between two working sets is
    // saved in one tap, and asking which horizon it belongs to is a second
    // decision nobody came for.
    const outcome = addGoal([], CLASS_TARGET);
    expect(outcome.kind).toBe('added');
    expect(outcome.kind === 'added' ? outcome.goals : []).toStrictEqual([
      { ...CLASS_TARGET, tag: 'none' },
    ]);
  });

  it('reports a second press as already saved rather than as a second goal', () => {
    const goals = saved(CLASS_TARGET);
    expect(addGoal(goals, CLASS_TARGET)).toStrictEqual({
      kind: 'already-saved',
      key: goalKey(CLASS_TARGET),
    });
  });

  it('treats a revised figure as the same goal', () => {
    // The federation republishing a standard must not leave a lifter with two
    // rows naming one target, one of which is a weight nobody is aiming at any
    // more. The weight is out of the key for exactly this.
    const goals = saved(CLASS_TARGET);
    expect(addGoal(goals, { ...CLASS_TARGET, kilograms: 152.5 }).kind).toBe('already-saved');
  });

  it('keeps two attempts on one record apart', () => {
    // The two figures under a record are two different commitments -- one takes
    // it at this level, one takes it above -- so the attempt is in the key.
    const goals = saved(RECORD_TARGET);
    const outcome = addGoal(goals, { ...RECORD_TARGET, attempt: 'full-increment' });
    expect(outcome.kind).toBe('added');
    expect(outcome.kind === 'added' ? outcome.goals.length : 0).toBe(2);
  });

  it('refuses the twenty-first rather than dropping the oldest', () => {
    const full = Array.from({ length: MAX_GOALS }, (_unused, index) => ({
      ...CLASS_TARGET,
      standardId: `s-${String(index)}`,
      tag: 'none' as const,
    }));
    expect(addGoal(full, { ...CLASS_TARGET, standardId: 's-extra' })).toStrictEqual({
      kind: 'full',
    });
  });

  it('refuses an identifier no federation could have published', () => {
    // Reported rather than degraded. `session.ts` drops one unusable answer and
    // keeps the rest, which is right for a picker and wrong here: a goal missing
    // its division is a goal for a category nobody chose.
    expect(addGoal([], { ...CLASS_TARGET, divisionId: 'Masters 1' })).toStrictEqual({
      kind: 'unstorable',
    });
  });

  it('refuses a weight outside anything a platform has seen', () => {
    expect(addGoal([], { ...CLASS_TARGET, kilograms: 0 }).kind).toBe('unstorable');
  });

  it('appends rather than sorting', () => {
    const first = saved(CLASS_TARGET);
    const outcome = addGoal(first, { ...CLASS_TARGET, standardId: 'third', kilograms: 100 });
    const goals = outcome.kind === 'added' ? outcome.goals : [];
    expect(goals.map((goal) => goal.standardId)).toStrictEqual(['first', 'third']);
  });
});

describe('removeGoal', () => {
  it('takes out the one named and leaves the rest', () => {
    const goals = [...saved(CLASS_TARGET), ...saved(RECORD_TARGET)];
    expect(removeGoal(goals, goalKey(CLASS_TARGET))).toStrictEqual([
      { ...RECORD_TARGET, tag: 'none' },
    ]);
  });

  it('changes nothing when the key is not on the list', () => {
    const goals = saved(CLASS_TARGET);
    expect(removeGoal(goals, goalKey(RECORD_TARGET))).toStrictEqual(goals);
  });
});

describe('tagGoal', () => {
  it('files a saved goal under a horizon without making it a different goal', () => {
    const goals = tagGoal(saved(CLASS_TARGET), goalKey(CLASS_TARGET), 'next-meet');
    expect(goals[0]?.tag).toBe('next-meet');
    // Still the same key, so the cell it came from still reads as saved.
    expect(addGoal(goals, CLASS_TARGET).kind).toBe('already-saved');
  });
});

describe('loadGoals', () => {
  it('opens empty on a first visit', () => {
    expect(loadGoals(store())).toStrictEqual([]);
  });

  it('round trips every axis a goal carries', () => {
    const remembering = store();
    const goals = [...saved(CLASS_TARGET), ...saved(RECORD_TARGET)];
    saveGoals(remembering, goals);
    expect(loadGoals(remembering)).toStrictEqual(goals);
  });

  it('reads back nothing when the device remembers nothing', () => {
    // The supported no-storage mode (§5.12): a framed copy with storage denied
    // shows the report and an empty tray, not a failure.
    const forgetful = createPreferenceStore(null);
    saveGoals(forgetful, saved(CLASS_TARGET));
    expect(loadGoals(forgetful)).toStrictEqual([]);
  });
});

describe('describeGoal', () => {
  const vocabulary = { catalog: CATALOG, classifications: CLASSIFICATIONS };

  it('names a classification by the level the book publishes it as', () => {
    // Not from the catalogue, which holds every other axis and not this one.
    expect(describeGoal(one(CLASS_TARGET), vocabulary)).toStrictEqual({
      title: 'Class I',
      scope: 'Squat · 56 kg · Masters 1',
      attemptLabel: null,
    });
  });

  it('names a record the way the row it was set in was headed', () => {
    expect(describeGoal(one(RECORD_TARGET), vocabulary)).toStrictEqual({
      title: 'North Example State record',
      scope: 'Squat · Full power · 56 kg · Open',
      attemptLabel: 'Chip target',
    });
  });

  it('omits the region for a level that is not subdivided', () => {
    const national = one({ ...RECORD_TARGET, levelId: 'national', regionId: '' });
    expect(describeGoal(national, vocabulary).title).toBe('National record');
  });

  it('leaves out what it cannot resolve rather than printing a slug', () => {
    // A tray reading "Class I · f-56" has shown a lifter an internal identifier.
    // One reading "Squat" has shown less and lied about nothing, and the rest
    // reappears the moment the artifact naming it lands.
    const nothingLoaded = { catalog: null, classifications: null };
    expect(describeGoal(one(CLASS_TARGET), nothingLoaded)).toStrictEqual({
      title: 'Classification standard',
      scope: 'Squat',
      attemptLabel: null,
    });
    expect(describeGoal(one(RECORD_TARGET), nothingLoaded).title).toBe('Record');
  });
});
