// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  createPreferenceStore,
  memoryPreferenceStorage,
  type PreferenceStore,
} from '@platform-toolkit/preferences';
import { describe, expect, it } from 'vitest';

import { NO_SELECTION, type CategorySelection } from './selection.js';
import { forgetContext, loadSettings, saveContext, saveView } from './session.js';

function store(): PreferenceStore {
  return createPreferenceStore(memoryPreferenceStorage());
}

/**
 * A context a lifter could actually have answered.
 *
 * Identifiers rather than invented ones, because the round trip being tested is
 * about the *shapes* federations publish -- a fractional weight class is the
 * case that a pattern without a dot silently drops.
 */
const ANSWERED: CategorySelection = {
  sex: 'female',
  equipment: 'raw',
  tested: 'tested',
  weightClass: 'f-67.5',
  comparisonWeightClass: 'f-75',
  division: 'master-50-54',
  region: 'alabama',
};

describe('loadSettings', () => {
  it('answers with nothing chosen on a first visit', () => {
    const settings = loadSettings(store());
    expect(settings.context).toStrictEqual(NO_SELECTION);
    // The squat's classifications: the half of the tool that applies to every
    // lifter, on the first lift of a meet.
    expect(settings.lift).toBe('squat');
    expect(settings.targetType).toBe('classifications');
  });

  it('restores every answer a lifter gave', () => {
    const remembering = store();
    saveContext(remembering, ANSWERED);
    expect(loadSettings(remembering).context).toStrictEqual(ANSWERED);
  });

  it('restores the four optional answers as unanswered rather than as guesses', () => {
    // The case the empty-string spelling exists for. A lifter who only answered
    // the required four must come back to the required four -- a `shape` refuses
    // a missing key outright, so without a value meaning "not picked" this read
    // would fall back and lose the weight class as well.
    const remembering = store();
    const required: CategorySelection = {
      ...NO_SELECTION,
      sex: 'female',
      equipment: 'raw',
      tested: 'tested',
      weightClass: 'f-67.5',
    };
    saveContext(remembering, required);
    expect(loadSettings(remembering).context).toStrictEqual(required);
  });

  it('restores where the two navigation bars were left', () => {
    const remembering = store();
    saveView(remembering, 'deadlift', 'records');
    const settings = loadSettings(remembering);
    expect(settings.lift).toBe('deadlift');
    expect(settings.targetType).toBe('records');
  });

  it('reads back the fallbacks when the device remembers nothing', () => {
    // Not an error and not a branch the caller writes: a third-party iframe with
    // storage denied is a supported mode (§5.12), and the tool has to open on the
    // setup screen rather than on a failure.
    const forgetful = createPreferenceStore(null);
    saveContext(forgetful, ANSWERED);
    expect(loadSettings(forgetful).context).toStrictEqual(NO_SELECTION);
  });
});

describe('saveContext', () => {
  it('drops an answer the store cannot hold instead of taking the screen down', () => {
    // A write violating its own definition throws by design, which is right for a
    // caller bug and wrong for a value the federation chose: this runs when a
    // lifter presses Show targets, and losing the report over an oddly spelled
    // identifier costs them everything on screen rather than one picker.
    const remembering = store();
    saveContext(remembering, { ...ANSWERED, region: 'New York' });
    const restored = loadSettings(remembering).context;
    expect(restored.region).toBeNull();
    expect(restored.weightClass).toBe('f-67.5');
  });

  it('replaces the whole context rather than merging into the last one', () => {
    // A lifter who clears their comparison class and applies must not find it
    // back on the next visit.
    const remembering = store();
    saveContext(remembering, ANSWERED);
    saveContext(remembering, { ...ANSWERED, comparisonWeightClass: null });
    expect(loadSettings(remembering).context.comparisonWeightClass).toBeNull();
  });
});

describe('forgetContext', () => {
  it('returns a returning visit to a first one', () => {
    const remembering = store();
    saveContext(remembering, ANSWERED);
    saveView(remembering, 'bench', 'records');
    forgetContext(remembering);
    const settings = loadSettings(remembering);
    expect(settings.context).toStrictEqual(NO_SELECTION);
    expect(settings.lift).toBe('squat');
    expect(settings.targetType).toBe('classifications');
  });
});
