// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The root, and the four things only the root can be wrong about.
 *
 * Every element below it has its own browser test, and none of those can fail
 * for any of the reasons here. What this file covers is the wiring between them:
 *
 * 1. **Routing.** Every answer in this tool leaves a shared component's own
 *    shadow tree as a composed event, and the root identifies it by walking
 *    `event.composedPath()` for `data-field` and `data-lift`. A root that read
 *    `event.target` would see itself, with an empty dataset -- controls that
 *    visibly respond while nothing is recorded (§5.8). That failure is invisible
 *    to a component test, because inside a component the target is the control.
 * 2. **The transport seam.** `FEDERATION_CHANGE_EVENT` is how the chosen
 *    federation reaches `view.ts`, which is the only file in the tool that knows
 *    a network exists. It carries the identifier rather than leaving the listener
 *    to read the property back, and a test that asserted only that it fired would
 *    pass against the version that races.
 * 3. **The five plan-slot answers**, of which exactly one is a fault. A screen
 *    that greeted a still-running read with a warning would open by reporting a
 *    problem that resolves itself in a hundred millisecond.
 * 4. **The unit change**, which is the one interaction that touches every figure
 *    on screen at once and is the reason `typedIn` exists.
 *
 * Every session here is reached by pressing something, not by assignment. The
 * root's `session` is private on purpose, and driving it is the only way to prove
 * the path a lifter takes rather than the path a test can reach.
 */
import type { MeetRuleProfile } from '@platform-toolkit/data-contracts';
import {
  createPreferenceStore,
  memoryPreferenceStorage,
  type PreferenceStore,
} from '@platform-toolkit/preferences';
import { NUMBER_FIELD_CHANGE_EVENT, type NumberFieldChangeDetail } from '@platform-toolkit/ui';
// Padding, gaps and the 44px tap-target floor all read custom properties, and a
// declaration referencing an undefined one is dropped -- so without this the
// layout measured at 320px below is not the layout that ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import { CONVERT_ANSWER, KEEP_ANSWER } from './copy.js';
import {
  CONFIRM_FIELD,
  CONVERT_FIELD,
  EXPECTED_MAXIMUM_FIELD,
  FEDERATION_FIELD,
  FORMAT_FIELD,
  UNIT_FIELD,
} from './fields.js';
import { MEET_PROFILE_FIXTURE } from './meet-rules.fixture.js';
import { PROBABILITY_WORDS, PROFILE_FIXTURES, plannerSession } from './planner-fixture.js';
import { CONFIRM_VALUE } from './ptk-plan-method.js';
import type { ProfilesStatus } from './ptk-planner-setup.js';
import {
  FEDERATION_CHANGE_EVENT,
  type FederationChangeDetail,
  type PtkMeetDayPlanner,
} from './ptk-meet-day-planner.js';
import './ptk-meet-day-planner.js';
import { MEET_DAY_PREFERENCES, loadSession, saveSession } from './session.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

interface Options {
  readonly settings?: PreferenceStore;
  readonly profiles?: readonly MeetRuleProfile[];
  readonly status?: ProfilesStatus;
  readonly within?: HTMLElement;
}

/** A store with no browser behind it, so no test can reach the real device. */
function device(): PreferenceStore {
  return createPreferenceStore(memoryPreferenceStorage());
}

