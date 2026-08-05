// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The current instant, and something to repaint on while it moves.
 *
 * The first ticking clock in the collection. Nothing in `apps/web` or any
 * package called `Date.now`, `setInterval` or `performance.now` before this
 * file: every domain function that cares about time takes `now` as a parameter,
 * which is what makes the whole meet-day model pure and replayable. This seam
 * exists to supply that parameter and to say when a screen showing it should be
 * drawn again -- nothing more. It decides nothing.
 *
 * WHY THE DISPLAYED TIME IS COMPUTED AND NEVER COUNTED DOWN
 *
 * `submissionState` works out the seconds remaining from `now -
 * countdown.startedAt`. That is not an implementation detail, it is the
 * property that makes this safe on the device it runs on. A browser throttles
 * `setInterval` in a hidden tab -- to one second, and after five minutes of
 * being hidden to once a minute, and on a phone whose screen is off it may stop
 * altogether. A timer that decremented a counter on each tick would therefore
 * lose real seconds whenever the lifter put the phone in their pocket, and
 * would come back showing time the lifter does not have, during the sixty
 * seconds §14.1 is about. Because the number is derived instead, throttling
 * changes only how often it is repainted: the value is right the instant it is
 * next drawn, and the tab coming back to the front draws it immediately.
 *
 * So a missed tick here is a cosmetic problem. That is the whole reason to
 * build it this way, and it is why nothing below tries to be clever about
 * keeping the interval alive.
 *
 * WHY WALL CLOCK RATHER THAN MONOTONIC
 *
 * `performance.now()` cannot jump, which sounds like the better answer for a
 * countdown. It is an offset from an origin private to one document, though,
 * and a meet document holds absolute instants -- every action's `at`, every
 * `startedAt` -- because the undo timeline is a record of when things happened
 * and because saving a meet to disk (#52) has to survive the page closing. Two
 * clocks would mean two notions of "when", and the one written down would be
 * the one that could not be compared against the one on screen.
 *
 * The cost is real and small: if the device's clock is corrected while a
 * declaration clock runs, the seconds remaining shift by the correction. §14.1
 * already answers this -- the official clock is authoritative and this timer is
 * an aid that may start late -- and a screen that says so is honest about a
 * sixty-second aid in a way that a hidden monotonic clock would not make truer.
 *
 * WHAT NOT TO DO WITH IT
 *
 * Do not read `now()` inside a render to decide something. Read it once where
 * an action is stamped or a view is built, and pass it down. A component that
 * calls `now()` twice in one paint can show two different instants in one
 * screen, and the resulting off-by-one second is the kind of bug that only
 * appears on somebody else's phone.
 *
 * A NOTE ON THE SET, BECAUSE TWO OBVIOUS BELIEFS ABOUT IT ARE FALSE
 *
 * Both clocks below keep their watchers in a `Set` and both were first written
 * with defences against that set that turned out to be defences against
 * nothing. Mutation testing found them; the corrections are worth stating once
 * here rather than three times below.
 *
 * A `Set` iterator is not an array index. Deleting the entry the loop is
 * currently on -- what a watcher does when it stops from inside its own
 * callback -- does not shift anything and does not skip the next watcher; the
 * language specifies that. So copying before iterating buys nothing there, and
 * a test that stops from inside a callback proves the spec rather than the
 * copy. What the copy actually buys is the other direction: a watcher that
 * *arrives* during a tick is not told about that tick.
 *
 * `Set.delete` is idempotent. A stop function called twice removes nothing the
 * second time and cannot drive the size to zero early, so the `watching` flag
 * that used to guard it was unreachable code. Removing it uncovered the bug it
 * had been standing in front of and not fixing: a set keyed on the listener
 * itself collapses two registrations of the same function into one entry, and
 * then the first stop silently unwatches the second caller. Hence `Watcher`.
 */

/**
 * The reader's own calendar day, as `YYYY-MM-DD`.
 *
 * Built from the local fields and never from `toISOString`, which is §5.5's
 * hazard read from the other side: an instant is a point on the globe and a
 * calendar day is not. At ten at night in California `toISOString` already says
 * tomorrow, so a lifter checking a deadline the evening before is told entry has
 * closed, and a session logged that evening is filed under a day they did not
 * train on. West of Greenwich the error is a day in one direction and east of it
 * a day in the other.
 *
 * Here rather than in each tool's transport because this file is the only thing
 * in the repository that reads the wall clock, and the local day is a wall-clock
 * read. It was written out twice before this -- once per tool that needed it --
 * and a rule this quiet is one that gets a third copy with `toISOString` in it.
 *
 * Not `PlainDate`: that models a date somebody stated, with a parser that can
 * refuse. This is the device's answer to "what day is it here", which cannot
 * fail and has nothing to validate.
 */
export function localCalendarDay(now: number): string {
  const when = new Date(now);
  const month = String(when.getMonth() + 1).padStart(2, '0');
  const day = String(when.getDate()).padStart(2, '0');
  return `${String(when.getFullYear())}-${month}-${day}`;
}

/**
 * A source of the current instant that also says when to look again.
 *
 * Two methods rather than an event target: everything a screen needs is "what
 * time is it" and "tell me when to ask again", and a port that small is a
 * closure over a `Map` in a test rather than a mock.
 */
export interface Clock {
  /** Milliseconds since the epoch, the same scale the meet document stores. */
  now(): number;
  /**
   * Calls `listener` periodically until the returned function is called.
   *
   * The listener gets no argument on purpose. Its only job is to mark the view
   * dirty; whatever redraws then reads `now()` once, so a single paint cannot
   * straddle two instants.
   */
  watch(listener: () => void): () => void;
}

/**
 * One registration, wrapping one listener.
 *
 * The wrapper is the whole point and it is one line of consequence: a set keyed
 * on the listener function itself makes two registrations of the *same*
 * function a single entry, so the first caller to stop unwatches the second one
 * too, and the second one goes quiet holding a stop function that does nothing.
 * Nothing about the caller's code looks wrong when that happens -- both asked,
 * one was answered -- and the screen that stops updating is not the screen that
 * called stop. A fresh object per call cannot collide.
 *
 * Two elements sharing a listener sounds unlikely until a module-level
 * `requestRedraw` or a shared bound method is the obvious thing to pass, which
 * on a page with two countdowns on it is exactly what somebody will pass.
 */
interface Watcher {
  readonly listener: () => void;
}

/**
 * How often a watched clock wakes up, in milliseconds.
 *
 * Four times the rate anything is displayed at, and the extra three are not
 * waste. `setInterval(fn, 1000)` drifts, so a whole-second display driven by a
 * one-second timer eventually paints the same second twice and then skips one,
 * which on a countdown reads as the clock stuttering at exactly the moment
 * somebody is watching it. Sampling faster than the display changes means the
 * shown second is never more than a quarter of a second late and never skips.
 *
 * A watcher only exists while a declaration clock is running, so this is four
 * wake-ups a second for about a minute at a time, not for the length of a meet.
 */
export const CLOCK_TICK_MS = 250;

/**
 * The device's clock.
 *
 * One interval shared by every watcher and started only when the first one
 * arrives, so a screen with no countdown on it costs nothing. `visibilitychange`
 * is listened to for the reason in the header: a tab returning to the front has
 * usually missed several ticks, and waiting up to `CLOCK_TICK_MS` more to
 * correct a number the lifter is looking at right now is the one delay worth
 * spending a listener to avoid.
 */
export function systemClock(): Clock {
  const attached = new Set<Watcher>();
  let interval: ReturnType<typeof setInterval> | null = null;

  const announce = (): void => {
    // Copied so that this tick reaches exactly the watchers that were attached
    // when it began. A listener that calls `watch` while being told -- an
    // element that mounts a second countdown in response to the first reaching
    // zero -- would otherwise be told about the tick it arrived during, before
    // it has drawn anything, and a listener that attaches one more each time
    // would grow the set the loop is walking and never leave it.
    for (const watcher of [...attached]) watcher.listener();
  };

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') announce();
  };

  const start = (): void => {
    if (interval !== null) return;
    interval = setInterval(announce, CLOCK_TICK_MS);
    document.addEventListener('visibilitychange', onVisibility);
  };

  const stop = (): void => {
    if (interval === null) return;
    clearInterval(interval);
    interval = null;
    document.removeEventListener('visibilitychange', onVisibility);
  };

  return {
    now: () => Date.now(),
    watch: (listener) => {
      const watcher: Watcher = { listener };
      attached.add(watcher);
      start();
      // No flag guarding a second call. `Set.delete` is idempotent and this
      // watcher is nobody else's, so calling the returned function twice --
      // what an element does when a disconnect is followed by a teardown --
      // removes nothing the second time and cannot take the size to zero while
      // somebody is still watching. A flag here read as the thing preventing
      // that; it was unreachable, and it hid the collision `Watcher` fixes.
      return () => {
        attached.delete(watcher);
        if (attached.size === 0) stop();
      };
    },
  };
}

