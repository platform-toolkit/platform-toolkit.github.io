// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import type { ObservedStanding } from '../types.js';
import { STRUCK_PLACE_CODES, collectStandings, registrationOf, standingKey } from './history.js';
import { entry, wholeYearWindow } from './qualification.fixture.js';

const WINDOW = wholeYearWindow();

/** The one standing a test expected to be the only one. */
function only(standings: readonly ObservedStanding[]): ObservedStanding {
  const [first, ...rest] = standings;
  if (first === undefined || rest.length > 0) {
    throw new Error(`Expected exactly one standing, got ${String(standings.length)}`);
  }
  return first;
}

describe('collectStandings', () => {
  it('keeps only the entries inside the window', () => {
    const standings = collectStandings(
      [entry({ date: '2025-12-31' }), entry({ date: '2026-03-14' }), entry({ date: '2027-01-01' })],
      WINDOW,
    );
    expect(only(standings).entries.map((one) => one.date)).toEqual(['2026-03-14']);
  });

  it('returns nothing at all when the window holds nothing', () => {
    expect(collectStandings([entry({ date: '2024-05-05' })], WINDOW)).toEqual([]);
  });

  it('orders the entries of a standing oldest first', () => {
    const standings = collectStandings(
      [entry({ date: '2026-09-05' }), entry({ date: '2026-02-02' }), entry({ date: '2026-06-06' })],
      WINDOW,
    );
    expect(only(standings).entries.map((one) => one.date)).toEqual([
      '2026-02-02',
      '2026-06-06',
      '2026-09-05',
    ]);
  });

  it('splits one lifter across every registration they competed under', () => {
    // The sharpest line in the brief: "if there are multiple weight classes or drug
    // test statuses for the same lifter in that time period, show all possible
    // qualifications". Nothing here picks a representative.
    const standings = collectStandings(
      [
        entry({ date: '2026-02-02', weightClassKg: '94', tested: true }),
        entry({ date: '2026-06-06', weightClassKg: '112', tested: true }),
        entry({ date: '2026-09-05', weightClassKg: '112', tested: null }),
      ],
      WINDOW,
    );
    expect(standings).toHaveLength(3);
  });

  it('does not merge a meet nobody annotated with a meet that ran no testing', () => {
    // `tested: null` is an absence of information. Folded into `false` it would put
    // untested standards in front of somebody whose meet was tested and simply not
    // marked, and drug-test status is what a lifter is turned away at weigh-in over.
    const standings = collectStandings(
      [entry({ date: '2026-02-02', tested: null }), entry({ date: '2026-06-06', tested: false })],
      WINDOW,
    );
    expect(standings).toHaveLength(2);
  });
});

describe('the totals a standing reports', () => {
  it('takes the heaviest of each lift across the window', () => {
    const standings = collectStandings(
      [
        entry({ date: '2026-02-02', squatKg: 205, benchKg: 145, deadliftKg: 240, totalKg: 590 }),
        entry({ date: '2026-06-06', squatKg: 200, benchKg: 140, deadliftKg: 255, totalKg: 595 }),
      ],
      WINDOW,
    );
    const standing = only(standings);
    expect(standing.squat?.kilograms).toBe(205);
    expect(standing.bench?.kilograms).toBe(145);
    expect(standing.deadlift?.kilograms).toBe(255);
    expect(standing.total?.kilograms).toBe(595);
  });

  it('cites the meet each best came from', () => {
    const standings = collectStandings(
      [
        entry({ date: '2026-02-02', meetName: 'Invented Winter', benchKg: 145 }),
        entry({ date: '2026-06-06', meetName: 'Invented Summer', benchKg: 140 }),
      ],
      WINDOW,
    );
    expect(only(standings).bench?.source.meetName).toBe('Invented Winter');
  });

  it('breaks a tie towards the earlier meet', () => {
    // Arbitrary in that both meets are equally true, deliberate in that the
    // alternative is a cited meet that changes when an unrelated result is added.
    const standings = collectStandings(
      [
        entry({ date: '2026-02-02', meetName: 'Invented Winter', benchKg: 140 }),
        entry({ date: '2026-06-06', meetName: 'Invented Summer', benchKg: 140 }),
      ],
      WINDOW,
    );
    expect(only(standings).bench?.source.meetName).toBe('Invented Winter');
  });

  it('never reads a missing lift as a zero', () => {
    // A lifter who bombed the squat still made every other lift that day. A zero
    // would put them at the bottom of a ladder they were never on.
    const standings = collectStandings(
      [entry({ squatKg: null, benchKg: 140, deadliftKg: 250, totalKg: null })],
      WINDOW,
    );
    const standing = only(standings);
    expect(standing.squat).toBeNull();
    expect(standing.bench?.kilograms).toBe(140);
  });

  it('reports no total at all where a bombed lift left none', () => {
    const standings = collectStandings([entry({ squatKg: null, totalKg: null })], WINDOW);
    const standing = only(standings);
    expect(standing.total).toBeNull();
    expect(standing.partialTotal).toBeNull();
  });
});

