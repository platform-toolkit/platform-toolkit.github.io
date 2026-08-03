// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The technique catalogue, and the promise that it only ever changes the words.
 *
 * The claim worth testing here is a negative one: no entry carries a
 * coefficient, a multiplier, or anything else that could quietly move a number.
 * A `match` and a sentence are the whole of what a technique contributes, and
 * the day somebody adds `factor: 0.95` to make touch-and-go "comparable" is the
 * day this tool starts inventing a competition bench nobody performed.
 */
import { describe, expect, it } from 'vitest';

import { ESTIMATE_LIFTS } from './one-rep-max-formulas.js';
import { defaultTechniqueFor, findTechnique, techniquesFor } from './one-rep-max-technique.js';

describe('the technique catalogue', () => {
  it('carries nothing but an identifier, a label, a match and a sentence', () => {
    // The structural guard against a correction factor arriving later. Nobody
    // has a defensible coefficient for knee wraps, and a single figure with a
    // guess folded into it gives a lifter no way to see the guess.
    for (const lift of ESTIMATE_LIFTS) {
      for (const option of techniquesFor(lift)) {
        expect(Object.keys(option).sort(), `${lift}/${option.id}`).toEqual([
          'id',
          'label',
          'match',
          'note',
        ]);
      }
    }
  });

  it('gives every option a sentence saying what the estimate describes', () => {
    for (const lift of ESTIMATE_LIFTS) {
      for (const option of techniquesFor(lift)) {
        expect(option.note, `${lift}/${option.id}`).toContain('estimate describes');
      }
    }
  });

  it('offers unique identifiers within a lift', () => {
    for (const lift of ESTIMATE_LIFTS) {
      const ids = techniquesFor(lift).map((option) => option.id);
      expect(new Set(ids).size, lift).toBe(ids.length);
    }
  });

  it('starts each lift on the answer that matches the intended maximum', () => {
    for (const lift of ESTIMATE_LIFTS) {
      expect(defaultTechniqueFor(lift)?.match, lift).toBe('matches');
    }
  });

  it('asks an unnamed lift about the standard rather than about the variation', () => {
    // "Which variation was it" has no answer for a movement this tool cannot
    // name. The answerable question is whether the intended maximum uses the
    // same movement standard as the set, which is the part that changes what the
    // estimate describes -- so `other` gets three options rather than none.
    const options = techniquesFor('other');
    expect(options.map((option) => option.match)).toEqual(['matches', 'differs', 'unsure']);
    expect(defaultTechniqueFor('other')?.id).toBe('other-same-standard');
  });

  it('carries no field for a typed exercise name, anywhere', () => {
    // Deliberate, and the reason is `packages/preferences`: it has no builder
    // that admits free text, so a name could be typed and could not survive the
    // refresh everything else on the screen survives. A label that vanishes
    // while the numbers stay is worse than no label, and the name changes no
    // arithmetic. If a text builder ever lands, this is the test that has to be
    // deleted on purpose rather than the omission nobody notices.
    for (const option of techniquesFor('other')) {
      expect(Object.keys(option)).not.toContain('name');
    }
  });

  it('counts both deadlift stances as competition lifts', () => {
    // Neither is the "real" one, which is worth stating because a lifter who
    // pulls sumo has been told otherwise.
    expect(findTechnique('deadlift', 'conventional')?.match).toBe('matches');
    expect(findTechnique('deadlift', 'sumo')?.match).toBe('matches');
    expect(findTechnique('deadlift', 'sumo')?.note).toContain('Both stances are legal');
  });

  it('scopes lookup to the lift, so a stored choice cannot cross over', () => {
    expect(findTechnique('bench-press', 'touch-and-go')).not.toBeNull();
    // The same identifier against a squat is a wiring fault, and `null` is what
    // lets `estimateOneRepMax` report it rather than silently honour it.
    expect(findTechnique('squat', 'touch-and-go')).toBeNull();
    expect(findTechnique('squat', '')).toBeNull();
  });

  it('marks every non-competition variation as differing', () => {
    // `differs` is about competition, not about quality: a deficit deadlift is a
    // fine exercise and still produces a number nobody would open with.
    for (const id of ['knee-wraps', 'above-depth', 'paused-or-tempo']) {
      expect(findTechnique('squat', id)?.match, id).toBe('differs');
    }
    for (const id of ['touch-and-go', 'close-grip', 'feet-up-or-larsen']) {
      expect(findTechnique('bench-press', id)?.match, id).toBe('differs');
    }
    for (const id of ['straps', 'deficit-or-blocks']) {
      expect(findTechnique('deadlift', id)?.match, id).toBe('differs');
    }
    for (const id of ['push-press', 'seated-press']) {
      expect(findTechnique('overhead-press', id)?.match, id).toBe('differs');
    }
  });

  it('ends each lift on an unsure option, because not knowing is an answer', () => {
    for (const lift of ESTIMATE_LIFTS) {
      const options = techniquesFor(lift);
      expect(options[options.length - 1]?.match, lift).toBe('unsure');
    }
  });
});
