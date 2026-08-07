// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The rest between sets, in a real browser.
 *
 * Mounted on its own and handed a clock it does not control, which is what makes every
 * case here a statement about time without any waiting in it: the fixtures move `now`
 * and assert what the screen then says. A test that slept would be asserting the
 * interval rate rather than the arithmetic, and it would take four real minutes to find
 * out that a rest expired correctly.
 *
 * WHAT THIS FILE IS GUARDING
 *
 * That the display is *computed* and never counted down. The whole reason section 7.11
 * asks for a target end timestamp is the phone that goes in a pocket, and the failure it
 * prevents -- coming back to a timer that owes the lifter the minutes the browser
 * throttled away -- is invisible in every manual test that keeps the tab in front.
 * `advance()` below is that pocket.
 *
 * And that the element computes nothing else. It reports which control was pressed; the
 * root decides what pause means. A case here that asserted a new timer would be the
 * second definition of the rest timer this package is arranged not to have.
 *
 * Every duration below is invented (section 5.1).
 */

// Without the stylesheet every declaration reading a custom property is dropped, and the
// accessibility pass measures a screen that never ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { REST_STEP_SECONDS, startRest, type RestTimer } from '../core/rest.js';
import type { Instant } from '../types.js';

import { REST_NOTES } from './copy.js';
import { defineTrainingLogbook } from './index.js';
import {
  REST_ACTION_EVENT,
  type PtkRestTimer,
  type RestAction,
  type RestActionDetail,
} from './ptk-rest-timer.js';

/** An invented instant, and an invented rest that a step either way lands clear of. */
const AT_START: Instant = '2026-03-10T17:00:00.000Z';
const REST_SECONDS = 180;

const teardown: (() => void)[] = [];

beforeAll(() => {
  defineTrainingLogbook();
});

afterEach(() => {
  for (const undo of teardown.splice(0)) undo();
});

/** A clock the test moves by hand, which is the only kind this element is given. */
interface Clock {
  readonly now: () => Instant;
  advance: (seconds: number) => void;
}

function clockAt(start: Instant): Clock {
  let millis = Date.parse(start);
  return {
    now: () => new Date(millis).toISOString(),
    advance: (seconds) => {
      millis += seconds * 1000;
    },
  };
}

async function mount(timer: RestTimer | null, clock: Clock): Promise<PtkRestTimer> {
  const element = document.createElement('ptk-rest-timer');
  element.timer = timer;
  element.now = clock.now;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function shadow(element: Element): ShadowRoot {
  const root = element.shadowRoot;
  if (root === null) throw new Error(`<${element.localName}> has not rendered.`);
  return root;
}

/** What the digits say. The spoken copy beside them is read separately, on purpose. */
function digits(element: PtkRestTimer): string {
  const shown = shadow(element).querySelector('.clock span[aria-hidden="true"]');
  if (shown === null) throw new Error('the clock is not on screen.');
  return shown.textContent.trim();
}

function spoken(element: PtkRestTimer): string {
  const said = shadow(element).querySelector('.clock .spoken');
  if (said === null) throw new Error('the clock has no spoken form.');
  return said.textContent.trim();
}

function state(element: PtkRestTimer): string {
  const line = shadow(element).querySelector('.state');
  if (line === null) throw new Error('the state line is not on screen.');
  return line.textContent.trim();
}

/** The controls on screen, by what they do rather than by what they are labelled. */
function controls(element: PtkRestTimer): string[] {
  return [...shadow(element).querySelectorAll('[data-action]')].map((control) => {
    const action = control instanceof HTMLElement ? control.dataset['action'] : undefined;
    if (action === undefined) throw new Error('a control lost its action.');
    return action;
  });
}

async function press(element: PtkRestTimer, action: RestAction): Promise<RestAction | null> {
  const control = shadow(element).querySelector(`ptk-button[data-action="${action}"]`);
  if (control === null) throw new Error(`there is no ${action} control on screen.`);
  const button = shadow(control).querySelector('button');
  if (button === null) throw new Error(`the ${action} control has not rendered.`);

  let reported: RestAction | null = null;
  const listen = (event: Event): void => {
    reported = (event as CustomEvent<RestActionDetail>).detail.action;
  };
  element.addEventListener(REST_ACTION_EVENT, listen);
  button.click();
  element.removeEventListener(REST_ACTION_EVENT, listen);
  await element.updateComplete;
  return reported;
}

/**
 * Repaints without waiting 250ms for the interval to come round.
 *
 * Through `visibilitychange`, which is a path the element really has and really needs --
 * a tab returning to the front must not show the number from whenever the browser last
 * allowed a tick. Faking a new timer object would repaint too, and would prove only that
 * assigning a property re-renders.
 */
async function repaint(element: PtkRestTimer): Promise<void> {
  document.dispatchEvent(new Event('visibilitychange'));
  await element.updateComplete;
}

describe('a rest on screen', () => {
  it('shows the whole rest for its first second and counts in seconds after that', async () => {
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    // Rounded up, so a three-minute rest reads 3:00 rather than 2:59 the moment it
    // starts. Down, the last second of every rest is invisible and the lifter is back
    // at the bar a second early.
    expect(digits(element)).toBe('3:00');

    clock.advance(0.5);
    await repaint(element);
    expect(digits(element)).toBe('3:00');

    clock.advance(0.5);
    await repaint(element);
    expect(digits(element)).toBe('2:59');
  });

  it('is right about a rest the browser stopped repainting', async () => {
    // The case the end timestamp exists for. A backgrounded tab is throttled to one
    // tick a minute and then to none, so the element is asked what time it is after
    // four minutes of nothing at all -- and a display that had been subtracting ticks
    // would answer with however many it was allowed to run.
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);

    clock.advance(240);
    await repaint(element);
    expect(digits(element)).toBe('0:00');
    expect(state(element)).toBe(REST_NOTES.up);
  });

  it('says in words what the colon means', async () => {
    // "0:45" is announced as zero, colon, forty-five by some engines and as forty-five
    // by others, and neither is a length of time.
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    expect(spoken(element)).toBe('3 minutes left');

    clock.advance(REST_SECONDS - 45);
    await repaint(element);
    expect(digits(element)).toBe('0:45');
    expect(spoken(element)).toBe('45 seconds left');
  });

  it('draws nothing at all when there is no rest', async () => {
    // Not a stopped timer and not an empty band. Section 7.11 makes the feature
    // optional, and a lifter with it switched off must see no trace of it.
    const element = await mount(null, clockAt(AT_START));
    expect(shadow(element).querySelector('.rest')).toBeNull();
  });
});

