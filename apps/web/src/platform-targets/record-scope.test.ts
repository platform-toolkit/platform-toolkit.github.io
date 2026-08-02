import { describe, expect, it } from 'vitest';

import { NO_RECORD_SCOPE, resolveRecordScope, type RecordScopeSelection } from './record-scope.js';
import { CATALOG } from './records-fixture.js';

function asked(requested: Partial<RecordScopeSelection> = {}): RecordScopeSelection {
  return { ...NO_RECORD_SCOPE, ...requested };
}

function fields(requested: Partial<RecordScopeSelection> = {}): readonly string[] {
  return resolveRecordScope(CATALOG, asked(requested)).questions.map((question) => question.field);
}

describe('resolveRecordScope', () => {
  it('asks the level and the event before anything is chosen', () => {
    expect(fields()).toEqual(['level', 'discipline']);
  });

  it('asks the region only once a subdivided level is chosen', () => {
    expect(fields({ level: 'state' })).toEqual(['level', 'region', 'discipline']);
  });

  /**
   * The case a rendered-empty region question would get wrong. A level with no
   * regions is not a level whose region question has no answers -- it has no
   * region question, and printing an empty "Region" under "National" reads as
   * missing data when it is the correct and complete state.
   */
  it('omits the region question entirely for a level that is not subdivided', () => {
    expect(fields({ level: 'national' })).toEqual(['level', 'discipline']);
  });

  it('settles the partition of an unsubdivided level without a region', () => {
    const scope = resolveRecordScope(CATALOG, asked({ level: 'national' }));
    expect(scope.partition).toEqual({ levelId: 'national', regionId: null });
  });

  /**
   * The distinction the whole `RecordPartition` type exists for. That artifact
   * is published and holds nothing -- the publisher writes a record's own
   * region, and a state record always has one -- so asking for it would return
   * an empty book, which the panel renders as "no record stands in this
   * category". A sentence nobody investigates.
   */
  it('refuses a partition for a subdivided level with no region chosen', () => {
    expect(resolveRecordScope(CATALOG, asked({ level: 'state' })).partition).toBeNull();
  });

  it('settles the partition once the region is chosen too', () => {
    const scope = resolveRecordScope(CATALOG, asked({ level: 'state', region: 'south-example' }));
    expect(scope.partition).toEqual({ levelId: 'state', regionId: 'south-example' });
  });

  it('has no partition while the level is unanswered', () => {
    expect(resolveRecordScope(CATALOG, asked({ discipline: 'full-power' })).partition).toBeNull();
  });

  /**
   * A lifter looks at their state records, switches to the national tables, and
   * comes back. The request keeps "south-example" -- the caller stores what was
   * asked for, not what resolved -- so the answer returns with the level.
   */
  it('drops a region the chosen level does not offer, without destroying the request', () => {
    const requested = asked({ level: 'national', region: 'south-example' });
    expect(resolveRecordScope(CATALOG, requested).selection.region).toBeNull();

    const back = resolveRecordScope(CATALOG, { ...requested, level: 'state' });
    expect(back.selection.region).toBe('south-example');
  });

  it('drops a level the catalogue does not publish', () => {
    expect(resolveRecordScope(CATALOG, asked({ level: 'galactic' })).selection.level).toBeNull();
  });

  it('carries the lifts the chosen event contests, not all four', () => {
    expect(resolveRecordScope(CATALOG, asked({ discipline: 'bench-only' })).lifts).toEqual([
      'bench',
    ]);
    expect(resolveRecordScope(CATALOG, asked({ discipline: 'push-pull' })).lifts).toEqual([
      'bench',
      'deadlift',
      'total',
    ]);
  });

  it('has no lifts until an event is chosen', () => {
    expect(resolveRecordScope(CATALOG, asked({ level: 'national' })).lifts).toEqual([]);
  });

  /**
   * The catalogue names the lifts; the labels never guess from the event's name.
   * "Push pull" says nothing about a total to a lifter who has not met the term.
   */
  it('describes each event by the lifts it holds records in', () => {
    const scope = resolveRecordScope(CATALOG, asked());
    const question = scope.questions.find((candidate) => candidate.field === 'discipline');
    expect(question?.choices.map((choice) => choice.description)).toEqual([
      'Records in the squat, bench press, deadlift and total.',
      'Records in the bench press.',
      'Records in the bench press, deadlift and total.',
    ]);
  });

  it('is complete only once every question it asked has an answer', () => {
    expect(resolveRecordScope(CATALOG, asked()).complete).toBe(false);
    expect(
      resolveRecordScope(CATALOG, asked({ level: 'national', discipline: 'full-power' })).complete,
    ).toBe(true);
    // Two of three, and the third is the one only a subdivided level asks.
    expect(
      resolveRecordScope(CATALOG, asked({ level: 'state', discipline: 'full-power' })).complete,
    ).toBe(false);
  });

  /**
   * A federation that publishes no levels at all. The question is still asked --
   * a missing question is indistinguishable from an answered one to anything
   * downstream -- and it says so rather than being satisfied by vacuum.
   */
  it('cannot be completed by a question with no answers', () => {
    const empty = { ...CATALOG, levels: [] };
    const scope = resolveRecordScope(empty, asked({ discipline: 'full-power' }));
    expect(scope.complete).toBe(false);
    expect(scope.questions.map((question) => question.field)).toEqual(['level', 'discipline']);
  });
});