describe('a total made from fewer than three lifts', () => {
  it('is not offered as a total', () => {
    // The heaviest silent wrong answer this tool could give. A `total` standard is
    // the sum of three lifts, so a push/pull total graded against it hands a lifter
    // a grade they have not reached -- and it errs upwards, which is the direction
    // nobody double-checks.
    const standings = collectStandings(
      [entry({ event: 'BD', squatKg: null, benchKg: 150, deadliftKg: 260, totalKg: 410 })],
      WINDOW,
    );
    expect(only(standings).total).toBeNull();
  });

  it('is carried separately so the screen can explain the omission', () => {
    const standings = collectStandings(
      [entry({ event: 'BD', squatKg: null, benchKg: 150, deadliftKg: 260, totalKg: 410 })],
      WINDOW,
    );
    expect(only(standings).partialTotal?.kilograms).toBe(410);
  });

  it('is read from the figures rather than from the event label', () => {
    // `event` is never parsed. These two entries are both filed under `SBD` and one
    // of them records no squat, so the second is not a three-lift total whatever the
    // column says -- which is the whole reason the column is not read.
    const standings = collectStandings(
      [
        entry({ date: '2026-02-02', squatKg: 205, benchKg: 140, deadliftKg: 250, totalKg: 595 }),
        entry({ date: '2026-06-06', squatKg: null, benchKg: 165, deadliftKg: 270, totalKg: 610 }),
      ],
      WINDOW,
    );
    const standing = only(standings);
    expect(standing.total?.kilograms).toBe(595);
    expect(standing.partialTotal?.kilograms).toBe(610);
  });

  it('is not carried where the three-lift total already beats it', () => {
    // Nothing to explain, so nothing is shown. A partial total sitting under a
    // heavier real one reads as a second, worse answer to the same question.
    const standings = collectStandings(
      [
        entry({ date: '2026-02-02', squatKg: 205, benchKg: 140, deadliftKg: 250, totalKg: 595 }),
        entry({ date: '2026-06-06', squatKg: null, benchKg: 120, deadliftKg: 200, totalKg: 320 }),
      ],
      WINDOW,
    );
    expect(only(standings).partialTotal).toBeNull();
  });
});

describe('struck results', () => {
  it('sets aside a disqualification and says so', () => {
    const standings = collectStandings(
      [
        entry({ date: '2026-02-02', place: 'DQ', totalKg: 700, benchKg: 200 }),
        entry({ date: '2026-06-06', place: '1' }),
      ],
      WINDOW,
    );
    const standing = only(standings);
    expect(standing.total?.kilograms).toBe(595);
    expect(standing.setAside).toEqual([
      {
        source: {
          on: '2026-02-02',
          meetName: 'Invented Spring Open',
          federation: 'Invented Federation',
          parentFederation: 'Invented International',
          place: 'DQ',
        },
        reason: 'disqualified',
        place: 'DQ',
      },
    ]);
  });

  it('lists a struck result rather than dropping it', () => {
    // A history that quietly loses a result is one a lifter cannot check against
    // their own memory of the day, and being checkable is the whole job.
    const standings = collectStandings([entry({ place: 'DQ' })], WINDOW);
    const standing = only(standings);
    expect(standing.entries).toHaveLength(1);
    expect(standing.setAside).toHaveLength(1);
  });

  it('reads a lower-case code as the same code', () => {
    const standings = collectStandings([entry({ place: ' dq ' })], WINDOW);
    expect(only(standings).setAside[0]?.place).toBe('DQ');
  });

  it('keeps a guest entry, because guest lifts still count towards the next meet', () => {
    // USPA Item 1.1.8. A guest cannot place or set records at the meet they guest
    // at, and a screen that treated the entry as no entry would under-report exactly
    // the lifter who moved up a class to fill a platform.
    const standings = collectStandings([entry({ place: 'G' })], WINDOW);
    const standing = only(standings);
    expect(standing.setAside).toEqual([]);
    expect(standing.total?.kilograms).toBe(595);
  });

  it('names only the codes that mean the result was struck', () => {
    expect([...STRUCK_PLACE_CODES].sort()).toEqual(['DD', 'DQ', 'NS']);
    expect(STRUCK_PLACE_CODES.has('G')).toBe(false);
  });

  it('leaves a code it has never seen standing', () => {
    // The default is that a recorded lift happened. A new archive code should
    // under-report nothing until somebody has read what it means.
    const standings = collectStandings([entry({ place: 'XX' })], WINDOW);
    expect(only(standings).setAside).toEqual([]);
  });
});