describe('the controls', () => {
  it('offers pause while a rest is running and resume once it is stopped', async () => {
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    expect(controls(element)).toStrictEqual(['pause', 'shorten', 'extend', 'reset', 'dismiss']);
    expect(state(element)).toBe('');

    element.timer = { kind: 'paused', remainingMillis: 120_000, totalSeconds: REST_SECONDS };
    await element.updateComplete;
    expect(controls(element)).toStrictEqual(['resume', 'shorten', 'extend', 'reset', 'dismiss']);
    expect(state(element)).toBe(REST_NOTES.paused);
    // A paused timer is frozen, not slow: the clock runs and the digits do not.
    clock.advance(600);
    await repaint(element);
    expect(digits(element)).toBe('2:00');
  });

  it('drops pause once the rest is up, and keeps the two presses that still mean something', async () => {
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    clock.advance(REST_SECONDS);
    await repaint(element);
    // Nothing to pause and nothing to resume. Start again and Done resting are the two
    // things a lifter standing at the bar with a finished rest actually presses, and
    // extend is the third -- thirty more seconds is a real answer to a rest that is up.
    expect(controls(element)).toStrictEqual(['shorten', 'extend', 'reset', 'dismiss']);
  });

  it('names the press and computes nothing', async () => {
    // The contract with the root. An element that returned a new timer would be a
    // second place that knows what extend does to a paused rest.
    const clock = clockAt(AT_START);
    const before = startRest(REST_SECONDS, clock.now());
    const element = await mount(before, clock);

    for (const action of ['pause', 'shorten', 'extend', 'reset', 'dismiss'] as const) {
      expect(await press(element, action)).toBe(action);
    }
    expect(element.timer).toStrictEqual(before);
  });

  it('gives the signed controls a name a screen reader can use', async () => {
    // "-30s" is a glance for a sighted lifter and "minus thirty s" for everybody else.
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    const shorten = shadow(element).querySelector('ptk-button[data-action="shorten"]');
    if (shorten === null) throw new Error('the shorten control is not on screen.');
    expect(shorten.getAttribute('accessible-name')).toBe(REST_NOTES.shortenName(REST_STEP_SECONDS));
    expect(shorten.textContent.trim()).toBe(REST_NOTES.shorten(REST_STEP_SECONDS));
  });
});

describe('what is announced', () => {
  it('keeps the digits out of the live region and the sentence in it', async () => {
    // A countdown in a live region announces itself once a second over the top of
    // everything else the device is saying, for three minutes. The one thing worth
    // interrupting for is that the rest is over.
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    const live = shadow(element).querySelectorAll('[aria-live]');
    expect(live).toHaveLength(1);

    const region = live[0];
    if (region === undefined) throw new Error('the live region has gone.');
    expect(region.contains(shadow(element).querySelector('.clock'))).toBe(false);
    // Already in the document while the rest runs, holding nothing. A region created at
    // the moment its sentence appears is announced by no engine reliably.
    expect(region.textContent.trim()).toBe('');

    clock.advance(REST_SECONDS);
    await repaint(element);
    expect(region.textContent.trim()).toBe(REST_NOTES.up);
  });

  it('has no accessibility violations', async () => {
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toStrictEqual([]);
  });
});

describe('the property set after the first render', () => {
  it('redraws for a timer assigned later', async () => {
    // The one test every element in this collection needs: `experimentalDecorators`
    // plus `useDefineForClassFields: false` is the configuration, and a misconfigured
    // one renders once and then ignores every property it is given.
    const clock = clockAt(AT_START);
    const element = await mount(null, clock);
    expect(shadow(element).querySelector('.rest')).toBeNull();

    element.timer = startRest(90, clock.now());
    await element.updateComplete;
    expect(digits(element)).toBe('1:30');
  });

  it('measures a fresh rest that arrives on top of a finished one', async () => {
    // The bug this is here for: the display is state, and a rest started while the
    // previous one read 0:00 would be drawn at whatever the last one left behind unless
    // the new timer is measured before it is rendered. It would then sit at 0:00 with
    // three minutes on it, because the interval only starts when there is time left.
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    clock.advance(REST_SECONDS);
    await repaint(element);
    expect(digits(element)).toBe('0:00');

    element.timer = startRest(REST_SECONDS, clock.now());
    await element.updateComplete;
    expect(digits(element)).toBe('3:00');
  });
});
