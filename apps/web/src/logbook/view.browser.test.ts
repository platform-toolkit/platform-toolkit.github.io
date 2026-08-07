// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { PtkTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import { memoryLogbookStore } from '@platform-toolkit/training-logbook/storage';
import { afterEach, describe, expect, it } from 'vitest';

import type { Clock } from '../clock.js';
import { createTrainingLogbookView, type TrainingLogbookViewOptions } from './view.js';

/**
 * The composition root, and only the parts of it that are decisions.
 *
 * Everything this view builds is tested where it lives -- the element in its own
 * package, the store in `storage`, the handoff reader beside it. What is only
 * testable here is the wiring: the properties this file sets, whose values differ
 * between the two page entries. Those are the lines that go missing without
 * anything noticing, because each half is individually correct.
 */

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) dispose();
});

/** A clock that never ticks, at whichever instant the test cares about. */
function stoppedAt(millis: number): Clock {
  return { now: () => millis, watch: () => () => undefined };
}

/**
 * Memory and never IndexedDB: a browser-mode suite sharing one real database
 * across files is a suite that passes on run order.
 */
function mount(options: TrainingLogbookViewOptions = {}): PtkTrainingLogbook {
  const store = memoryLogbookStore();
  const element = createTrainingLogbookView({
    ...options,
    openStore: () => Promise.resolve(store),
  });
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  return element;
}

describe('the training logbook view', () => {
  it('leaves the tool drawing its own heading by default', () => {
    // The framed route takes this default, and a document whose whole body is the
    // tool has no other heading. Absent is the failure that matters and redundant
    // is not, so unset is the safe direction.
    expect(mount().pageTitled).toBe(false);
  });

  it('takes the heading away on a page that already draws one', () => {
    expect(mount({ pageTitled: true }).pageTitled).toBe(true);
  });

  it('dates the tool from the clock it was handed, not the device it runs on', () => {
    // Two views built a day apart from two stopped clocks. Asserting the string
    // against a second copy of the same arithmetic would pass with the wire cut;
    // asserting that a day of clock moves the answer cannot.
    const noon = Date.UTC(2026, 4, 15, 12, 0, 0);
    const day = 24 * 60 * 60 * 1000;

    const first = mount({ clock: stoppedAt(noon) }).today;
    const next = mount({ clock: stoppedAt(noon + day) }).today;

    expect(first).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(next).not.toBe(first);
  });
});
