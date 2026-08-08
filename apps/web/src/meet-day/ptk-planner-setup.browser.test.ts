// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §6.2's four questions, and the three states the federation list arrives in.
 *
 * Two things here need a real browser. The first is the wiring: every answer on
 * this screen leaves a choice group's own shadow tree as a composed event, and a
 * root that read `event.target` instead of `composedPath()` would see the host
 * with an empty dataset -- controls that visibly respond while nothing is
 * recorded (§5.8). The second is the note under the federation, which is
 * interpolated into a paragraph inside this element's root from figures held on
 * a profile; an emulated DOM can get either subtly right and hide a shipped
 * fault.
 *
 * The increments are asserted against a *patched* profile as well as the
 * fixture's own, because the assertion worth making is not "it prints 0.5" but
 * "it prints whatever the chosen rule book says". §5.1 keeps federation numbers
 * out of source, and a test pinned to one figure is the pressure that eventually
 * puts one there.
 */
import type { MeetRuleProfile } from '@platform-toolkit/data-contracts';
import {
  CHOICE_CHANGE_EVENT,
  PtkChoiceGroup,
  type ChoiceChangeDetail,
} from '@platform-toolkit/ui/ptk-choice-group';
// Padding, gaps and the 44px tap-target floor all read custom properties, and a
// declaration referencing an undefined one is dropped -- so without this the
// layout measured at 320px below is not the layout that ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import {
  FEDERATION_FIELD,
  FIRST_MEET_FIELD,
  FORMAT_FIELD,
  GOAL_FIELD,
  UNIT_FIELD,
} from './fields.js';
import { MEET_PROFILE_FIXTURE } from './meet-rules.fixture.js';
import { PROBABILITY_WORDS, PROFILE_FIXTURES, plannerSession } from './planner-fixture.js';
import type { PlannerSession } from './session.js';
import type { ProfilesStatus, PtkPlannerSetup } from './ptk-planner-setup.js';
import './ptk-planner-setup.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

interface Options {
  readonly session?: PlannerSession;
  readonly profiles?: readonly MeetRuleProfile[];
  readonly status?: ProfilesStatus;
  readonly within?: HTMLElement;
}

