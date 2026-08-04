// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  AGE_BOUNDS,
  EMPTY_SESSION,
  GUIDED_REPS_MAX,
  MEET_DAY_PREFERENCES,
  PLAN_METHODS,
  PRIOR_MEETS_MAX,
  allConfirmed,
  asBoolean,
  confirmMaximum,
  convertFigures,
  evidenceAgeFor,
  hasTypedWeights,
  historyEquipmentFor,
  loadSession,
  maximumSourceFor,
  methodNeedsConfirmation,
  parseCount,
  parseWeight,
  researchEquipmentFor,
  saveSession,
  sessionLifts,
  withExtras,
  withFigures,
  withSetup,
  withTargetTotal,
  withTargets,
  withUnit,
  type PlanMethod,
  type PlannerSession,
} from './session.js';
import {
  createPreferenceStore,
  memoryPreferenceStorage,
  type PreferenceStore,
} from '@platform-toolkit/preferences';

function store(): PreferenceStore {
  return createPreferenceStore(memoryPreferenceStorage());
}

/**
 * A session with three maximums typed and every lift agreed to.
 *
 * Every figure is typed before anything is confirmed, in that order deliberately:
 * under Target Total typing the bench clears the squat's tick, so a fixture that
 * interleaved the two would hand back a session with two lifts unconfirmed and
 * every assertion below would be measuring the fixture.
 */
function confirmedSession(method: PlanMethod = 'expected-max'): PlannerSession {
  const lifts = ['squat', 'bench', 'deadlift'] as const;
  let session = withSetup(EMPTY_SESSION, { method });
  for (const lift of lifts) {
    session = withFigures(session, lift, { expectedMaximum: '200', ceiling: '220' });
  }
  for (const lift of lifts) {
    session = confirmMaximum(session, lift, true);
  }
  return session;
}

function confirmations(session: PlannerSession): boolean[] {
  return (['squat', 'bench', 'deadlift'] as const).map((lift) => session.figures[lift].confirmed);
}

describe('sessionLifts', () => {
  it('follows the meet format rather than always naming three', () => {
    expect(sessionLifts(EMPTY_SESSION)).toEqual(['squat', 'bench', 'deadlift']);
    expect(sessionLifts(withSetup(EMPTY_SESSION, { format: 'push-pull' }))).toEqual([
      'bench',
      'deadlift',
    ]);
    expect(sessionLifts(withSetup(EMPTY_SESSION, { format: 'bench-only' }))).toEqual(['bench']);
  });

  it('keeps a lift’s figures when the format stops contesting it', () => {
    // A lifter correcting the format may be correcting it the wrong way round,
    // and either way the squat they typed is still true. Nothing deletes.
    const full = withFigures(EMPTY_SESSION, 'squat', { expectedMaximum: '200' });
    const pushPull = withSetup(full, { format: 'push-pull' });
    expect(sessionLifts(pushPull)).not.toContain('squat');
    expect(pushPull.figures.squat.expectedMaximum).toBe('200');
    // And it comes back on screen unchanged.
    expect(sessionLifts(withSetup(pushPull, { format: 'full-power' }))).toContain('squat');
  });
});