async function mount(options: Options = {}): Promise<PtkMeetDayPlanner> {
  const element = document.createElement('ptk-meet-day-planner');
  element.settings = options.settings ?? device();
  element.profiles = options.profiles ?? PROFILE_FIXTURES;
  element.status = options.status ?? 'ready';
  (options.within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/**
 * A mounted root with a federation already chosen, by pressing the tile.
 *
 * Not by seeding the store: `saveSession` deliberately does not persist the
 * federation (a federation is a fact about one meet, not a preference), so
 * pressing it is not one way in among several -- it is the only one.
 */
async function mountChosen(options: Options = {}): Promise<PtkMeetDayPlanner> {
  const element = await mount(options);
  await choose(element, FEDERATION_FIELD, (options.profiles ?? PROFILE_FIXTURES)[0]?.id ?? '');
  return element;
}

/** Every element in the tool, across all four child shadow trees. */
function controls(element: PtkMeetDayPlanner, selector: string): Element[] {
  const roots = [
    element.shadowRoot,
    ...[...(element.shadowRoot?.querySelectorAll('*') ?? [])].map((child) => child.shadowRoot),
  ];
  return roots.flatMap((root) => [...(root?.querySelectorAll(selector) ?? [])]);
}

/**
 * The one control answering a field, wherever in the tool it lives.
 *
 * Searched across the children rather than named by child, because which element
 * owns a question is this tool's business and not this test's: the confirmation
 * moved from the plan screen to the method element while it was being written,
 * and every test naming its owner would have failed for no reason.
 */
function control(element: PtkMeetDayPlanner, field: string, lift?: string): Element {
  const selector =
    lift === undefined ? `[data-field="${field}"]` : `[data-field="${field}"][data-lift="${lift}"]`;
  const found = controls(element, selector);
  if (found.length !== 1) {
    throw new Error(`Expected one control for "${field}", found ${String(found.length)}.`);
  }
  // Checked rather than asserted: `found[0]` is `Element | undefined` under
  // `noUncheckedIndexedAccess`, and the length check above does not narrow it.
  const first = found[0];
  if (first === undefined) throw new Error(`No control for "${field}".`);
  return first;
}

/** Answers a question by clicking the radio, the way a lifter does. */
async function choose(
  element: PtkMeetDayPlanner,
  field: string,
  value: string,
  lift?: string,
): Promise<void> {
  const radio = [
    ...(control(element, field, lift).shadowRoot?.querySelectorAll('input') ?? []),
  ].find((input) => input.value === value);
  if (radio === undefined) throw new Error(`No option "${value}" for "${field}".`);
  radio.click();
  await element.updateComplete;
}

/** Types into a number field, keystroke and all. */
async function type(
  element: PtkMeetDayPlanner,
  field: string,
  text: string,
  lift?: string,
): Promise<void> {
  const input = control(element, field, lift).shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No input for "${field}".`);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** Ticks or unticks the confirmation for one lift. */
async function confirm(element: PtkMeetDayPlanner, lift: string): Promise<void> {
  const box = [
    ...(control(element, CONFIRM_FIELD, lift).shadowRoot?.querySelectorAll('input') ?? []),
  ].find((input) => input.value === CONFIRM_VALUE);
  if (box === undefined) throw new Error(`No confirmation for "${lift}".`);
  box.click();
  await element.updateComplete;
}

/**
 * The plan screen, which is present whenever there is a rule book to plan under.
 *
 * Its presence is not the same question as whether a plan has been drawn: the
 * screen is what says "nothing planned yet" and "planned from 200 kg once you
 * agree to it above", so it appears the moment a federation is chosen. Use
 * {@link attemptLists} for the other question.
 */
function planScreen(element: PtkMeetDayPlanner): Element | null {
  return element.shadowRoot?.querySelector('ptk-plan-screen') ?? null;
}

/**
 * How many lifts have three attempts on screen.
 *
 * The one unambiguous signal that §7's gate opened. Counted rather than asked as
 * a boolean because the gate is per lift, and a change that let one lift through
 * on another lift's agreement would satisfy any yes-or-no assertion.
 */
function attemptLists(element: PtkMeetDayPlanner): number {
  return planScreen(element)?.shadowRoot?.querySelectorAll('ol.attempts').length ?? 0;
}

/** Records federation changes as the transport sees them, off `document.body`. */
function watchFederation(): FederationChangeDetail[] {
  const seen: FederationChangeDetail[] = [];
  const listener = (event: CustomEvent<FederationChangeDetail>): void => {
    seen.push(event.detail);
  };
  document.body.addEventListener(FEDERATION_CHANGE_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(FEDERATION_CHANGE_EVENT, listener);
  });
  return seen;
}

/** A federation the domain refuses, published exactly as a real read would be. */
const REFUSED_PROFILE: MeetRuleProfile = {
  ...MEET_PROFILE_FIXTURE,
  // A step after "declared-tie", which is the answer given when nothing further
  // separates two lifters -- so everything after it is unreachable and the list
  // says two different things about how a tie resolves. Structural rather than
  // numeric, so it stays refused if an increment is ever revised.
  tieBreak: ['declared-tie', 'lighter-bodyweight'],
};

describe('ptk-meet-day-planner', () => {
  it('routes an answer by its tag on the composed path, not by the event target', async () => {
    // The §5.8 canary, and the one failure that makes every control on the screen
    // respond while nothing at all is recorded. `event.target` here is this host,
    // whose dataset is empty; the field is only visible on the path.
    const element = await mount();

    await choose(element, FEDERATION_FIELD, MEET_PROFILE_FIXTURE.id);

    expect(deepText(element)).toContain('Bars load to 0.5 kg multiples');
  });

  it('tells the transport which federation was chosen, by identifier', async () => {
    // The identifier travels in the event rather than being read back off this
    // element: a listener reading the property would be reading it after a Lit
    // update it cannot await, and the chart it fetched would belong to whichever
    // federation happened to be current by then.
    const element = await mount();
    const seen = watchFederation();

    await choose(element, FEDERATION_FIELD, MEET_PROFILE_FIXTURE.id);

    expect(seen).toEqual([{ federationId: MEET_PROFILE_FIXTURE.id }]);
  });

  it('remembers the answers that belong to a device, and not the federation', async () => {
    const settings = device();
    const element = await mountChosen({ settings });

    await choose(element, UNIT_FIELD, 'lb');

    // The unit outlives the tab. The federation must not: a device that
    // remembered it would open the lifter's next meet planning against their
    // last one's rule book, which is invisible until three attempts come out on
    // the wrong increment.
    expect(settings.read(MEET_DAY_PREFERENCES.unit)).toBe('lb');
    expect(loadSession(settings).setup.federationId).toBe('');
  });

  it('restores a remembered device when the store is handed in', async () => {
    const settings = device();
    saveSession(settings, plannerSession({ unit: 'lb', format: 'push-pull' }));

    const element = await mount({ settings });

    // Push/pull, so the squat is not contested and asks for nothing.
    expect(controls(element, `[data-lift="bench"]`).length).toBeGreaterThan(0);
    expect(controls(element, `[data-lift="squat"]`)).toEqual([]);
  });

  it('re-restores when the store is replaced after the first render', async () => {
    // `willUpdate` and not `connectedCallback`: `view.ts` hands the store in
    // after mount, and restoring only on connect shows defaults over a device
    // that remembers something else -- on some visits and not others.
    const element = await mount();
    expect(control(element, FORMAT_FIELD).getAttribute('data-field')).toBe(FORMAT_FIELD);

    const remembering = device();
    saveSession(remembering, plannerSession({ format: 'bench-only' }));
    element.settings = remembering;
    await element.updateComplete;

    expect(controls(element, `[data-lift="bench"]`).length).toBeGreaterThan(0);
    expect(controls(element, `[data-lift="deadlift"]`)).toEqual([]);
  });

  it('drops an answer tagged with a lift the format does not contest', async () => {
    // Such a tag cannot have come from a control this tool rendered, so the guard
    // is against the tool contradicting itself rather than against a hostile
    // page. Asserting the figure is off screen would prove nothing -- a bench-only
    // screen shows no deadlift either way. What the guard actually buys only
    // becomes visible on the *next* answer: a lifter who corrects the format and
    // finds a weight they never typed sitting in the deadlift.
    const settings = device();
    saveSession(settings, plannerSession({ format: 'bench-only' }));
    const element = await mountChosen({ settings });

    const forged = document.createElement('div');
    forged.dataset['field'] = EXPECTED_MAXIMUM_FIELD;
    forged.dataset['lift'] = 'deadlift';
    element.append(forged);
    teardown.push(() => {
      forged.remove();
    });
    forged.dispatchEvent(
      new CustomEvent<NumberFieldChangeDetail>(NUMBER_FIELD_CHANGE_EVENT, {
        detail: { value: '250' },
        bubbles: true,
        composed: true,
      }),
    );
    await element.updateComplete;

    await choose(element, FORMAT_FIELD, 'full-power');

    const deadlift = control(element, EXPECTED_MAXIMUM_FIELD, 'deadlift').shadowRoot?.querySelector(
      'input',
    );
    // Positive control: the field the assertion is about is on screen and
    // readable. Without it a selector that stopped matching would read as a
    // dropped answer.
    expect(deadlift).not.toBeNull();
    expect(deadlift?.value).toBe('');
  });

  describe('the plan slot', () => {
    it('says where the plan will appear while the rule books load', async () => {
      const element = await mount({ status: 'loading', profiles: [] });
      expect(deepText(element)).toContain('once the rule books have loaded');
      // Not an error tone. It resolves itself in a hundred milliseconds, and a
      // screen that opens by reporting it has told the lifter off for arriving.
      expect(element.shadowRoot?.querySelector('ptk-notice[tone="error"]')).toBeNull();
    });

    it('says what a failed read costs', async () => {
      const element = await mount({ status: 'failed', profiles: [] });
      expect(deepText(element)).toContain('nothing to check an attempt against');
    });

    it('does not offer a retry for an empty corpus', async () => {
      // Nothing went wrong and a reload will not change it, so a retry would send
      // a lifter round a loop that cannot end.
      const element = await mount({ status: 'ready', profiles: [] });
      expect(deepText(element)).toContain('no plan can be drawn');
      expect(deepText(element)).not.toContain('Reload');
    });

    it('names the one thing standing between the lifter and a plan', async () => {
      const element = await mount();
      expect(deepText(element)).toContain('Choose a federation above');
      expect(planScreen(element)).toBeNull();
    });

    it('calls a refused rule book an error and points at what helps', async () => {
      // The only one of the five that is a fault, so the only one in an error
      // tone. The refusal's reasons are not on screen: they name somebody else's
      // published content, and a lifter cannot act on them.
      const problems = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      teardown.push(() => {
        problems.mockRestore();
      });

      const element = await mountChosen({ profiles: [REFUSED_PROFILE] });

      expect(element.shadowRoot?.querySelector('ptk-notice[tone="error"]')).not.toBeNull();
      expect(deepText(element)).toContain('Choosing another federation above');
      expect(deepText(element)).not.toContain('tie-break');
      expect(problems).toHaveBeenCalled();
    });

    it('reports a refusal once rather than on every keystroke', async () => {
      // The rules cache is here for the logging rather than for the arithmetic:
      // `render` runs on every keystroke, and a refusal reported a thousand times
      // is a refusal nobody can find.
      const problems = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      teardown.push(() => {
        problems.mockRestore();
      });

      const element = await mountChosen({ profiles: [REFUSED_PROFILE] });
      const afterChoosing = problems.mock.calls.length;
      // Positive control: the refusal was reported at all, so the assertion
      // below is about a count that started above zero.
      expect(afterChoosing).toBeGreaterThan(0);

      await choose(element, UNIT_FIELD, 'lb');
      await choose(element, UNIT_FIELD, 'kg');

      expect(problems.mock.calls.length).toBe(afterChoosing);
    });

    it('draws no attempts until the maximum has been agreed to', async () => {
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');

      // A figure on screen is not an agreement. §7 gates the attempts on one, and
      // the tool will not draw three off a number nobody underwrote -- so the
      // screen is there, saying what it is waiting for, with nothing on it.
      expect(planScreen(element)).not.toBeNull();
      expect(attemptLists(element)).toBe(0);
      expect(deepText(element)).toContain('once you agree to it above');

      await confirm(element, 'squat');

      // One lift, not three: the gate is per lift, and agreeing to a squat says
      // nothing about a bench.
      expect(attemptLists(element)).toBe(1);
    });
  });

  describe('changing the unit with figures on screen', () => {
    it('asks nothing when there is nothing to reinterpret', async () => {
      // Unconditional, this would be a box on the first tap of every session --
      // tool 2's finding (§10.2), and the reason `hasTypedWeights` exists.
      const element = await mountChosen();

      await choose(element, UNIT_FIELD, 'lb');

      expect(controls(element, `[data-field="${CONVERT_FIELD}"]`)).toEqual([]);
    });

    it('asks what to do with the digits already typed', async () => {
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');

      await choose(element, UNIT_FIELD, 'lb');

      expect(deepText(element)).toContain('were typed in kilograms');
    });

    it('leaves the digits alone until the question is answered', async () => {
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');

      await choose(element, UNIT_FIELD, 'lb');

      // The "keep" reading is the one that costs nothing to undo, so it is what
      // standing still means. Converting on the way past would rewrite a figure
      // the lifter never asked to change.
      const input = control(element, EXPECTED_MAXIMUM_FIELD, 'squat').shadowRoot?.querySelector(
        'input',
      );
      expect(input?.value).toBe('200');
    });

    it('converts the digits when that is the answer', async () => {
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');
      await choose(element, UNIT_FIELD, 'lb');

      await choose(element, CONVERT_FIELD, CONVERT_ANSWER);

      const input = control(element, EXPECTED_MAXIMUM_FIELD, 'squat').shadowRoot?.querySelector(
        'input',
      );
      expect(input?.value).not.toBe('200');
      expect(Number(input?.value)).toBeGreaterThan(400);
      // Answered, so the question goes away rather than sitting there answered.
      expect(controls(element, `[data-field="${CONVERT_FIELD}"]`)).toEqual([]);
    });

    it('keeps the digits when that is the answer, and still stops asking', async () => {
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');
      await choose(element, UNIT_FIELD, 'lb');

      await choose(element, CONVERT_FIELD, KEEP_ANSWER);

      const input = control(element, EXPECTED_MAXIMUM_FIELD, 'squat').shadowRoot?.querySelector(
        'input',
      );
      expect(input?.value).toBe('200');
      expect(controls(element, `[data-field="${CONVERT_FIELD}"]`)).toEqual([]);
    });

    it('drops the question when the unit comes back to the one typed in', async () => {
      // `typedIn` holds the original unit rather than the previous one, so a
      // lifter who flicks kg to lb and back finds the question gone rather than
      // reversed -- the digits never moved, and by then they are being read in
      // the unit they were typed in again.
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');

      await choose(element, UNIT_FIELD, 'lb');
      await choose(element, UNIT_FIELD, 'kg');

      expect(controls(element, `[data-field="${CONVERT_FIELD}"]`)).toEqual([]);
    });

    it('withdraws an agreement, because the figure now means something else', async () => {
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'bench');
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'deadlift');
      for (const lift of ['squat', 'bench', 'deadlift']) await confirm(element, lift);
      // Positive control: there was an agreement to withdraw. Without this the
      // assertion below passes against a tool that never drew a plan at all.
      expect(attemptLists(element)).toBe(3);

      await choose(element, UNIT_FIELD, 'lb');

      // Every one of them, not just the lift that was touched: the unit is one
      // answer over the whole screen, and 200 means something else now.
      expect(attemptLists(element)).toBe(0);
      expect(deepText(element)).toContain('have been un-ticked');
    });
  });

  it('withdraws an agreement when the figure under it is retyped', async () => {
    // The same rule arriving from the other direction, and the one §7 exists
    // for: a plan on screen must belong to a maximum the lifter agreed to, and
    // editing the maximum is exactly how that stops being true.
    const element = await mountChosen();
    for (const lift of ['squat', 'bench', 'deadlift']) {
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', lift);
      await confirm(element, lift);
    }
    expect(attemptLists(element)).toBe(3);

    await type(element, EXPECTED_MAXIMUM_FIELD, '210', 'squat');

    // Only the squat: the other two maximums did not move, and withdrawing an
    // agreement the lifter still holds would be its own kind of wrong.
    expect(attemptLists(element)).toBe(2);
  });

  it('says nothing anywhere about how likely an attempt is', async () => {
    // §10.2 across the whole assembled screen rather than one element at a time:
    // each child asserts this for its own text, and none of them can see the
    // sentence the root writes into the plan slot.
    const element = await mountChosen();
    for (const lift of ['squat', 'bench', 'deadlift']) {
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', lift);
      await confirm(element, lift);
    }

    const text = deepText(element).toLowerCase();
    // Positive control: there is a plan to read. An element that rendered nothing
    // contains no banned word either.
    expect(text).toContain('attempt');
    for (const banned of PROBABILITY_WORDS) {
      expect(text).not.toContain(banned);
    }
  });

  it('has no accessibility violations with the whole tool on screen', async () => {
    const element = await mountChosen();
    for (const lift of ['squat', 'bench', 'deadlift']) {
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', lift);
      await confirm(element, lift);
    }

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with a plan drawn', async () => {
    // The widest state of the widest tool in the collection: §6's eight goal
    // tiles, §7's per-lift fields, §8's disclosure and nine attempt cards, in 320
    // pixels (§5.7). The page-level check covers the gutter around it; this
    // covers the tool.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = await mountChosen({ within: frame });
    for (const lift of ['squat', 'bench', 'deadlift']) {
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', lift);
      await confirm(element, lift);
    }

    expect(planScreen(element)).not.toBeNull();
    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