async function mount(options: Options = {}): Promise<PtkPlannerSetup> {
  const element = document.createElement('ptk-planner-setup');
  element.session = options.session ?? plannerSession();
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
 * The one choice group answering a field.
 *
 * Narrowed with `instanceof` rather than through `querySelector<T>`, which is an
 * assertion wearing a function's clothes: a mistyped field name would otherwise
 * hand back `null` typed as a choice group and fail three lines later as a
 * missing property.
 */
function group(element: PtkPlannerSetup, field: string): PtkChoiceGroup {
  const found = element.shadowRoot?.querySelector(`ptk-choice-group[data-field="${field}"]`);
  if (!(found instanceof PtkChoiceGroup)) throw new Error(`No choice group for "${field}".`);
  return found;
}

/** Every option a group offers, in the order it offers them. */
function labels(host: PtkChoiceGroup): string[] {
  return [...(host.shadowRoot?.querySelectorAll('label') ?? [])].map((label) =>
    label.textContent.trim(),
  );
}

/** Answers a question by clicking the radio, the way a lifter does. */
async function choose(element: PtkPlannerSetup, field: string, value: string): Promise<void> {
  const radio = [...(group(element, field).shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.value === value,
  );
  if (radio === undefined) throw new Error(`No option "${value}" for "${field}".`);
  radio.click();
  await element.updateComplete;
}

/**
 * Records answers from outside the element, and the field each was tagged with.
 *
 * On `document.body`, not on the element: what is being proved is that the event
 * crossed the shadow boundary carrying a `data-field` the root can route on, and
 * a listener on the element itself would pass without either.
 */
function watch(): { field: string | null; value: string }[] {
  const seen: { field: string | null; value: string }[] = [];
  const listener = (event: CustomEvent<ChoiceChangeDetail>): void => {
    seen.push({ field: fieldOf(event), value: event.detail.value });
  };
  document.body.addEventListener(CHOICE_CHANGE_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(CHOICE_CHANGE_EVENT, listener);
  });
  return seen;
}

/** The same walk the root does: the nearest `data-field` on the composed path. */
function fieldOf(event: Event): string | null {
  for (const target of event.composedPath()) {
    if (target instanceof HTMLElement && target.dataset['field'] !== undefined) {
      return target.dataset['field'];
    }
  }
  return null;
}

describe('ptk-planner-setup', () => {
  it('re-renders when the session is replaced after the first render', async () => {
    // The canary for Lit's decorator configuration (§5.8). Everything else in
    // this file passes when it is wrong, and the screen simply stops updating.
    const element = await mount();
    expect(group(element, GOAL_FIELD).value).toBe('balanced');

    element.session = plannerSession({ goal: 'personal-record' });
    await element.updateComplete;

    expect(group(element, GOAL_FIELD).value).toBe('personal-record');
  });

  it('says the rule books are loading before the read finishes', async () => {
    const element = await mount({ status: 'loading', profiles: [] });
    expect(deepText(element)).toContain('Loading the published rule books');
    // The question cannot be asked yet, and an empty list of federations would
    // read as a federation-less meet rather than as a read still running.
    expect(element.shadowRoot?.querySelector(`[data-field="${FEDERATION_FIELD}"]`)).toBeNull();
  });

  it('says what a failed read costs, in an error tone', async () => {
    const element = await mount({ status: 'failed', profiles: [] });
    const notice = element.shadowRoot?.querySelector('ptk-notice');

    expect(notice?.getAttribute('tone')).toBe('error');
    // Naming the consequence rather than only the failure: without a rule book
    // nothing below can be checked against a federation's increments, which is
    // most of what this tool does.
    expect(deepText(element)).toContain('attempts cannot be checked');
  });

  it('does not call an empty corpus an error', async () => {
    // Nothing went wrong, and a reload will not change it -- so offering one
    // would send a lifter round a loop that cannot end.
    const element = await mount({ status: 'ready', profiles: [] });
    const notice = element.shadowRoot?.querySelector('ptk-notice');

    expect(deepText(element)).toContain('No federation rule books have been published yet.');
    expect(notice?.getAttribute('tone')).toBe('info');
  });

  it('offers one federation per published profile, described by its source', async () => {
    const element = await mount();
    const federations = deepText(group(element, FEDERATION_FIELD));

    expect(federations).toContain(MEET_PROFILE_FIXTURE.label);
    // The source label and not only the federation name: two rule books from the
    // same federation differ by revision, and the source is where that shows.
    expect(federations).toContain('Technical Rules');
  });

  it('names the chosen rule book’s increments, read off the profile', async () => {
    const element = await mount();
    expect(deepText(element)).toContain('Bars load to 0.5 kg multiples');
    expect(deepText(element)).toContain('at least 1 kg above the one before');
  });

  it('names a different rule book’s increments when a different one is chosen', async () => {
    // The assertion the previous test cannot make on its own: what is being
    // checked is that the sentence follows the profile, not that it prints the
    // fixture's figures. A constant in the source would pass that test forever.
    const coarse: MeetRuleProfile = {
      ...MEET_PROFILE_FIXTURE,
      id: 'coarse',
      label: 'Coarse Example Federation',
      barMultipleKilograms: 2.5,
      minimumProgressionKilograms: 5,
    };
    const element = await mount({
      profiles: [MEET_PROFILE_FIXTURE, coarse],
      session: plannerSession({ federationId: coarse.id }),
    });

    expect(deepText(element)).toContain('Bars load to 2.5 kg multiples');
    expect(deepText(element)).toContain('at least 5 kg above the one before');
  });

  it('says nothing about increments before a federation is chosen', async () => {
    // No stand-in, deliberately. A guess at the most common rule book would be a
    // screen quietly planning against a federation nobody picked.
    const element = await mount({ session: plannerSession({ federationId: '' }) });
    expect(deepText(element)).not.toContain('Bars load to');
  });

  it('tags every question with the field the root routes on', async () => {
    const element = await mount();
    const fields = [...(element.shadowRoot?.querySelectorAll('[data-field]') ?? [])].map(
      (control) => control.getAttribute('data-field'),
    );

    // Order included: §6.2 asks them in the order of their consequences -- the
    // federation decides what a legal weight is, the format decides which lifts
    // exist, the unit decides how every field below is read, and the first-meet
    // answer decides which goal the list opens on. A rearrangement is a product
    // change rather than a refactor.
    expect(fields).toEqual([
      FEDERATION_FIELD,
      FORMAT_FIELD,
      UNIT_FIELD,
      FIRST_MEET_FIELD,
      GOAL_FIELD,
    ]);
  });

  it('reports a federation choice out of the shadow root, tagged with its field', async () => {
    const element = await mount({ session: plannerSession({ federationId: '' }) });
    const seen = watch();

    await choose(element, FEDERATION_FIELD, MEET_PROFILE_FIXTURE.id);

    expect(seen).toEqual([{ field: FEDERATION_FIELD, value: MEET_PROFILE_FIXTURE.id }]);
  });

  it('reports declining the first-meet question as its own answer, not as silence', async () => {
    // A lifter who answered and then took it back has to be able to, and the
    // event has to carry the same word as any other answer rather than an empty
    // string the root would read as noise. It is not a cosmetic answer either:
    // §6.3's default goal is conditional on it.
    const element = await mount({ session: plannerSession({ firstMeet: true }) });
    expect(group(element, FIRST_MEET_FIELD).value).toBe('yes');
    const seen = watch();

    await choose(element, FIRST_MEET_FIELD, 'unstated');

    expect(seen).toEqual([{ field: FIRST_MEET_FIELD, value: 'unstated' }]);
  });

  it('offers kilograms before pounds', async () => {
    // Unlike tool 4's list, and on purpose: an attempt card is written in
    // kilograms on every platform this planner has a rule profile for, so
    // kilograms is the unit the artefact is produced in and pounds is the
    // reading aid.
    expect(labels(group(await mount(), UNIT_FIELD))).toEqual(['Kilograms', 'Pounds']);
  });

  it('says where an ambitious goal puts the risk, beside the goals', async () => {
    // §6.3's one hard rule is that an aggressive goal must not make the opener
    // aggressive. Eight ambitions listed with no mention of where the risk goes
    // invites exactly the reading it forbids.
    const element = await mount();
    expect(deepText(element)).toContain(
      'The goal decides how much is asked of the third attempt, and nothing here makes an opener a gamble.',
    );
  });

  it('offers the goals without saying anything about how likely an attempt is', async () => {
    // §10.2 bans probability vocabulary outright, and the goal list is where it
    // is most tempting -- every one of these eight is a statement about how a
    // day might go. `PROBABILITY_WORDS` says what is on the list and, more
    // usefully, why "percent" is not.
    const text = deepText(await mount()).toLowerCase();
    for (const banned of PROBABILITY_WORDS) {
      expect(text).not.toContain(banned);
    }
  });

  it('has no accessibility violations with the questions showing', async () => {
    const element = await mount();
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column', async () => {
    // Eight goal tiles, most carrying a description line: the widest thing on
    // this screen, and the layout a lifter actually sees.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    await mount({ within: frame });

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
