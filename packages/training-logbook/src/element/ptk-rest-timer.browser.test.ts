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
import {
  SELECT_CHANGE_EVENT,
  TOGGLE_GROUP_CHANGE_EVENT,
  type SelectChangeDetail,
} from '@platform-toolkit/ui';
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { REST_STEP_SECONDS, startRest, type RestTimer } from '../core/rest.js';
import type { Instant, RestAlertChannel, RestAlertSettings } from '../types.js';

import { REST_NOTES } from './copy.js';
import { REST_LIFT_DURATION_FIELD } from './dataset.js';
import { defineTrainingLogbook } from './index.js';
import {
  REST_ACTION_EVENT,
  REST_ALERTS_EVENT,
  type PtkRestTimer,
  type RestAction,
  type RestActionDetail,
  type RestAlertsDetail,
  type RestLift,
} from './ptk-rest-timer.js';
import {
  createRestAlerter,
  type RestAlertDevice,
  type RestNotifyPermission,
} from './rest-alert.js';

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

/** What the root would have handed down, where a case is about the alerts. */
interface Band {
  readonly alerts?: RestAlertSettings;
  readonly device?: RestAlertDevice;
}

async function mount(
  timer: RestTimer | null,
  clock: Clock,
  band: Band = {},
): Promise<PtkRestTimer> {
  const element = document.createElement('ptk-rest-timer');
  element.timer = timer;
  element.now = clock.now;
  // Set before the element is in the document, so the first paint is the one under
  // test. A live region that arrived with its own first sentence is announced by no
  // engine reliably, and adding the alerts a frame late would hide exactly that.
  if (band.alerts !== undefined) element.alerts = band.alerts;
  if (band.device !== undefined) element.alerter = createRestAlerter(band.device);
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

describe('the length this lift rests for', () => {
  /** An invented lift and three invented lengths to choose between. Section 5.1. */
  function aLift(overrides: Partial<RestLift> = {}): RestLift {
    return {
      name: 'Back squat',
      seconds: REST_SECONDS,
      options: [
        { value: '120', label: '2 min' },
        { value: String(REST_SECONDS), label: '3 min' },
        { value: '300', label: '5 min' },
      ],
      ...overrides,
    };
  }

  /** The picker, or `null` where the band is not offering one. */
  function picker(element: PtkRestTimer): Element | null {
    return shadow(element).querySelector(`[data-field="${REST_LIFT_DURATION_FIELD}"] ptk-select`);
  }

  it('offers nothing where the root named no lift', async () => {
    // The ordinary case for a consumer mounting this on its own, and the root's answer
    // for a rest whose lift it could not identify. A picker that would write a
    // preference against nothing is worse than no picker.
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    expect(picker(element)).toBeNull();
  });

  it('offers nothing where the root has no lengths to offer', async () => {
    // Section 0.4 forbids a disabled control standing in for a feature, and an empty
    // picker is the same thing with a better excuse.
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    element.lift = aLift({ options: [] });
    await element.updateComplete;
    expect(picker(element)).toBeNull();
  });

  it('names the lift and shows what it currently rests for', async () => {
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    element.lift = aLift({ seconds: 300 });
    await element.updateComplete;

    const control = picker(element);
    if (control === null) throw new Error('the band is offering no duration.');
    expect(control.getAttribute('label')).toBe(REST_NOTES.liftDurationLabel('Back squat'));
    expect(shadow(control).querySelector('select')?.value).toBe('300');
    // Said under it, because storing a preference is not what a countdown looks like it
    // does.
    expect(shadow(element).querySelector('.duration .note')?.textContent.trim()).toBe(
      REST_NOTES.liftDurationNote,
    );
  });

  it('hands the chosen length up under its own field and computes nothing', async () => {
    // The same contract the buttons have. A band that retimed the rest itself would be
    // a second place that knows what choosing a length means, and the root -- which is
    // the only thing holding the settings -- would find out second.
    const clock = clockAt(AT_START);
    const before = startRest(REST_SECONDS, clock.now());
    const element = await mount(before, clock);
    element.lift = aLift();
    await element.updateComplete;

    const control = picker(element);
    if (control === null) throw new Error('the band is offering no duration.');
    const select = shadow(control).querySelector('select');
    if (select === null) throw new Error('the picker has not rendered.');

    let reported: SelectChangeDetail | null = null;
    const listen = (event: Event): void => {
      reported = (event as CustomEvent<SelectChangeDetail>).detail;
    };
    element.addEventListener(SELECT_CHANGE_EVENT, listen);
    select.value = '300';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    element.removeEventListener(SELECT_CHANGE_EVENT, listen);
    await element.updateComplete;

    expect(reported).toStrictEqual({ value: '300' });
    expect(element.timer).toStrictEqual(before);
  });

  it('has no accessibility violations with the picker on it', async () => {
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    element.lift = aLift();
    await element.updateComplete;
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toStrictEqual([]);
  });
});

describe('being told the rest is up', () => {
  /** Every channel off, which is what a lifter who has chosen nothing has. */
  const NOTHING_ON: RestAlertSettings = { sound: false, vibrate: false, notify: false };

  /** A device that does everything, and a record of what it was asked to do. */
  function willing(permission: RestNotifyPermission = 'granted'): {
    readonly device: RestAlertDevice;
    readonly done: string[];
  } {
    const done: string[] = [];
    return {
      done,
      device: {
        tone: () => {
          done.push('tone');
          return Promise.resolve(true);
        },
        vibrate: () => {
          done.push('buzz');
          return true;
        },
        notifications: {
          permission: () => permission,
          request: () => Promise.resolve(permission),
          post: (title) => done.push(`notify:${title}`),
        },
      },
    };
  }

  /** A device that answers no to everything it is asked. */
  const REFUSING: RestAlertDevice = {
    tone: () => Promise.resolve(false),
    vibrate: () => false,
    notifications: {
      permission: () => 'denied',
      request: () => Promise.resolve('denied'),
      post: () => undefined,
    },
  };

  function group(element: PtkRestTimer): Element | null {
    return shadow(element).querySelector('ptk-toggle-group');
  }

  /** Which channels the band is offering, in the order they are drawn. */
  function offered(element: PtkRestTimer): string[] {
    const control = group(element);
    if (control === null) return [];
    return [...shadow(control).querySelectorAll('label[data-value]')].map(
      (option) => (option instanceof HTMLElement ? option.dataset['value'] : undefined) ?? '',
    );
  }

  function box(element: PtkRestTimer, channel: RestAlertChannel): HTMLInputElement {
    const control = group(element);
    if (control === null) throw new Error('the band is offering no alerts.');
    const input = shadow(control).querySelector(`label[data-value="${channel}"] input`);
    if (!(input instanceof HTMLInputElement)) throw new Error(`no ${channel} switch on screen.`);
    return input;
  }

  /** What the band is saying went wrong, as sentences. */
  function trouble(element: PtkRestTimer): string[] {
    return [...shadow(element).querySelectorAll('.trouble span')].map((line) =>
      line.textContent.trim(),
    );
  }

  /** Opens the disclosure the switches live behind, the way a lifter would. */
  async function openAlerts(element: PtkRestTimer): Promise<void> {
    const disclosure = shadow(element).querySelector('ptk-disclosure');
    if (disclosure === null) throw new Error('the band is offering no alerts.');
    const summary = shadow(disclosure).querySelector('summary');
    if (summary === null) throw new Error('the disclosure has not rendered.');
    summary.click();
    await element.updateComplete;
  }

  async function tick(element: PtkRestTimer, channel: RestAlertChannel): Promise<void> {
    const input = box(element, channel);
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await element.updateComplete;
  }

  it('offers nothing where the root handed down no alerts', async () => {
    // A consumer mounting the band alone has nowhere to store an answer, so the
    // switches would be three presses that come back on nothing. Section 0.4 again.
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    expect(group(element)).toBeNull();
  });

  it('offers nothing on a device that can do none of the three', async () => {
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock, {
      alerts: NOTHING_ON,
      device: {},
    });
    expect(group(element)).toBeNull();
  });

  it('offers only the channels this device has, and never a dead one', async () => {
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock, {
      alerts: NOTHING_ON,
      device: { vibrate: () => true },
    });
    expect(offered(element)).toStrictEqual(['vibrate']);
  });

  it('proves a channel works before it says it is on', async () => {
    const clock = clockAt(AT_START);
    const asked = willing();
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock, {
      alerts: NOTHING_ON,
      device: asked.device,
    });
    await openAlerts(element);

    let reported: RestAlertSettings | null = null;
    element.addEventListener(REST_ALERTS_EVENT, (event: CustomEvent<RestAlertsDetail>) => {
      reported = event.detail.alerts;
    });
    await tick(element, 'sound');

    // The demonstration, at the press that asked for it: a lifter finds out in the
    // gym car park rather than at the rack in three minutes.
    await vi.waitFor(() => {
      expect(asked.done).toStrictEqual(['tone']);
      expect(reported).toStrictEqual({ ...NOTHING_ON, sound: true });
    });
    expect(trouble(element)).toStrictEqual([]);
  });

  it('turns the switch back off and says why, when the device refuses', async () => {
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock, {
      alerts: NOTHING_ON,
      device: REFUSING,
    });
    await openAlerts(element);

    let saved = 0;
    element.addEventListener(REST_ALERTS_EVENT, () => {
      saved += 1;
    });
    await tick(element, 'notify');

    // Nothing stored, nothing left ticked, and a sentence naming what to do about it.
    // A switch that turns on and then does nothing is worse than no switch.
    await vi.waitFor(() => {
      expect(trouble(element)).toStrictEqual([REST_NOTES.alertTrouble.notify.refused]);
    });
    expect(saved).toBe(0);
    expect(box(element, 'notify').checked).toBe(false);
  });

  it('tells a dismissed prompt apart from a refusal', async () => {
    // `persistAsked` draws the same line for storage. A prompt swiped away is not a no,
    // and the sentence a lifter is given has to be about the thing that happened.
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock, {
      alerts: NOTHING_ON,
      device: willing('default').device,
    });
    await openAlerts(element);
    await tick(element, 'notify');

    await vi.waitFor(() => {
      expect(trouble(element)).toStrictEqual([REST_NOTES.alertTrouble.notify.unknown]);
    });
  });

  it('needs no permission and no proof to switch one off again', async () => {
    const clock = clockAt(AT_START);
    const asked = willing();
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock, {
      alerts: { ...NOTHING_ON, vibrate: true },
      device: asked.device,
    });
    await openAlerts(element);
    expect(box(element, 'vibrate').checked).toBe(true);

    let reported: RestAlertSettings | null = null;
    element.addEventListener(REST_ALERTS_EVENT, (event: CustomEvent<RestAlertsDetail>) => {
      reported = event.detail.alerts;
    });
    await tick(element, 'vibrate');

    expect(reported).toStrictEqual(NOTHING_ON);
    expect(asked.done).toStrictEqual([]);
  });

  it('says it on every channel that is on, once, as the rest runs out', async () => {
    const clock = clockAt(AT_START);
    const asked = willing();
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock, {
      alerts: { sound: true, vibrate: true, notify: true },
      device: asked.device,
    });
    expect(asked.done).toStrictEqual([]);

    clock.advance(REST_SECONDS);
    await repaint(element);
    await vi.waitFor(() => {
      expect(asked.done).toStrictEqual(['buzz', 'tone', `notify:${REST_NOTES.up}`]);
    });

    // Every repaint after the crossing is a paint of a rest that is already up. A test
    // on `secondsLeft === 0` rather than on the step to it would buzz once a tick, and
    // again every time the lifter came back to the tab.
    clock.advance(60);
    await repaint(element);
    await repaint(element);
    expect(asked.done).toStrictEqual(['buzz', 'tone', `notify:${REST_NOTES.up}`]);
    expect(trouble(element)).toStrictEqual([]);
  });

  it('stays quiet for a rest that was already over when it arrived', async () => {
    // A lifter reopening the tool on a rest that expired while the phone was off. The
    // band draws 0:00, which is the truth; a tone three hours late is not.
    const clock = clockAt(AT_START);
    const asked = willing();
    const element = await mount(null, clock, {
      alerts: { ...NOTHING_ON, sound: true },
      device: asked.device,
    });

    const started = startRest(REST_SECONDS, clock.now());
    clock.advance(REST_SECONDS + 60);
    element.timer = started;
    await element.updateComplete;

    expect(digits(element)).toBe('0:00');
    expect(asked.done).toStrictEqual([]);
  });

  it('stays quiet when the lifter has asked for nothing', async () => {
    const clock = clockAt(AT_START);
    const asked = willing();
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock, {
      alerts: NOTHING_ON,
      device: asked.device,
    });

    clock.advance(REST_SECONDS);
    await repaint(element);
    expect(asked.done).toStrictEqual([]);
  });

  it('says on screen when an alert it promised did not happen', async () => {
    // The failure this whole path exists for: a permission taken back from the address
    // bar between the press and the set. Nothing here can make the notification appear,
    // so the least it can do is not pretend it did.
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock, {
      alerts: { sound: true, vibrate: false, notify: true },
      device: REFUSING,
    });

    clock.advance(REST_SECONDS);
    await repaint(element);

    await vi.waitFor(() => {
      expect(trouble(element)).toStrictEqual([
        REST_NOTES.alertTrouble.sound.refused,
        REST_NOTES.alertTrouble.notify.refused,
      ]);
    });
  });

  it('withdraws a complaint once the lifter makes the channel work', async () => {
    // The press after the fix: the ringer comes off silent, or the site is unblocked,
    // and the switch is tried again. A sentence about a fault that has been dealt with
    // is the same defect as no sentence at all, one screen further on.
    const clock = clockAt(AT_START);
    let audible = false;
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock, {
      alerts: NOTHING_ON,
      device: { tone: () => Promise.resolve(audible) },
    });
    await openAlerts(element);
    await tick(element, 'sound');
    await vi.waitFor(() => {
      expect(trouble(element)).toStrictEqual([REST_NOTES.alertTrouble.sound.refused]);
    });

    audible = true;
    await tick(element, 'sound');
    await vi.waitFor(() => {
      expect(trouble(element)).toStrictEqual([]);
    });
  });

  it('withdraws a complaint when the lifter switches that channel off', async () => {
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock, {
      alerts: { ...NOTHING_ON, notify: true },
      device: REFUSING,
    });

    clock.advance(REST_SECONDS);
    await repaint(element);
    await vi.waitFor(() => {
      expect(trouble(element)).toStrictEqual([REST_NOTES.alertTrouble.notify.refused]);
    });

    await openAlerts(element);
    expect(box(element, 'notify').checked).toBe(true);
    await tick(element, 'notify');

    // Off needs no proof, and it takes the fault report with it: nothing is being
    // promised any more, so there is nothing left to have failed.
    expect(trouble(element)).toStrictEqual([]);
  });

  it('keeps the tick inside the band, where two other screens listen for the same event', async () => {
    // It is `composed`, and the detail is a bare string that means a plate denomination
    // on one of the screens above this one.
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock, {
      alerts: NOTHING_ON,
      device: willing().device,
    });
    await openAlerts(element);

    let escaped = 0;
    const count = (): void => {
      escaped += 1;
    };
    document.body.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, count);
    teardown.push(() => {
      document.body.removeEventListener(TOGGLE_GROUP_CHANGE_EVENT, count);
    });
    await tick(element, 'sound');

    expect(escaped).toBe(0);
  });

  it('withdraws a complaint about a channel that has since been switched off', async () => {
    // The settings can change from under the band -- another tab, or a root that stores
    // them somewhere this element cannot see -- and a sentence saying the tone failed
    // outlives the tone being asked for. A rest ending with nothing switched on is
    // therefore still a firing: it delivers nothing and clears what is on screen.
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock, {
      alerts: { ...NOTHING_ON, sound: true },
      device: REFUSING,
    });

    clock.advance(REST_SECONDS);
    await repaint(element);
    await vi.waitFor(() => {
      expect(trouble(element)).toStrictEqual([REST_NOTES.alertTrouble.sound.refused]);
    });

    element.alerts = NOTHING_ON;
    element.timer = startRest(REST_SECONDS, clock.now());
    await element.updateComplete;
    clock.advance(REST_SECONDS);
    await repaint(element);

    await vi.waitFor(() => {
      expect(trouble(element)).toStrictEqual([]);
    });
  });

  it('has no accessibility violations with the switches open', async () => {
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock, {
      alerts: NOTHING_ON,
      device: willing().device,
    });
    await openAlerts(element);
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toStrictEqual([]);
  });
});

describe('what is announced', () => {
  it('keeps the digits out of the live regions and the sentences in them', async () => {
    // A countdown in a live region announces itself once a second over the top of
    // everything else the device is saying, for three minutes. The one thing worth
    // interrupting for is that the rest is over.
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    const live = shadow(element).querySelectorAll('[aria-live]');
    // Two: the state of the rest, and anything that went wrong saying it is up. One
    // region holding both would mean an apology about a tone replacing the sentence
    // that matters.
    expect(live).toHaveLength(2);

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

  it('has the region a failure would be reported in, before there is one to report', async () => {
    // Unconditional, and on a band that is offering no alerts at all. A region created
    // at the moment its first sentence appears is announced by roughly half the engines
    // and by none of them reliably -- so an empty paragraph is the feature.
    const clock = clockAt(AT_START);
    const element = await mount(startRest(REST_SECONDS, clock.now()), clock);
    const region = shadow(element).querySelector('.trouble');
    if (region === null) throw new Error('the trouble region is not on screen.');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent.trim()).toBe('');
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