describe('ages and bodyweights', () => {
  it('keeps 39 and "39 or 40" apart', () => {
    // Two different statements, and only one of them settles whether the lifter was
    // a Submaster.
    const standings = collectStandings(
      [
        entry({ date: '2026-02-02', age: { years: 39, approximate: false } }),
        entry({ date: '2026-06-06', age: { years: 39, approximate: true } }),
      ],
      WINDOW,
    );
    expect(only(standings).ages).toEqual([
      { years: 39, approximate: false, on: '2026-02-02' },
      { years: 39, approximate: true, on: '2026-06-06' },
    ]);
  });

  it('records one age once however many meets state it', () => {
    const standings = collectStandings(
      [
        entry({ date: '2026-02-02', age: { years: 41, approximate: false } }),
        entry({ date: '2026-06-06', age: { years: 41, approximate: false } }),
      ],
      WINDOW,
    );
    expect(only(standings).ages).toHaveLength(1);
  });

  it('takes no age from an entry that states none', () => {
    const standings = collectStandings([entry({ age: null })], WINDOW);
    expect(only(standings).ages).toEqual([]);
  });

  it('lists bodyweights ascending, so the lightest weigh-in is first', () => {
    const standings = collectStandings(
      [
        entry({ date: '2026-02-02', bodyweightKg: 93.4 }),
        entry({ date: '2026-06-06', bodyweightKg: 91.2 }),
        entry({ date: '2026-09-05', bodyweightKg: 93.4 }),
      ],
      WINDOW,
    );
    expect(only(standings).bodyweights).toEqual([91.2, 93.4]);
  });

  it('takes no age or bodyweight from a struck result', () => {
    const standings = collectStandings(
      [
        entry({ date: '2026-02-02', place: 'DQ', bodyweightKg: 111, age: null }),
        entry({ date: '2026-06-06', bodyweightKg: 93.4 }),
      ],
      WINDOW,
    );
    expect(only(standings).bodyweights).toEqual([93.4]);
  });
});

describe('standingKey', () => {
  it('keeps two labels that run together as one string apart', () => {
    // ('Raw', 'Wraps') and ('RawWraps', '') are the same string with no separator,
    // and the second standing would disappear into the first leaving a report that
    // is entirely valid and one registration short.
    const run = standingKey(registrationOf(entry({ equipment: 'Raw', division: 'Wraps' })));
    const together = standingKey(registrationOf(entry({ equipment: 'RawWraps', division: null })));
    expect(run).not.toBe(together);
  });

  it('spells the unstated drug-test status as its own token', () => {
    const unstated = standingKey(registrationOf(entry({ tested: null })));
    const untested = standingKey(registrationOf(entry({ tested: false })));
    const tested = standingKey(registrationOf(entry({ tested: true })));
    expect(new Set([unstated, untested, tested]).size).toBe(3);
  });

  it('separates the events, so a push/pull standing is never a full-power one', () => {
    expect(standingKey(registrationOf(entry({ event: 'SBD' })))).not.toBe(
      standingKey(registrationOf(entry({ event: 'BD' }))),
    );
  });

  it('ignores everything that is not a registration axis', () => {
    // The meet, the date and the lifts are not part of who the lifter registered as,
    // so two meets under the same registration are one standing.
    expect(standingKey(registrationOf(entry({ date: '2026-02-02', totalKg: 500 })))).toBe(
      standingKey(registrationOf(entry({ date: '2026-06-06', totalKg: 600 }))),
    );
  });
});

describe('registrationOf', () => {
  it('carries the archive words across untranslated', () => {
    expect(registrationOf(entry())).toEqual({
      sex: 'M',
      equipment: 'Raw',
      division: 'Open',
      ageClass: '40-49',
      weightClassKg: '94',
      tested: true,
      event: 'SBD',
    });
  });
});