/** A clock whose hands are moved by hand. */
export interface ManualClock extends Clock {
  /** Moves to an absolute instant and tells every watcher. */
  set(instant: number): void;
  /** Moves forward by a duration and tells every watcher. */
  advance(milliseconds: number): void;
  /** How many watchers are currently attached. */
  readonly watchers: number;
}

/**
 * A clock that only moves when something moves it.
 *
 * Tests use it, and so do the stories: a countdown story that ran on the real
 * clock would document a different screen every time somebody opened it, and
 * would have expired by the time they read the sentence under it. Frozen time
 * is the honest way to photograph a timer.
 *
 * It also makes the throttling property in the header testable, which it
 * otherwise would not be -- advancing sixty seconds in one step is exactly what
 * a backgrounded tab does, and the assertion that the screen is correct
 * afterwards is the one that matters.
 */
export function manualClock(start = 0): ManualClock {
  const attached = new Set<Watcher>();
  let instant = start;

  // Same copy, same wrapper, same absent flag as `systemClock`, and for the
  // reasons given there. A fake that differs from the real thing in how it
  // handles a watcher arriving or leaving mid-tick would make every test built
  // on it prove something about the fake.
  const announce = (): void => {
    for (const watcher of [...attached]) watcher.listener();
  };

  return {
    now: () => instant,
    watch: (listener) => {
      const watcher: Watcher = { listener };
      attached.add(watcher);
      return () => {
        attached.delete(watcher);
      };
    },
    set: (next) => {
      instant = next;
      announce();
    },
    advance: (milliseconds) => {
      instant += milliseconds;
      announce();
    },
    get watchers() {
      return attached.size;
    },
  };
}
