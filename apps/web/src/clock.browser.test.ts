// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The device clock, in a real browser because that is the only place it exists.
 *
 * `manualClock` carries every assertion about a countdown's arithmetic
 * (`clock.test.ts`). What is left here is the part that touches the platform and
 * therefore cannot be reasoned about from the source: that one interval is
 * shared, that it is not running when nobody is watching, and that a tab coming
 * back to the front redraws before the next tick rather than after it.
 *
 * The "is it running" questions are asked by spying on `setInterval` and
 * `clearInterval` rather than by waiting and counting. Waiting would make the
 * suite slow and would turn a leaked interval -- the failure that matters, a
 * timer still firing on a screen the lifter has left -- into a flake instead of
 * a failure.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLOCK_TICK_MS, systemClock } from './clock.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Waits long enough for at least two real ticks to have landed. */
async function twoTicks(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, CLOCK_TICK_MS * 2 + 60);
  });
}

describe('systemClock', () => {
  it('reports the device clock', () => {
    const before = Date.now();
    const reading = systemClock().now();
    expect(reading).toBeGreaterThanOrEqual(before);
    expect(reading).toBeLessThanOrEqual(Date.now());
  });

  it('starts no timer until somebody watches', () => {
    const started = vi.spyOn(globalThis, 'setInterval');
    const clock = systemClock();

    expect(started).not.toHaveBeenCalled();

    // The control: this clock does start one, so the assertion above is about
    // laziness rather than about a clock that never ticks at all.
    const stop = clock.watch(() => undefined);
    expect(started).toHaveBeenCalledTimes(1);
    stop();
  });

  it('ticks a watcher on its own', async () => {
    const clock = systemClock();
    let ticks = 0;
    const stop = clock.watch(() => {
      ticks += 1;
    });

    await twoTicks();
    stop();

    expect(ticks).toBeGreaterThanOrEqual(2);
  });

  it('shares one timer between watchers rather than one each', () => {
    const started = vi.spyOn(globalThis, 'setInterval');
    const clock = systemClock();

    const stops = [clock.watch(() => undefined), clock.watch(() => undefined)];
    expect(started).toHaveBeenCalledTimes(1);

    for (const stop of stops) stop();
  });

  it('keeps ticking while one of two watchers stops', async () => {
    const cleared = vi.spyOn(globalThis, 'clearInterval');
    const clock = systemClock();
    let kept = 0;

    const stopFirst = clock.watch(() => undefined);
    const stopSecond = clock.watch(() => {
      kept += 1;
    });

    stopFirst();
    expect(cleared).not.toHaveBeenCalled();

    await twoTicks();
    stopSecond();

    expect(kept).toBeGreaterThanOrEqual(2);
    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it('stops the timer when the last watcher leaves', () => {
    const cleared = vi.spyOn(globalThis, 'clearInterval');
    const clock = systemClock();

    clock.watch(() => undefined)();

    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it('does not clear the shared timer when a stop is called twice', () => {
    // The failure would be quiet and total -- the size hits zero with somebody
    // still watching, and every countdown on the page freezes while showing a
    // plausible number -- and what prevents it is that a stop removes one
    // registration that is nobody else's, so a second call removes nothing.
    // There is no flag doing the work here and there does not need to be.
    const cleared = vi.spyOn(globalThis, 'clearInterval');
    const clock = systemClock();

    const stopFirst = clock.watch(() => undefined);
    const stopSecond = clock.watch(() => undefined);

    stopFirst();
    stopFirst();
    expect(cleared).not.toHaveBeenCalled();

    stopSecond();
    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh timer when watching resumes after everyone left', () => {
    const started = vi.spyOn(globalThis, 'setInterval');
    const clock = systemClock();

    clock.watch(() => undefined)();
    const stop = clock.watch(() => undefined);

    expect(started).toHaveBeenCalledTimes(2);
    stop();
  });

  it('redraws as soon as the tab comes back rather than on the next tick', () => {
    const clock = systemClock();
    let ticks = 0;
    const stop = clock.watch(() => {
      ticks += 1;
    });

    document.dispatchEvent(new Event('visibilitychange'));
    stop();

    // The document is visible under the test runner, so the handler fires. A
    // hidden tab is the case this is for and the branch below is its control.
    expect(ticks).toBe(1);
  });

  it('does not redraw when the tab goes away', () => {
    const clock = systemClock();
    let ticks = 0;
    const stop = clock.watch(() => {
      ticks += 1;
    });

    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ticks).toBe(0);

    hidden.mockRestore();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ticks).toBe(1);

    stop();
  });

  it('lets a watcher stop from inside its own tick without skipping the next one', () => {
    // Exactly what a countdown element does: the tick that takes it to zero is
    // the tick it stops watching on. A `Set` iterator is specified to tolerate
    // the entry it is standing on being deleted, so this holds either way --
    // the assertion is on the behaviour, and the copy in `announce` is proven
    // by the arrival case below instead.
    const clock = systemClock();
    const seen: string[] = [];
    const stopFirst = clock.watch(() => {
      seen.push('first');
      stopFirst();
    });
    const stopSecond = clock.watch(() => seen.push('second'));

    document.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toStrictEqual(['first', 'second']);

    stopSecond();
  });

  it('does not tick a watcher that arrived during the tick it arrived on', () => {
    // The live-set failure that actually exists. It matters more here than on
    // the manual clock because this one holds the interval: a listener that
    // attaches another during a tick would extend the set the loop is walking,
    // four times a second, on a page that is already counting down.
    const clock = systemClock();
    const stops: (() => void)[] = [];
    let late = 0;
    let attachedOnce = false;

    stops.push(
      clock.watch(() => {
        if (attachedOnce) return;
        attachedOnce = true;
        stops.push(
          clock.watch(() => {
            late += 1;
          }),
        );
      }),
    );

    document.dispatchEvent(new Event('visibilitychange'));
    expect(late).toBe(0);

    // The control: it is attached, and the next tick reaches it.
    document.dispatchEvent(new Event('visibilitychange'));
    expect(late).toBe(1);

    for (const stop of stops) stop();
  });

  it('counts one function watching twice as two watchers', () => {
    // A shared redraw callback passed by two elements. Keyed on the function,
    // the two collapse into one entry -- and then the first element to
    // disconnect clears the interval out from under the second, which is the
    // same freeze as the double-stop case above arriving by another route.
    const cleared = vi.spyOn(globalThis, 'clearInterval');
    const clock = systemClock();
    let ticks = 0;
    const shared = (): void => {
      ticks += 1;
    };

    const stopFirst = clock.watch(shared);
    const stopSecond = clock.watch(shared);

    document.dispatchEvent(new Event('visibilitychange'));
    expect(ticks).toBe(2);

    stopFirst();
    expect(cleared).not.toHaveBeenCalled();

    document.dispatchEvent(new Event('visibilitychange'));
    expect(ticks).toBe(3);

    stopSecond();
    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it('stops listening for visibility once nobody is watching', () => {
    const clock = systemClock();
    let ticks = 0;
    const stop = clock.watch(() => {
      ticks += 1;
    });

    stop();
    document.dispatchEvent(new Event('visibilitychange'));

    expect(ticks).toBe(0);
  });
});