describe('withSetup and §6.3’s goal default', () => {
  it('moves an untouched goal to First Meet when the lifter says it is their first', () => {
    const first = withSetup(EMPTY_SESSION, { firstMeet: true });
    expect(first.setup.goal).toBe('first-meet');
    // The control: the default before the question is answered is Balanced, so
    // the assertion above is the answer doing something.
    expect(EMPTY_SESSION.setup.goal).toBe('balanced');
  });

  it('moves it back to Balanced when they change that answer', () => {
    const first = withSetup(EMPTY_SESSION, { firstMeet: true });
    expect(withSetup(first, { firstMeet: false }).setup.goal).toBe('balanced');
  });

  it('never overrides a goal the lifter chose themselves', () => {
    // §6.3's "unless a previous preference has been saved", which is the same
    // rule seen from inside one session: choosing is what stops the default.
    const chosen = withSetup(EMPTY_SESSION, { goal: 'personal-record' });
    expect(chosen.setup.goalChosen).toBe(true);
    expect(withSetup(chosen, { firstMeet: true }).setup.goal).toBe('personal-record');
  });

  it('treats choosing the goal that was already showing as choosing it', () => {
    // Otherwise a lifter who reads Balanced, agrees with it and taps it finds it
    // silently replaced the moment they answer the question below.
    const chosen = withSetup(EMPTY_SESSION, { goal: 'balanced' });
    expect(withSetup(chosen, { firstMeet: true }).setup.goal).toBe('balanced');
  });

  it('discards every confirmation when the method changes', () => {
    // The methods produce different maximums from the same fields, so a tick made
    // under one of them says nothing about another.
    const session = confirmedSession();
    expect(confirmations(session)).toEqual([true, true, true]);
    expect(confirmations(withSetup(session, { method: 'guided-estimate' }))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('keeps them when the method is set to the one already in use', () => {
    // A re-render that reasserts the current method must not wipe the screen.
    const session = confirmedSession('expected-max');
    expect(confirmations(withSetup(session, { method: 'expected-max' }))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('keeps them when the goal changes, which moves percentages and not the maximum', () => {
    const session = confirmedSession();
    expect(confirmations(withSetup(session, { goal: 'personal-record' }))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('keeps them when the unit changes, and does not touch the figures either', () => {
    const session = confirmedSession();
    const switched = withSetup(session, { unit: 'lb' });
    expect(confirmations(switched)).toEqual([true, true, true]);
    expect(switched.figures.squat.expectedMaximum).toBe('200');
  });
});

describe('confirmation', () => {
  it('is not asked for by the two methods that have nothing to confirm', () => {
    // Known Opener derives its maximum from a weight the lifter already chose;
    // Manual has no maximum in it at all.
    expect(methodNeedsConfirmation('known-opener')).toBe(false);
    expect(methodNeedsConfirmation('manual')).toBe(false);
    for (const method of ['expected-max', 'guided-estimate', 'target-total'] as const) {
      expect(methodNeedsConfirmation(method)).toBe(true);
    }
    // The control that this list is the whole list.
    expect(PLAN_METHODS.filter(methodNeedsConfirmation)).toHaveLength(3);
  });

  it('gates the plan only where the method asks for one', () => {
    expect(allConfirmed(withSetup(EMPTY_SESSION, { method: 'manual' }))).toBe(true);
    expect(allConfirmed(withSetup(EMPTY_SESSION, { method: 'expected-max' }))).toBe(false);
    expect(allConfirmed(confirmedSession())).toBe(true);
  });

  it('only asks the lifts the meet contests', () => {
    // A bench-only lifter cannot be made to agree to a squat maximum they were
    // never shown, which would leave the plan unreachable with nothing to press.
    let session = withSetup(EMPTY_SESSION, { format: 'bench-only', method: 'expected-max' });
    session = confirmMaximum(session, 'bench', true);
    expect(allConfirmed(session)).toBe(true);
    expect(session.figures.squat.confirmed).toBe(false);
  });

  it('is discarded when the figure it was a statement about changes', () => {
    const session = confirmedSession('expected-max');
    const retyped = withFigures(session, 'squat', { expectedMaximum: '230' });
    expect(retyped.figures.squat.confirmed).toBe(false);
    // Only that lift's. The others were confirmed against figures nothing moved.
    expect(confirmations(retyped)).toEqual([false, true, true]);
  });

  it('survives a change to a field the maximum does not depend on', () => {
    // Filling in one more optional box must not make the plan flicker away.
    const session = confirmedSession('expected-max');
    for (const patch of [{ personalRecord: '210' }, { ceiling: '250' }, { opener: '180' }]) {
      expect(withFigures(session, 'squat', patch).figures.squat.confirmed).toBe(true);
    }
  });

  it('is discarded by any part of the guided set under Guided Estimate', () => {
    const session = confirmedSession('guided-estimate');
    const guided = { ...session.figures.squat.guided, reps: '3' };
    expect(withFigures(session, 'squat', { guided }).figures.squat.confirmed).toBe(false);
    // The control: the expected maximum is not what that method reads.
    expect(withFigures(session, 'squat', { expectedMaximum: '999' }).figures.squat.confirmed).toBe(
      true,
    );
  });

  it('clears every lift under Target Total, because one share moves them all', () => {
    // Approving the squat share and then raising the bench expectation would
    // otherwise leave a tick beside a squat figure that changed underneath it.
    const session = confirmedSession('target-total');
    expect(confirmations(withFigures(session, 'bench', { expectedMaximum: '140' }))).toEqual([
      false,
      false,
      false,
    ]);
    expect(confirmations(withFigures(session, 'bench', { ceiling: '150' }))).toEqual([
      false,
      false,
      false,
    ]);
    // And a field the split does not read still leaves them alone.
    expect(confirmations(withFigures(session, 'bench', { personalRecord: '150' }))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('is cleared by a new target total whatever method is open', () => {
    // The lifter may be typing the target before switching to the method.
    for (const method of ['target-total', 'expected-max'] as const) {
      const session = confirmedSession(method);
      expect(confirmations(withTargetTotal(session, '500'))).toEqual([false, false, false]);
    }
  });

  it('is left alone when the target total is set to what it already said', () => {
    const session = withTargetTotal(confirmedSession('target-total'), '500');
    const reconfirmed = confirmMaximum(session, 'squat', true);
    expect(withTargetTotal(reconfirmed, '500').figures.squat.confirmed).toBe(true);
  });

  it('can be withdrawn as well as given', () => {
    const session = confirmedSession();
    expect(confirmMaximum(session, 'squat', false).figures.squat.confirmed).toBe(false);
  });
});

describe('optional information', () => {
  it('keeps the answers to §8’s questions apart from the figures', () => {
    const session = withExtras(EMPTY_SESSION, { readiness: 'reduced', hardCut: 'yes' });
    expect(session.extras.readiness).toBe('reduced');
    expect(session.extras.hardCut).toBe('yes');
    // The cut is its own answer, not a fourth readiness: a lifter can be cutting
    // hard and still expect a normal day.
    expect(withExtras(session, { readiness: 'normal' }).extras.hardCut).toBe('yes');
  });

  it('stores §8.3’s totals without disturbing anything else', () => {
    const session = withTargets(confirmedSession(), { qualifyingTotal: '520' });
    expect(session.targets.qualifyingTotal).toBe('520');
    expect(confirmations(session)).toEqual([true, true, true]);
  });

  it('reads a declined yes/no answer as neither yes nor no', () => {
    // `ConfidenceEvidence` grades a declined answer differently from a "no", and
    // a checkbox cannot say that -- unticked would arrive as `false` and record
    // the lifter as having said their opener has not been tested.
    expect(asBoolean('yes')).toBe(true);
    expect(asBoolean('no')).toBe(false);
    expect(asBoolean('unstated')).toBe(null);
  });

  it('treats an unstated equipment category as equipped, not as raw', () => {
    // The direction that lowers the evidence label rather than raising it.
    // Calling silence "raw" hands a lifter who declined to answer the
    // population-matched label the research reserves for raw lifters.
    expect(researchEquipmentFor('raw')).toBe('raw');
    expect(researchEquipmentFor('unstated')).toBe('equipped');
    for (const category of ['wraps', 'single-ply', 'multi-ply', 'other'] as const) {
      expect(researchEquipmentFor(category)).toBe('equipped');
    }
  });

  it('files wraps apart from equipped, and refuses to file "other" at all', () => {
    // The other collapse of the same category, in the opposite direction on two
    // of the six values -- which is the whole reason there are two functions.
    // The history file keeps wraps separate because a scoped comparison across
    // meets is only worth anything if the meets are the same kind of meet; the
    // research population measured raw and folds wraps in with equipped.
    expect(historyEquipmentFor('wraps')).toBe('wraps');
    expect(researchEquipmentFor('wraps')).toBe('equipped');

    expect(historyEquipmentFor('raw')).toBe('raw');
    expect(historyEquipmentFor('single-ply')).toBe('equipped');
    expect(historyEquipmentFor('multi-ply')).toBe('equipped');

    // "Other" and silence both come out unstated rather than being filed under
    // one of the three. A lifter who picked "other" has said their category is
    // not one of these; guessing puts their meet into a comparison it does not
    // belong in, and a wrong file is the one outcome that is not recoverable.
    expect(historyEquipmentFor('other')).toBe('unstated');
    expect(historyEquipmentFor('unstated')).toBe('unstated');
    expect(researchEquipmentFor('other')).toBe('equipped');
  });
});

describe('reading what was typed', () => {
  it('tells an empty field apart from a wrong one', () => {
    // Three-way, because *ok*, *typed something wrong* and *nothing typed yet*
    // are three different things and only the middle one is a mistake.
    expect(parseWeight('', 'kg')).toEqual({ ok: false, message: null });
    expect(parseWeight('1o5', 'kg').ok).toBe(false);
    expect(parseWeight('1o5', 'kg')).not.toEqual({ ok: false, message: null });
    expect(parseWeight('102.5', 'kg')).toEqual({ ok: true, value: 102.5 });
  });

  it('refuses the numbers `Number` would silently accept', () => {
    // `Number(' 12 ')` is twelve and `Number('')` is zero, so a field cleared
    // mid-thought would otherwise plan for an empty bar.
    for (const text of ['0', '-5', '1e3', ' ']) {
      expect(parseWeight(text, 'kg').ok).toBe(false);
    }
    expect(parseWeight('  102.5  ', 'kg')).toEqual({ ok: true, value: 102.5 });
  });

  it('names the unit on screen in the sentence about the ceiling', () => {
    const message = parseWeight('99999', 'lb');
    expect(message.ok).toBe(false);
    expect(message.ok ? '' : (message.message ?? '')).toContain('lb');
  });

  it('lets a count of zero through where zero is the true answer', () => {
    // A lifter at their first meet has genuinely done none. A shared parser with
    // a floor of one would reject the true answer to §8.1's question.
    expect(parseCount('0', 'meets', { min: 0, max: PRIOR_MEETS_MAX })).toEqual({
      ok: true,
      value: 0,
    });
    // And the default floor still refuses it where a zero is not a thing.
    expect(parseCount('0', 'repetitions', { max: GUIDED_REPS_MAX }).ok).toBe(false);
  });

  it('refuses a count that is not whole and one past each bound', () => {
    expect(parseCount('2.5', 'repetitions', { max: GUIDED_REPS_MAX }).ok).toBe(false);
    expect(
      parseCount(String(GUIDED_REPS_MAX + 1), 'repetitions', { max: GUIDED_REPS_MAX }).ok,
    ).toBe(false);
    expect(parseCount(String(GUIDED_REPS_MAX), 'repetitions', { max: GUIDED_REPS_MAX }).ok).toBe(
      true,
    );
    expect(parseCount(String(AGE_BOUNDS.min - 1), 'years', AGE_BOUNDS).ok).toBe(false);
    expect(parseCount(String(AGE_BOUNDS.min), 'years', AGE_BOUNDS).ok).toBe(true);
  });
});

describe('maximumSourceFor', () => {
  function guided(overrides: { reps?: string; competitionStandard?: 'yes' | 'no' | 'unstated' }) {
    const session = withSetup(EMPTY_SESSION, { method: 'guided-estimate' });
    return withFigures(session, 'squat', {
      guided: {
        ...EMPTY_SESSION.figures.squat.guided,
        weight: '180',
        reps: overrides.reps ?? '1',
        competitionStandard: overrides.competitionStandard ?? 'unstated',
      },
    });
  }

  it('reads the set the lifter described rather than asking a second time', () => {
    expect(maximumSourceFor(guided({ reps: '1', competitionStandard: 'yes' }), 'squat')).toBe(
      'competition-standard-single',
    );
    expect(maximumSourceFor(guided({ reps: '3' }), 'squat')).toBe('low-repetition-estimate');
    expect(maximumSourceFor(guided({ reps: '8' }), 'squat')).toBe('high-repetition-estimate');
  });

  it('puts the boundary between five and six, on both sides of it', () => {
    // Pinned either side rather than sampled, because the two labels are graded
    // differently by §10.1 and a boundary that drifts by one repetition moves a
    // whole band of lifters into the more confident label with nothing on screen
    // to say it happened. Five is the last set an estimator is trusted on.
    expect(maximumSourceFor(guided({ reps: '5' }), 'squat')).toBe('low-repetition-estimate');
    expect(maximumSourceFor(guided({ reps: '6' }), 'squat')).toBe('high-repetition-estimate');
  });

  it('does not call a single competition-standard evidence unless it was one', () => {
    // The one case where reading the repetitions alone grades in the generous
    // direction: a gym single to a different depth is not a platform single.
    expect(maximumSourceFor(guided({ reps: '1', competitionStandard: 'no' }), 'squat')).toBe(
      'lifetime-best',
    );
    expect(maximumSourceFor(guided({ reps: '1', competitionStandard: 'unstated' }), 'squat')).toBe(
      'lifetime-best',
    );
  });

  it('says nothing was stated when the set is not readable yet', () => {
    expect(maximumSourceFor(guided({ reps: '' }), 'squat')).toBe('unstated');
    expect(maximumSourceFor(guided({ reps: 'three' }), 'squat')).toBe('unstated');
  });

  it('uses what §8 was told under every other method', () => {
    const session = withExtras(withSetup(EMPTY_SESSION, { method: 'expected-max' }), {
      maximumSource: 'competition-single',
    });
    expect(maximumSourceFor(session, 'squat')).toBe('competition-single');
    // The control: under Guided Estimate the described set wins over §8, so the
    // two are genuinely different paths rather than one reading the other.
    const both = withExtras(guided({ reps: '3' }), { maximumSource: 'competition-single' });
    expect(maximumSourceFor(both, 'squat')).toBe('low-repetition-estimate');
  });
});

describe('evidenceAgeFor', () => {
  it('prefers the per-set answer, which is the more specific claim', () => {
    const session = withExtras(withSetup(EMPTY_SESSION, { method: 'guided-estimate' }), {
      evidenceAge: 'older',
    });
    const dated = withFigures(session, 'squat', {
      guided: { ...session.figures.squat.guided, age: 'within-eight-weeks' },
    });
    expect(evidenceAgeFor(dated, 'squat')).toBe('within-eight-weeks');
    // Silence on the set is not an answer, so it falls through rather than
    // overriding one the lifter did give.
    expect(evidenceAgeFor(session, 'squat')).toBe('older');
  });

  it('uses §8’s answer under a method that describes no set', () => {
    const session = withExtras(withSetup(EMPTY_SESSION, { method: 'known-opener' }), {
      evidenceAge: 'within-six-months',
    });
    expect(evidenceAgeFor(session, 'squat')).toBe('within-six-months');
  });
});

describe('withUnit', () => {
  it('moves the unit and withdraws every agreement made under the old one', () => {
    const session = confirmedSession();
    // Positive control: the fixture really is confirmed before the unit moves,
    // so a `withUnit` that did nothing at all could not pass this.
    expect(confirmations(session)).toEqual([true, true, true]);

    const pounds = withUnit(session, 'lb');
    expect(pounds.setup.unit).toBe('lb');
    expect(confirmations(pounds)).toEqual([false, false, false]);
  });

  it('leaves the digits exactly where they were', () => {
    // The lifter has not been asked yet, and "keep" is the standing answer, so
    // this transition must not pre-empt either half of the question.
    const squat = withUnit(confirmedSession(), 'lb').figures.squat;
    expect(squat.expectedMaximum).toBe('200');
    expect(squat.ceiling).toBe('220');
  });

  it('hands back the same session when the unit did not change', () => {
    // Otherwise re-rendering the unit control -- which reports the current
    // answer on every pass -- would clear the ticks without the lifter touching
    // anything.
    const session = confirmedSession();
    expect(withUnit(session, 'kg')).toBe(session);
  });

  it('costs nothing on a screen with no weights typed', () => {
    // §6.2 is sixty seconds of taps and the unit is one of them. There is no
    // tick to lose here either: every method that asks for a confirmation asks
    // for a weight first.
    const session = withSetup(EMPTY_SESSION, { firstMeet: false });
    const pounds = withUnit(session, 'lb');
    expect(pounds.setup.unit).toBe('lb');
    expect(pounds.figures).toBe(session.figures);
  });
});

describe('convertFigures', () => {
  it('carries every weight across as the same weight in the other unit', () => {
    let session = withFigures(EMPTY_SESSION, 'squat', {
      expectedMaximum: '200',
      opener: '180',
      ceiling: '220',
      attempts: ['180', '190', '200'],
      personalRecord: '205',
    });
    session = withTargetTotal(session, '500');
    session = withExtras(session, { minimumJump: '2.5', maximumJump: '15' });
    session = withTargets(session, { qualifyingTotal: '480' });

    const pounds = convertFigures(session, 'kg', 'lb');
    expect(Number(pounds.figures.squat.expectedMaximum)).toBeCloseTo(440.92, 1);
    expect(Number(pounds.figures.squat.attempts[2])).toBeCloseTo(440.92, 1);
    expect(Number(pounds.targetTotal)).toBeCloseTo(1102.31, 1);
    expect(Number(pounds.extras.minimumJump)).toBeCloseTo(5.51, 1);
    expect(Number(pounds.targets.qualifyingTotal)).toBeCloseTo(1058.22, 1);
  });

  it('leaves the figures that are not weights on a bar where they are', () => {
    // A bodyweight is weighed in whatever unit the federation weighs in and is
    // never loaded; an age and a meet count are not weights at all.
    const session = withExtras(EMPTY_SESSION, { bodyweight: '82.5', age: '34', priorMeets: '6' });
    const pounds = convertFigures(session, 'kg', 'lb');
    expect(pounds.extras.bodyweight).toBe('82.5');
    expect(pounds.extras.age).toBe('34');
    expect(pounds.extras.priorMeets).toBe('6');
  });

  it('carries an unparseable field across untouched rather than deleting it', () => {
    // The lifter is mid-keystroke in it.
    const session = withFigures(EMPTY_SESSION, 'squat', { expectedMaximum: '20o' });
    expect(convertFigures(session, 'kg', 'lb').figures.squat.expectedMaximum).toBe('20o');
  });

  it('hands back the same session when the unit did not change', () => {
    const session = confirmedSession();
    expect(convertFigures(session, 'kg', 'kg')).toBe(session);
  });

  it('rounds to something a lifter can read and edit', () => {
    const session = withFigures(EMPTY_SESSION, 'squat', { expectedMaximum: '200' });
    const text = convertFigures(session, 'kg', 'lb').figures.squat.expectedMaximum;
    expect(text).not.toContain('440.92452436975694');
    expect(text.split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});

describe('hasTypedWeights', () => {
  it('is false on a screen nobody has filled in', () => {
    // What stops the unit prompt appearing on the first tap of every session.
    expect(hasTypedWeights(EMPTY_SESSION)).toBe(false);
    expect(hasTypedWeights(withExtras(EMPTY_SESSION, { age: '34' }))).toBe(false);
  });

  it('is true for any of the fields a unit change would reinterpret', () => {
    const cases = [
      { expectedMaximum: '200' },
      { opener: '180' },
      { ceiling: '220' },
      { attempts: ['', '190', ''] as const },
    ];
    for (const patch of cases) {
      expect(hasTypedWeights(withFigures(EMPTY_SESSION, 'squat', patch))).toBe(true);
    }
    expect(hasTypedWeights(withTargetTotal(EMPTY_SESSION, '500'))).toBe(true);
    const guided = { ...EMPTY_SESSION.figures.squat.guided, weight: '180' };
    expect(hasTypedWeights(withFigures(EMPTY_SESSION, 'bench', { guided }))).toBe(true);
  });

  it('ignores whitespace, which is not a weight', () => {
    expect(hasTypedWeights(withFigures(EMPTY_SESSION, 'squat', { expectedMaximum: '  ' }))).toBe(
      false,
    );
  });
});

describe('remembered settings', () => {
  it('brings back the setup answers and none of the figures', () => {
    // A bodyweight, an age and a competition maximum are facts about a person
    // rather than settings on a device (§2.3).
    const settings = store();
    let session = withSetup(confirmedSession(), { goal: 'personal-record', unit: 'lb' });
    session = withExtras(session, { comparison: 'female', equipment: 'wraps', bodyweight: '82.5' });
    saveSession(settings, session);

    const restored = loadSession(settings);
    expect(restored.setup.goal).toBe('personal-record');
    expect(restored.setup.unit).toBe('lb');
    expect(restored.extras.comparison).toBe('female');
    expect(restored.extras.equipment).toBe('wraps');
    expect(restored.figures.squat.expectedMaximum).toBe('');
    expect(restored.extras.bodyweight).toBe('');
    expect(confirmations(restored)).toEqual([false, false, false]);
  });

  it('remembers that the goal was chosen, not only what it was', () => {
    // Without the flag a restored goal is silently overwritten the moment the
    // first-meet question is answered -- which is §6.3's "unless a previous
    // preference has been saved" failing to do the one thing it says.
    const settings = store();
    saveSession(settings, withSetup(EMPTY_SESSION, { goal: 'conservative' }));

    const restored = loadSession(settings);
    expect(restored.setup.goalChosen).toBe(true);
    expect(withSetup(restored, { firstMeet: true }).setup.goal).toBe('conservative');
  });

  it('leaves an untouched goal free to follow the first-meet answer', () => {
    const settings = store();
    saveSession(settings, EMPTY_SESSION);
    const restored = loadSession(settings);
    expect(restored.setup.goalChosen).toBe(false);
    expect(withSetup(restored, { firstMeet: true }).setup.goal).toBe('first-meet');
  });

  it('defaults an empty store to kilograms and a full-power meet', () => {
    // Kilograms, unlike tool 2's pound default: attempt cards are written in
    // kilograms, and this screen only exists because there is a meet.
    const restored = loadSession(store());
    expect(restored.setup.unit).toBe('kg');
    expect(restored.setup.format).toBe('full-power');
    expect(restored.setup.goal).toBe('balanced');
  });

  it('offers every goal §6.3 lists, so none is unstorable', () => {
    // A goal missing from the picklist throws on write, which on this path takes
    // the screen down over a setting nobody would miss until they chose it.
    const settings = store();
    for (const goal of [
      'first-meet',
      'conservative',
      'balanced',
      'personal-record',
      'qualification',
      'place-or-win',
      'record-attempt',
      'custom',
    ] as const) {
      settings.write(MEET_DAY_PREFERENCES.goal, goal);
      expect(settings.read(MEET_DAY_PREFERENCES.goal)).toBe(goal);
    }
  });
});
