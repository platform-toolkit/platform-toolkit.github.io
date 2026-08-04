// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §22 as a value. The two elements are `ptk-meet-prep` and `ptk-meet-checklist`.
 *
 * Three things here are worth more than the rest and are tested hardest.
 *
 * The **applicability table** is a list of claims about the sport ("a deadlift-
 * only meet has no rack to confirm"), and every one is checked on its own as
 * well as through the row that uses it -- a predicate tested only through its
 * row passes when the wrong row is wired to the right claim.
 *
 * **A tick outliving its row** is the behaviour a reader would most likely
 * "fix", so it is pinned with the sequence that makes it matter rather than with
 * an assertion about a set.
 *
 * **`parseTimeOfDay`** decides whether somebody arrives at the weigh-in, and
 * every branch of it is a way to be an hour or twelve out. The midday cases are
 * separate tests because 12 am and 12 pm are the two the pattern gets wrong.
 */
import { describe, expect, it } from 'vitest';

import {
  CHECKLIST_ITEM_IDS,
  CUSTOM_ITEM_MAX,
  EMPTY_PREP,
  PREP_NOTES_MAX,
  SETUP_LABEL_MAX,
  SETUP_NOTE_MAX,
  addCustomItem,
  appliesWhen,
  checklistFor,
  checklistProgress,
  handoffFromValue,
  parseTimeOfDay,
  prepNotesProblem,
  problemFor,
  removeCustomItem,
  setupProblems,
  squatStartFromValue,
  withCheckedRows,
  withChecklistItem,
  withLifterSetup,
  withPrepNotes,
  withSetupAnswer,
  type ChecklistContext,
  type MeetPrep,
} from './prep.js';

/** A full-power raw meet with no record ambitions: the ordinary case. */
const ORDINARY: ChecklistContext = {
  format: 'full-power',
  equipment: 'raw',
  goal: 'balanced',
};

function context(patch: Partial<ChecklistContext> = {}): ChecklistContext {
  return { ...ORDINARY, ...patch };
}

/** Which rows a meet offers, as ids, so a test can name what it expects. */
function idsFor(prep: MeetPrep, ctx: ChecklistContext): string[] {
  return checklistFor(prep, ctx).map((row) => row.itemId);
}

function ticked(prep: MeetPrep, ctx: ChecklistContext): string[] {
  return checklistFor(prep, ctx)
    .filter((row) => row.done)
    .map((row) => row.itemId);
}

describe('the checklist table', () => {
  it('has every row §22.2 lists, once each', () => {
    // The table is hand-written and its ids are saved to disk (§24), so a
    // duplicate is a row that can never be ticked independently and a rename is
    // a tick that silently detaches. Both are invisible on screen.
    expect(CHECKLIST_ITEM_IDS).toHaveLength(23);
    expect(new Set(CHECKLIST_ITEM_IDS).size).toBe(23);
  });

  it('offers the whole list to a full-power meet that wants everything', () => {
    // The one context in which nearly every conditional row applies, so this is
    // where a row wired to the wrong condition shows up as an absence.
    const everything = context({ equipment: 'single-ply', goal: 'record-attempt' });

    expect(idsFor(EMPTY_PREP, everything)).toHaveLength(23);
  });
});

describe('appliesWhen', () => {
  it('puts the unconditional rows on every list', () => {
    for (const format of ['full-power', 'push-pull', 'bench-only', 'deadlift-only'] as const) {
      expect(appliesWhen('always', context({ format }))).toBe(true);
    }
  });

  it('follows the lifts the format actually contests', () => {
    expect(appliesWhen('squats', context({ format: 'full-power' }))).toBe(true);
    expect(appliesWhen('squats', context({ format: 'push-pull' }))).toBe(false);

    expect(appliesWhen('benches', context({ format: 'push-pull' }))).toBe(true);
    expect(appliesWhen('benches', context({ format: 'deadlift-only' }))).toBe(false);

    expect(appliesWhen('deadlifts', context({ format: 'push-pull' }))).toBe(true);
    expect(appliesWhen('deadlifts', context({ format: 'bench-only' }))).toBe(false);
  });

  it('asks for knee sleeves wherever a knee is loaded', () => {
    // Both lifts, not just the squat: a push-pull lifter wears sleeves to pull,
    // and a rule keyed to the squat alone leaves them off the only list they
    // would have read.
    expect(appliesWhen('squats-or-deadlifts', context({ format: 'full-power' }))).toBe(true);
    expect(appliesWhen('squats-or-deadlifts', context({ format: 'push-pull' }))).toBe(true);
    expect(appliesWhen('squats-or-deadlifts', context({ format: 'deadlift-only' }))).toBe(true);
    expect(appliesWhen('squats-or-deadlifts', context({ format: 'bench-only' }))).toBe(false);
  });

  it('only asks for a rack confirmation where there is a rack', () => {
    expect(appliesWhen('uses-a-rack', context({ format: 'full-power' }))).toBe(true);
    expect(appliesWhen('uses-a-rack', context({ format: 'bench-only' }))).toBe(true);
    expect(appliesWhen('uses-a-rack', context({ format: 'push-pull' }))).toBe(true);
    // The one format with nothing to set: a deadlift-only lifter confirming a
    // rack height is a row that cannot be completed, and a list with an
    // impossible row on it teaches people to tick without reading.
    expect(appliesWhen('uses-a-rack', context({ format: 'deadlift-only' }))).toBe(false);
  });

  it('counts only the two equipped divisions as equipped', () => {
    expect(appliesWhen('equipped', context({ equipment: 'single-ply' }))).toBe(true);
    expect(appliesWhen('equipped', context({ equipment: 'multi-ply' }))).toBe(true);

    // Wraps are the trap: a wrapped lifter is a raw lifter with knee wraps, and
    // the row this switches on is a bench shirt and a squat suit.
    expect(appliesWhen('equipped', context({ equipment: 'wraps' }))).toBe(false);
    expect(appliesWhen('equipped', context({ equipment: 'raw' }))).toBe(false);
    expect(appliesWhen('equipped', context({ equipment: 'other' }))).toBe(false);
    expect(appliesWhen('equipped', context({ equipment: 'unstated' }))).toBe(false);
  });

  it('asks for record paperwork only when a record is the goal', () => {
    expect(appliesWhen('record-attempt', context({ goal: 'record-attempt' }))).toBe(true);
    expect(appliesWhen('record-attempt', context({ goal: 'place-or-win' }))).toBe(false);
    // Qualification is the near miss: it is a target with a number attached and
    // no record form to hand in.
    expect(appliesWhen('record-attempt', context({ goal: 'qualification' }))).toBe(false);
  });
});

describe('checklistFor', () => {
  it('drops the rows a bench-only lifter has no use for', () => {
    const ids = idsFor(EMPTY_PREP, context({ format: 'bench-only' }));

    expect(ids).not.toContain('squat-shoes');
    expect(ids).not.toContain('deadlift-shoes');
    expect(ids).not.toContain('deadlift-socks');
    expect(ids).not.toContain('knee-sleeves-or-wraps');
    // And keeps the ones a bench-only meet still needs, which is what stops
    // this reading as "a short format gets a short list".
    expect(ids).toContain('bench-shoes');
    expect(ids).toContain('rack-height-confirmation');
    expect(ids).toContain('singlet');
  });

  it('drops the rack confirmation from a deadlift-only meet', () => {
    const ids = idsFor(EMPTY_PREP, context({ format: 'deadlift-only' }));

    expect(ids).not.toContain('rack-height-confirmation');
    expect(ids).toContain('deadlift-socks');
    expect(ids).toContain('weigh-in');
  });

  it('adds the equipped and record rows only where they belong', () => {
    expect(idsFor(EMPTY_PREP, ORDINARY)).not.toContain('equipped-gear');
    expect(idsFor(EMPTY_PREP, ORDINARY)).not.toContain('record-documentation');

    expect(idsFor(EMPTY_PREP, context({ equipment: 'multi-ply' }))).toContain('equipped-gear');
    expect(idsFor(EMPTY_PREP, context({ goal: 'record-attempt' }))).toContain(
      'record-documentation',
    );
  });

  it('keeps §22.2 packing order inside a group', () => {
    // The requirement's order is a packing order -- identification first, the
    // things that go on top last -- and re-sorting it would be the tool having
    // an opinion about somebody else's bag.
    const ids = idsFor(EMPTY_PREP, ORDINARY);

    expect(ids.indexOf('membership-and-identification')).toBeLessThan(ids.indexOf('singlet'));
    expect(ids.indexOf('singlet')).toBeLessThan(ids.indexOf('belt'));
    expect(ids.indexOf('food')).toBeLessThan(ids.indexOf('printed-backup'));
  });

  it('puts everything to bring before everything to do, and own rows last', () => {
    // Against named rows rather than against the groups the same call reported.
    // Deriving the expected order from `rows` would be an assertion that holds
    // whatever order the module produced -- §13.8's vacuity, in the one test
    // whose whole subject is order.
    const added = addCustomItem(EMPTY_PREP, 'Mouthguard');
    if (!added.ok) throw new Error('The fixture item was refused.');
    const ids = idsFor(added.prep, ORDINARY);

    expect(ids.indexOf('phone-charger')).toBeLessThan(ids.indexOf('equipment-check'));
    expect(ids.indexOf('rules-and-commands-review')).toBeLessThan(ids.indexOf('custom-1'));
    expect(ids.at(-1)).toBe('custom-1');
  });

  it('reports a row as done when its id is ticked', () => {
    const prep = withChecklistItem(EMPTY_PREP, 'belt', true);

    expect(ticked(prep, ORDINARY)).toEqual(['belt']);
  });

  it('reports a row of somebody own as done, and keeps them in the order added', () => {
    // Both found by mutation, and both invisible from the tick set alone. The
    // first is the row a lifter taps that never darkens while the count above
    // it goes up -- every other assertion here reads `prep.done`, which is the
    // state rather than the row. The second is three rows arriving bottom-up:
    // the list is written in the order things occurred to somebody, and a
    // reversal reads as the tool having lost one and added a new one.
    let prep = EMPTY_PREP;
    for (const text of ['Mouthguard', 'Spare singlet', 'Cash for the raffle']) {
      const added = addCustomItem(prep, text);
      if (!added.ok) throw new Error(`"${text}" was refused.`);
      prep = added.prep;
    }
    prep = withChecklistItem(prep, 'custom-2', true);

    const own = checklistFor(prep, ORDINARY).filter((row) => row.group === 'own');

    expect(own.map((row) => (row.kind === 'custom' ? row.text : ''))).toEqual([
      'Mouthguard',
      'Spare singlet',
      'Cash for the raffle',
    ]);
    expect(own.filter((row) => row.done).map((row) => row.itemId)).toEqual(['custom-2']);
  });

  it('keeps a tick on a row the meet has stopped offering', () => {
    // The sequence rather than an assertion about a set, because the sequence is
    // what makes it matter: the socks went in the bag, then the format was
    // corrected, and the socks did not come back out.
    const packed = withChecklistItem(EMPTY_PREP, 'deadlift-socks', true);

    expect(idsFor(packed, context({ format: 'bench-only' }))).not.toContain('deadlift-socks');
    expect(ticked(packed, ORDINARY)).toEqual(['deadlift-socks']);
  });
});

describe('checklistProgress', () => {
  it('counts what is done and what is left', () => {
    let prep = withChecklistItem(EMPTY_PREP, 'belt', true);
    prep = withChecklistItem(prep, 'singlet', true);
    const rows = checklistFor(prep, ORDINARY);

    // Twenty-one rather than twenty-three: an ordinary raw full-power meet with
    // no record attempt drops the equipped gear and the record paperwork.
    expect(checklistProgress(rows)).toEqual({ total: 21, done: 2, remaining: 19 });
  });

  it('counts a group when it is handed one', () => {
    const rows = checklistFor(EMPTY_PREP, ORDINARY).filter((row) => row.group === 'do');

    expect(checklistProgress(rows)).toEqual({ total: 4, done: 0, remaining: 4 });
  });
});

describe('withChecklistItem', () => {
  it('ticks and unticks', () => {
    const on = withChecklistItem(EMPTY_PREP, 'belt', true);
    expect(on.done.has('belt')).toBe(true);

    const off = withChecklistItem(on, 'belt', false);
    expect(off.done.has('belt')).toBe(false);
  });

  it('returns the same session when the answer has not moved', () => {
    // Identity, not equality. A repeated report is ordinary -- `ptk-toggle-group`
    // can emit one -- and a new object for it is a render of the whole checklist
    // under a thumb that is already moving to the next row.
    const on = withChecklistItem(EMPTY_PREP, 'belt', true);

    expect(withChecklistItem(on, 'belt', true)).toBe(on);
    expect(withChecklistItem(EMPTY_PREP, 'belt', false)).toBe(EMPTY_PREP);
  });

  it('leaves every other tick alone', () => {
    let prep = withChecklistItem(EMPTY_PREP, 'belt', true);
    prep = withChecklistItem(prep, 'singlet', true);
    prep = withChecklistItem(prep, 'belt', false);

    expect([...prep.done]).toEqual(['singlet']);
  });
});

describe('withCheckedRows', () => {
  it('reconciles the rows it was given and no others', () => {
    // The reason this exists: a control reports its whole selection, three
    // controls means three selections, and writing one over the state would
    // untick the other two groups. Here the "do" group reports one tick while
    // a "bring" row is already ticked and must survive it.
    const packed = withChecklistItem(EMPTY_PREP, 'belt', true);

    const prep = withCheckedRows(
      packed,
      ['rack-height-confirmation', 'equipment-check', 'weigh-in', 'rules-and-commands-review'],
      ['weigh-in'],
    );

    expect([...prep.done].sort()).toEqual(['belt', 'weigh-in']);
  });

  it('unticks a row inside the group that the report left out', () => {
    const packed = withCheckedRows(EMPTY_PREP, ['belt', 'singlet'], ['belt', 'singlet']);
    const later = withCheckedRows(packed, ['belt', 'singlet'], ['singlet']);

    expect([...later.done]).toEqual(['singlet']);
  });
});

describe('addCustomItem', () => {
  it('adds a trimmed row with an id of its own', () => {
    const added = addCustomItem(EMPTY_PREP, '  Mouthguard  ');
    if (!added.ok) throw new Error('A good item was refused.');

    expect(added.prep.custom).toEqual([{ itemId: 'custom-1', text: 'Mouthguard' }]);
    expect(added.prep.nextCustomOrdinal).toBe(2);
  });

  it('refuses a row that is nothing but space', () => {
    expect(addCustomItem(EMPTY_PREP, '')).toEqual({ ok: false, refusal: 'empty' });
    expect(addCustomItem(EMPTY_PREP, '   ')).toEqual({ ok: false, refusal: 'empty' });
  });

  it('refuses a row too long to read at a glance, and accepts one exactly at the cap', () => {
    const atCap = 'x'.repeat(CUSTOM_ITEM_MAX);
    expect(addCustomItem(EMPTY_PREP, atCap).ok).toBe(true);
    expect(addCustomItem(EMPTY_PREP, `${atCap}x`)).toEqual({ ok: false, refusal: 'too-long' });
  });

  it('measures the cap after trimming', () => {
    // Otherwise a paste with a trailing newline is refused for a length the
    // lifter cannot see and cannot find to remove.
    const atCap = 'x'.repeat(CUSTOM_ITEM_MAX);
    expect(addCustomItem(EMPTY_PREP, ` ${atCap} `).ok).toBe(true);
  });

  it('refuses a duplicate however it was capitalised', () => {
    const first = addCustomItem(EMPTY_PREP, 'Mouthguard');
    if (!first.ok) throw new Error('A good item was refused.');

    expect(addCustomItem(first.prep, 'mouthguard')).toEqual({ ok: false, refusal: 'duplicate' });
    expect(addCustomItem(first.prep, '  MOUTHGUARD ')).toEqual({
      ok: false,
      refusal: 'duplicate',
    });
    expect(addCustomItem(first.prep, 'Mouthguard case').ok).toBe(true);
  });

  it('numbers each new row from the counter, not from the length', () => {
    let prep = EMPTY_PREP;
    for (const text of ['One', 'Two', 'Three']) {
      const added = addCustomItem(prep, text);
      if (!added.ok) throw new Error(`"${text}" was refused.`);
      prep = added.prep;
    }

    expect(prep.custom.map((item) => item.itemId)).toEqual(['custom-1', 'custom-2', 'custom-3']);
  });
});

describe('removeCustomItem', () => {
  it('retires the id rather than reissuing it', () => {
    // A length-based id would hand `custom-2` to the next row, and the tick the
    // removed row left behind would arrive on it already ticked.
    let prep = EMPTY_PREP;
    for (const text of ['One', 'Two']) {
      const added = addCustomItem(prep, text);
      if (!added.ok) throw new Error(`"${text}" was refused.`);
      prep = added.prep;
    }

    prep = removeCustomItem(prep, 'custom-2');
    const again = addCustomItem(prep, 'Three');
    if (!again.ok) throw new Error('"Three" was refused.');

    expect(again.prep.custom.map((item) => item.itemId)).toEqual(['custom-1', 'custom-3']);
  });

  it('takes the tick with the row', () => {
    const added = addCustomItem(EMPTY_PREP, 'Mouthguard');
    if (!added.ok) throw new Error('A good item was refused.');
    const packed = withChecklistItem(added.prep, 'custom-1', true);

    const prep = removeCustomItem(packed, 'custom-1');

    expect(prep.custom).toEqual([]);
    expect([...prep.done]).toEqual([]);
  });

  it('does nothing to a row that is not there', () => {
    expect(removeCustomItem(EMPTY_PREP, 'custom-9')).toBe(EMPTY_PREP);
  });
});

describe('parseTimeOfDay', () => {
  it('reads a twenty-four hour time', () => {
    expect(parseTimeOfDay('09:30')).toEqual({ ok: true, minutes: 570 });
    expect(parseTimeOfDay('9:30')).toEqual({ ok: true, minutes: 570 });
    expect(parseTimeOfDay('21:05')).toEqual({ ok: true, minutes: 1265 });
    expect(parseTimeOfDay('00:00')).toEqual({ ok: true, minutes: 0 });
    expect(parseTimeOfDay('23:59')).toEqual({ ok: true, minutes: 1439 });
  });

  it('reads a twelve hour time, because this tool is built for lifters who write one', () => {
    expect(parseTimeOfDay('8:30 AM')).toEqual({ ok: true, minutes: 510 });
    expect(parseTimeOfDay('8:30am')).toEqual({ ok: true, minutes: 510 });
    expect(parseTimeOfDay('8:30 pm')).toEqual({ ok: true, minutes: 1230 });
  });

  it('puts noon at noon and midnight at midnight', () => {
    // The two the pattern gets wrong. Twelve maps to zero before the pm offset
    // is added, not after, or a noon weigh-in lands at midnight.
    expect(parseTimeOfDay('12:00 am')).toEqual({ ok: true, minutes: 0 });
    expect(parseTimeOfDay('12:30 am')).toEqual({ ok: true, minutes: 30 });
    expect(parseTimeOfDay('12:00 pm')).toEqual({ ok: true, minutes: 720 });
    expect(parseTimeOfDay('12:30 pm')).toEqual({ ok: true, minutes: 750 });
  });

  it('takes a full stop, which is what a phone keypad makes easy', () => {
    expect(parseTimeOfDay('8.30')).toEqual({ ok: true, minutes: 510 });
    expect(parseTimeOfDay('8.30 pm')).toEqual({ ok: true, minutes: 1230 });
  });

  it('says nothing about an empty field, which is not an error', () => {
    expect(parseTimeOfDay('')).toEqual({ ok: false, empty: true });
    expect(parseTimeOfDay('   ')).toEqual({ ok: false, empty: true });
  });

  it('refuses a figure that reads two ways', () => {
    // `830` is 8:30 to a person and one number to everything else. Guessing is
    // how somebody arrives for a weigh-in that finished.
    expect(parseTimeOfDay('830')).toEqual({ ok: false, empty: false });
    expect(parseTimeOfDay('8')).toEqual({ ok: false, empty: false });
    expect(parseTimeOfDay('half eight')).toEqual({ ok: false, empty: false });
    expect(parseTimeOfDay('8:3')).toEqual({ ok: false, empty: false });
    // Also found by mutation: widening the hour to four digits leaves the range
    // checks doing all the work, and `0009:30` slips past them as nine o'clock.
    // An hour of day has one digit or two, and pinning that keeps the pattern
    // saying so rather than relying on arithmetic further down.
    expect(parseTimeOfDay('0009:30')).toEqual({ ok: false, empty: false });
  });

  it('refuses a time that is not one', () => {
    expect(parseTimeOfDay('24:00')).toEqual({ ok: false, empty: false });
    expect(parseTimeOfDay('09:60')).toEqual({ ok: false, empty: false });
    // Thirteen o'clock in the afternoon: a marker means the twelve-hour rules
    // apply, and under them this is a typo rather than 13:00.
    expect(parseTimeOfDay('13:00 pm')).toEqual({ ok: false, empty: false });
    expect(parseTimeOfDay('0:30 am')).toEqual({ ok: false, empty: false });
  });
});

describe('setupProblems', () => {
  it('says nothing about a setup nobody has filled in', () => {
    // §22's whole premise: some of this is not known until the morning, so
    // empty is the ordinary state and not a list of twelve errors.
    expect(setupProblems(EMPTY_PREP.setup)).toEqual([]);
  });

  it('leaves a rack height exactly as it was typed', () => {
    // A rack height is a label on somebody else's rack. The one thing a lifter
    // must never get from this screen is a height they cannot call out.
    const setup = withLifterSetup(EMPTY_PREP, {
      squatRackHeight: 'A4',
      benchRackHeight: '12.5',
      monoliftSetting: '  out 3 / down 2  ',
    }).setup;

    expect(setupProblems(setup)).toEqual([]);
    expect(setup.squatRackHeight).toBe('A4');
    expect(setup.monoliftSetting).toBe('  out 3 / down 2  ');
  });

  it('reports a label past its cap, and accepts one exactly at it', () => {
    const atCap = 'x'.repeat(SETUP_LABEL_MAX);
    expect(setupProblems({ ...EMPTY_PREP.setup, flight: atCap })).toEqual([]);
    expect(setupProblems({ ...EMPTY_PREP.setup, flight: `${atCap}x` })).toEqual([
      { field: 'flight', code: 'too-long', max: SETUP_LABEL_MAX },
    ]);
  });

  it('gives the prose fields the longer cap', () => {
    // Not one cap for everything: the commands are a sentence and a flight is a
    // letter, and a shared bound is either too tight for one or useless for the
    // other.
    const overLabel = 'x'.repeat(SETUP_LABEL_MAX + 1);
    expect(setupProblems({ ...EMPTY_PREP.setup, commands: overLabel })).toEqual([]);

    const overNote = 'x'.repeat(SETUP_NOTE_MAX + 1);
    expect(setupProblems({ ...EMPTY_PREP.setup, commands: overNote })).toEqual([
      { field: 'commands', code: 'too-long', max: SETUP_NOTE_MAX },
    ]);
  });

  it('reports a time it could not read', () => {
    expect(setupProblems({ ...EMPTY_PREP.setup, weighInTime: 'early' })).toEqual([
      { field: 'weighInTime', code: 'time-not-understood', max: null },
    ]);
  });

  it('says nothing when the weigh-in is later in the day than the first lift', () => {
    // A day-before weigh-in makes this true and legal, so a tool that flagged it
    // would be wrong at exactly the meets that weigh in the night before.
    const setup = { ...EMPTY_PREP.setup, weighInTime: '18:00', liftingStartTime: '09:00' };

    expect(setupProblems(setup)).toEqual([]);
  });

  it('reports every problem at once, in field order', () => {
    // Four fields fixed in four passes is what one-error-at-a-time costs, on a
    // screen filled in in whatever order the information arrives.
    const setup = {
      ...EMPTY_PREP.setup,
      flight: 'x'.repeat(SETUP_LABEL_MAX + 1),
      lot: 'y'.repeat(SETUP_LABEL_MAX + 1),
      weighInTime: 'early',
      liftingStartTime: 'later',
    };

    expect(setupProblems(setup).map((problem) => problem.field)).toEqual([
      'flight',
      'lot',
      'weighInTime',
      'liftingStartTime',
    ]);
  });
});

describe('problemFor', () => {
  it('finds the one field a screen is drawing, and reports nothing for the rest', () => {
    const problems = setupProblems({ ...EMPTY_PREP.setup, weighInTime: 'early' });

    expect(problemFor(problems, 'weighInTime')?.code).toBe('time-not-understood');
    expect(problemFor(problems, 'liftingStartTime')).toBeNull();
  });
});

describe('prepNotesProblem', () => {
  // Both sides of the boundary, because a cap sampled only above it passes
  // against a function that refuses everything, and a cap sampled only below it
  // passes against the state this was written to fix -- one announced by the
  // hint and applied by nothing.
  it('takes a note of exactly the cap and refuses the character after it', () => {
    expect(prepNotesProblem('n'.repeat(PREP_NOTES_MAX))).toBeNull();
    expect(prepNotesProblem('n'.repeat(PREP_NOTES_MAX + 1))).toEqual({
      code: 'too-long',
      max: PREP_NOTES_MAX,
    });
  });

  it('quotes its own cap and not the one a setup note is held to', () => {
    // The refusal carries `max` precisely so one sentence can serve both boxes.
    // Quoting `SETUP_NOTE_MAX` here would tell a lifter to cut two thousand
    // characters down to four hundred, in a box that would then accept them.
    expect(prepNotesProblem('n'.repeat(PREP_NOTES_MAX + 1))?.max).toBe(PREP_NOTES_MAX);
    expect(PREP_NOTES_MAX).not.toBe(SETUP_NOTE_MAX);
  });

  it('refuses rather than truncating, and the state keeps every character', () => {
    // §2.4 forbids silent coercion, and the part a truncation would drop is the
    // part the lifter is still typing. So the over-long note is stored whole and
    // the screen says so; nothing here shortens it.
    const long = 'n'.repeat(PREP_NOTES_MAX + 50);

    expect(withPrepNotes(EMPTY_PREP, long).notes).toHaveLength(long.length);
  });
});

describe('the rest of the state', () => {
  it('keeps notes as they were written', () => {
    const prep = withPrepNotes(EMPTY_PREP, 'Ask about the bar for the third.');

    expect(prep.notes).toBe('Ask about the bar for the third.');
    expect(PREP_NOTES_MAX).toBeGreaterThan(CUSTOM_ITEM_MAX);
  });

  it('patches one setup answer without disturbing the others', () => {
    const prep = withLifterSetup(withLifterSetup(EMPTY_PREP, { flight: 'B' }), { lot: '147' });

    expect(prep.setup.flight).toBe('B');
    expect(prep.setup.lot).toBe('147');
  });
});

describe('reading a control', () => {
  it('takes a squat start it recognises and claims nothing about one it does not', () => {
    expect(squatStartFromValue('monolift')).toBe('monolift');
    expect(squatStartFromValue('walkout')).toBe('walkout');
    expect(squatStartFromValue('mono')).toBe('unstated');
  });

  it('takes a handoff preference the same way', () => {
    expect(handoffFromValue('own-handler')).toBe('own-handler');
    // The one that is a real answer rather than the absence of one: a lifter
    // who takes their own unrack has to be able to say so.
    expect(handoffFromValue('no-handoff')).toBe('no-handoff');
    expect(handoffFromValue('spotter')).toBe('unstated');
  });
});

/*
 * WHY THE CONVERSION IS TESTED HERE AND NOWHERE ELSE
 *
 * Thirteen of the sixteen setup answers are free text and three are closed
 * vocabularies, and every one of them arrives at the root as a `string` tagged
 * with a `LifterSetup` key. `withSetupAnswer` is the one place that difference
 * is resolved, and **the compiler cannot check it**: a computed object key is
 * unchecked, so `{ [field]: value }` where `field: keyof LifterSetup` and
 * `value: string` type-checks against `Partial<LifterSetup>` even for the keys
 * whose type is three words long. That was verified by compiling it, twice.
 *
 * Nor can a browser test bite it. Lit commits a property binding only when the
 * bound value changes, so a tile holding `'monolift'` and a tile holding a raw
 * string that was never converted render identically -- and §2.4's silent
 * coercion is exactly what a screen cannot show. So the assertions are here,
 * against the return value, where the wrong answer is visible.
 */
describe('withSetupAnswer', () => {
  it('converts a squat start rather than storing the text of the tile', () => {
    const prep = withSetupAnswer(EMPTY_PREP, 'squatStart', 'monolift');

    expect(prep.setup.squatStart).toBe('monolift');
    // The control that makes the first assertion mean something: a raw string
    // passes `toBe('monolift')` too, so the pair is what separates a converted
    // answer from an unconverted one.
    expect(withSetupAnswer(EMPTY_PREP, 'squatStart', 'mono').setup.squatStart).toBe('unstated');
  });

  it('converts a foot-blocks answer', () => {
    expect(withSetupAnswer(EMPTY_PREP, 'footBlocks', 'yes').setup.footBlocks).toBe('yes');
    expect(withSetupAnswer(EMPTY_PREP, 'footBlocks', 'maybe').setup.footBlocks).toBe('unstated');
  });

  it('converts a handoff preference', () => {
    expect(withSetupAnswer(EMPTY_PREP, 'handoff', 'meet-spotter').setup.handoff).toBe(
      'meet-spotter',
    );
    expect(withSetupAnswer(EMPTY_PREP, 'handoff', 'a friend').setup.handoff).toBe('unstated');
  });

  it('keeps a free-text answer exactly as it was read off the rack', () => {
    // Untrimmed and uncorrected, the same call `ptk-meet-prep` makes: a rack
    // height with a trailing space is one the lifter can see in the box and the
    // crew cannot, and a tool that tidies it is the author of the answer.
    const prep = withSetupAnswer(EMPTY_PREP, 'squatRackHeight', ' 14 ');

    expect(prep.setup.squatRackHeight).toBe(' 14 ');
  });

  it('writes one answer and disturbs none of the other fifteen', () => {
    // The failure a computed key makes easy: the three converted fields are
    // written through a different call from the thirteen text ones, so a
    // mistake in either branch is a form that clears itself as it is filled in.
    const started = withSetupAnswer(withSetupAnswer(EMPTY_PREP, 'flight', 'B'), 'lot', '147');

    const prep = withSetupAnswer(started, 'squatStart', 'walkout');

    expect(prep.setup.squatStart).toBe('walkout');
    expect(prep.setup.flight).toBe('B');
    expect(prep.setup.lot).toBe('147');
  });

  it('writes a setup answer and nothing else in the document', () => {
    const started = withPrepNotes(withChecklistItem(EMPTY_PREP, 'belt', true), 'Stiff bar.');

    const prep = withSetupAnswer(started, 'benchRackHeight', '9');

    expect(prep.setup.benchRackHeight).toBe('9');
    expect(prep.done).toEqual(started.done);
    expect(prep.notes).toBe('Stiff bar.');
  });
});
