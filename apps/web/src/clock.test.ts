// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The hand-moved clock, which is what every timer story and test is built on.
 *
 * `systemClock` needs a document and real timers and is covered in
 * `clock.browser.test.ts`. This file is the fake, and a fake that is wrong is
 * worse than no fake: every assertion downstream about a countdown is really an
 * assertion about this file behaving like a clock.
 */

import { describe, expect, it } from 'vitest';

import { manualClock } from './clock.js';

describe('manualClock', () => {
  it('starts at the epoch and reports the instant it was given', () => {
    expect(manualClock().now()).toBe(0);
    expect(manualClock(1_700_000_000_000).now()).toBe(1_700_000_000_000);
  });

  it('does not move on its own', async () => {
    const clock = manualClock(5_000);
    let ticks = 0;
    clock.watch(() => {
      ticks += 1;
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 30);
    });

    expect(clock.now()).toBe(5_000);
    expect(ticks).toBe(0);

    // The positive control: the clock is watchable and the counter does count,
    // so the zero above is stillness rather than a listener that never attached.
    clock.advance(1);
    expect(ticks).toBe(1);
  });

  it('advances by a duration and sets an absolute instant', () => {
    const clock = manualClock(1_000);
    clock.advance(250);
    expect(clock.now()).toBe(1_250);
    clock.set(90_000);
    expect(clock.now()).toBe(90_000);
    clock.advance(-500);
    expect(clock.now()).toBe(89_500);
  });

  it('tells every watcher on both kinds of move', () => {
    const clock = manualClock();
    const seen: string[] = [];
    clock.watch(() => seen.push(`a:${String(clock.now())}`));
    clock.watch(() => seen.push(`b:${String(clock.now())}`));

    clock.advance(1_000);
    clock.set(4_000);

    expect(seen).toStrictEqual(['a:1000', 'b:1000', 'a:4000', 'b:4000']);
  });

  it('reads the new instant inside the callback, not the old one', () => {
    // A clock that announced before assigning would hand every watcher the
    // previous time, and a countdown driven by it would render one tick behind
    // for ever -- visible only as a timer that reaches zero a second late.
    const clock = manualClock(10_000);
    let seen = -1;
    clock.watch(() => {
      seen = clock.now();
    });
    clock.advance(1_000);
    expect(seen).toBe(11_000);
  });

  it('stops telling a watcher that has stopped watching', () => {
    const clock = manualClock();
    let kept = 0;
    let dropped = 0;
    clock.watch(() => {
      kept += 1;
    });
    const stop = clock.watch(() => {
      dropped += 1;
    });

    clock.advance(1);
    stop();
    clock.advance(1);

    expect(dropped).toBe(1);
    // The control: the other watcher is still being told, so the one above
    // stopped rather than the clock going quiet for everybody.
    expect(kept).toBe(2);
    expect(clock.watchers).toBe(1);
  });

  it('ignores a second stop rather than dropping somebody else', () => {
    const clock = manualClock();
    const stop = clock.watch(() => undefined);
    let other = 0;
    clock.watch(() => {
      other += 1;
    });

    stop();
    stop();

    expect(clock.watchers).toBe(1);
    clock.advance(1);
    expect(other).toBe(1);
  });

  it('counts one function watching twice as two watchers', () => {
    // The registration is the thing, not the function. A shared callback --
    // one module-level redraw passed by two elements -- collapses into a
    // single entry in any set keyed on the listener, and then the first stop
    // silently takes the second caller's watch with it. Both callers behave
    // correctly and one of them goes quiet, which is why this is worth a test
    // rather than a comment.
    const clock = manualClock();
    let ticks = 0;
    const shared = (): void => {
      ticks += 1;
    };

    const stopFirst = clock.watch(shared);
    clock.watch(shared);
    expect(clock.watchers).toBe(2);

    clock.advance(1);
    expect(ticks).toBe(2);

    stopFirst();
    expect(clock.watchers).toBe(1);
    clock.advance(1);
    expect(ticks).toBe(3);
  });

  it('does not tell a watcher that arrived during the move it arrived on', () => {
    // This is what the copy in `announce` is for -- not the stop-from-inside
    // case below, which a Set handles on its own. A watcher attaching mid-tick
    // has not drawn anything yet, so being told to redraw is at best wasted and
    // at worst unbounded: a listener that attaches one more each time would
    // extend the very set the loop is walking.
    const clock = manualClock();
    let late = 0;
    let attachedOnce = false;
    clock.watch(() => {
      if (attachedOnce) return;
      attachedOnce = true;
      clock.watch(() => {
        late += 1;
      });
    });

    clock.advance(1);
    expect(late).toBe(0);

    // The control: the late watcher is attached and does hear the next move,
    // so the zero above is about this move rather than a watch that failed.
    clock.advance(1);
    expect(late).toBe(1);
  });

  it('lets a watcher stop from inside its own callback', () => {
    // What an element does when a countdown ends while it is being told about
    // it. A `Set` iterator tolerates the current entry being deleted and does
    // not skip the next one, so this passes with or without the copy in
    // `announce` -- it is here because the behaviour has to hold, not because
    // it proves any particular way of getting it.
    const clock = manualClock();
    const seen: string[] = [];
    const stop = clock.watch(() => {
      seen.push('first');
      stop();
    });
    clock.watch(() => seen.push('second'));

    clock.advance(1);
    expect(seen).toStrictEqual(['first', 'second']);

    clock.advance(1);
    expect(seen).toStrictEqual(['first', 'second', 'second']);
  });
});
