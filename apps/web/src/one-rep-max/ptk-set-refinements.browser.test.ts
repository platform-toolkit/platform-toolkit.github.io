// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The folded questions, and the sentence that has to be true while they are hidden.
 *
 * Two things here can only be checked in a real browser. The first is the
 * summary: `ptk-disclosure` renders it inside its own shadow root, so a section
 * visibly showing a sentence reads back as an empty string from this element's
 * root, and both a `toContain` and a `not.toContain` would be wrong for the same
 * reason (§12.1). The second is the wiring: every answer here leaves a control's
 * own shadow tree as a composed event, and a listener that reads `event.target`
 * instead of `composedPath()` sees the host with an empty dataset — controls that
 * visibly respond while nothing is recorded (§5.8). An emulated DOM can get
 * either of those subtly right and hide a shipped fault.
 *
 * Every entry below comes from `describedSet`, so a fixture cannot describe a set
 * the tool has no way to produce — a technique identifier from the wrong lift, in
 * particular, which the domain refuses outright.
 */
import {
  CHOICE_CHANGE_EVENT,
  PtkChoiceGroup,
  type ChoiceChangeDetail,
} from '@platform-toolkit/ui/ptk-choice-group';
import {
  PtkToggleGroup,
  TOGGLE_GROUP_CHANGE_EVENT,
  type ToggleGroupChangeDetail,
} from '@platform-toolkit/ui/ptk-toggle-group';
// Padding, gaps and the 44px tap-target floor all read custom properties, and a
// declaration referencing an undefined one is dropped -- so without this the
// layout measured at 320px below is not the layout that ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '@platform-toolkit/ui/deep-text';
import { describedSet, weighing } from './estimate-fixture.js';
import {
  ASSISTED_FIELD,
  EXPERIENCE_FIELD,
  FORM_QUALITY_FIELD,
  FRESHNESS_FIELD,
  ROUND_TO_FIELD,
  SEX_FIELD,
  TECHNIQUE_FIELD,
} from './fields.js';
import type { EstimateEntry } from './session.js';
import type { PtkSetRefinements } from './ptk-set-refinements.js';
import './ptk-set-refinements.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

interface Options {
  readonly entry?: EstimateEntry;
  readonly within?: HTMLElement;
  /** Unfolds the section, which every test that reads a control needs. */
  readonly open?: boolean;
}

async function mount(options: Options = {}): Promise<PtkSetRefinements> {
  const element = document.createElement('ptk-set-refinements');
  element.entry = options.entry ?? describedSet();
  (options.within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  if (options.open ?? true) {
    // Set on the disclosure rather than clicking its summary, because what is
    // being tested below is never the fold itself -- `ptk-disclosure` has its own
    // suite for that -- and `<details>` fires `toggle` asynchronously (§5.8), so
    // a click here would add a wait to every test to prove somebody else's point.
    const disclosure = element.shadowRoot?.querySelector('ptk-disclosure');
    if (disclosure === null || disclosure === undefined) throw new Error('No disclosure rendered.');
    disclosure.open = true;
    await element.updateComplete;
  }
  return element;
}

/** What stays on screen while the section is folded. */
function summaryOf(element: PtkSetRefinements): string {
  const disclosure = element.shadowRoot?.querySelector('ptk-disclosure');
  if (disclosure === null || disclosure === undefined) throw new Error('No disclosure rendered.');
  return disclosure.getAttribute('summary') ?? '';
}

/**
 * The one choice group answering a field.
 *
 * Narrowed with `instanceof` rather than through `querySelector<T>`, which is an
 * assertion wearing a function's clothes: a mistyped field name would otherwise
 * hand back a toggle group typed as a choice group and fail three lines later as
 * a missing property.
 */
function group(element: PtkSetRefinements, field: string): PtkChoiceGroup {
  const found = element.shadowRoot?.querySelector(`ptk-choice-group[data-field="${field}"]`);
  if (!(found instanceof PtkChoiceGroup)) throw new Error(`No choice group for "${field}".`);
  return found;
}

function toggles(element: PtkSetRefinements, field: string): PtkToggleGroup {
  const found = element.shadowRoot?.querySelector(`ptk-toggle-group[data-field="${field}"]`);
  if (!(found instanceof PtkToggleGroup)) throw new Error(`No toggle group for "${field}".`);
  return found;
}

/** Every option a group offers, in the order it offers them. */
function labels(host: PtkChoiceGroup | PtkToggleGroup): string[] {
  return [...(host.shadowRoot?.querySelectorAll('label') ?? [])].map((label) =>
    label.textContent.trim(),
  );
}

/** Clicks an option the way a lifter would: on the input inside the control. */
async function click(
  element: PtkSetRefinements,
  host: PtkChoiceGroup | PtkToggleGroup,
  value: string,
): Promise<void> {
  for (const input of host.shadowRoot?.querySelectorAll('input') ?? []) {
    if (input.value === value) {
      input.click();
      await element.updateComplete;
      return;
    }
  }
  throw new Error(`No option "${value}" to click.`);
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

describe('ptk-set-refinements', () => {
  it('re-renders when the entry is replaced after the first render', async () => {
    // The canary for Lit's decorator configuration (§5.8). Everything else in
    // this file passes when it is wrong, and the section simply stops updating.
    const element = await mount();
    expect(group(element, FRESHNESS_FIELD).value).toBe('unstated');

    element.entry = describedSet({ freshness: 'fresh' });
    await element.updateComplete;

    expect(group(element, FRESHNESS_FIELD).value).toBe('fresh');
  });

  it('says nothing has been added while nothing has', async () => {
    // The opening state, and the sentence has to name what is unstated rather
    // than staying silent: a fold that reads as empty is a fold a lifter has no
    // reason to open, and the two questions behind it are the ones that cost the
    // grade most often.
    expect(summaryOf(await mount())).toBe(
      'Nothing added. Movement standard, fatigue, experience and reported sex are all unstated.',
    );
  });

  it('names reported sex as unstated, because the result panel mentions it', async () => {
    // Reported as "mentions sex, but doesn't ask for it". The result panel notes
    // that sex-specific weighting is off; if the only other place sex appears is
    // behind a fold whose summary lists three other questions and not this one,
    // a lifter has been told about a setting and then told it does not exist.
    expect(summaryOf(await mount())).toContain('reported sex');
  });

  it('stops calling it unstated once it has been answered', async () => {
    // The complement, and the reason it is the opening sentence that names sex
    // rather than a clause appended to every summary: answered, it is already in
    // the list and saying both would be the fold contradicting itself.
    const element = await mount({ entry: describedSet({ sex: 'man' }) });

    expect(summaryOf(element)).toBe('Added: man.');
    expect(summaryOf(element)).not.toContain('unstated');
  });

  it('names every answer that moves something, and nothing else, while folded', async () => {
    const element = await mount({
      entry: describedSet({
        techniqueId: 'competition-squat',
        freshness: 'fresh',
        formQuality: 'consistent',
        experience: 'experienced',
        sex: 'woman',
        assisted: true,
      }),
    });

    expect(summaryOf(element)).toBe(
      'Added: competition depth, no wraps, fresh, form held, experienced lifter, woman, spotter assisted.',
    );
  });

  it('leaves a standard out of the summary when the answer was "not sure"', async () => {
    // `squat-unstated` is a real answer with a real label, and listing it would
    // make the summary longest exactly when the least has been said.
    const element = await mount({ entry: describedSet({ freshness: 'fatigued' }) });
    expect(summaryOf(element)).toBe('Added: fatigued.');
  });

  it('always states a spotter, even when it is the only thing said', async () => {
    // This is the one answer that stops the estimate rather than adjusting it,
    // so it may never be true and invisible at the same time.
    const element = await mount({ entry: describedSet({ assisted: true }) });
    expect(summaryOf(element)).toBe('Added: spotter assisted.');
  });

  it('shows the chosen standard’s note and only that one', async () => {
    // Five tiles each carrying a sentence is a wall of text on a phone, so the
    // notes live under the group and only the selected one is rendered.
    const unsure = await mount();
    expect(deepText(unsure)).toContain('The estimate describes whatever squat was performed.');
    expect(deepText(unsure)).not.toContain('The estimate describes a competition squat.');

    const competition = await mount({ entry: describedSet({ techniqueId: 'competition-squat' }) });
    expect(deepText(competition)).toContain('The estimate describes a competition squat.');
  });

  it('offers the standards belonging to the lift, not a fixed list', async () => {
    const element = await mount({ entry: describedSet({ lift: 'deadlift' }) });
    const offered = labels(group(element, TECHNIQUE_FIELD));

    expect(offered).toContain('Sumo, no straps');
    expect(offered).toContain('Conventional, no straps');
    // A squat standard reaching a deadlift is not a cosmetic fault: the domain
    // refuses the request outright, so the tool would answer nothing at all.
    expect(offered).not.toContain('Competition depth, no wraps');
  });

  it('offers the rounding steps that belong to the unit on the entry', async () => {
    const kilograms = await mount();
    expect(labels(group(kilograms, ROUND_TO_FIELD))).toEqual(['0.5 kg', '1 kg', '2.5 kg']);

    const pounds = await mount({ entry: describedSet(weighing('315 lb')) });
    expect(labels(group(pounds, ROUND_TO_FIELD))).toEqual(['1 lb', '2.5 lb', '5 lb']);
  });

  it('tags every control with the field the root routes on', async () => {
    const element = await mount();
    const fields = [...(element.shadowRoot?.querySelectorAll('[data-field]') ?? [])].map(
      (control) => control.getAttribute('data-field'),
    );

    // Order included: it is the order §5.2 fixes the questions in, and a
    // rearrangement is a product change rather than a refactor.
    expect(fields).toEqual([
      TECHNIQUE_FIELD,
      FRESHNESS_FIELD,
      FORM_QUALITY_FIELD,
      EXPERIENCE_FIELD,
      SEX_FIELD,
      ASSISTED_FIELD,
      ROUND_TO_FIELD,
    ]);
  });

  it('reports an answer out of the shadow root, tagged with its field', async () => {
    const element = await mount();
    const seen = watch();

    await click(element, group(element, FRESHNESS_FIELD), 'fatigued');

    expect(seen).toEqual([{ field: FRESHNESS_FIELD, value: 'fatigued' }]);
  });

  it('reports declining a question as its own answer, not as silence', async () => {
    // A lifter who answered and then took it back has to be able to. "Rather not
    // say" is the opening state of both this question and the sex one -- the
    // tool asks for nothing until it is given -- so the interesting direction is
    // back towards it, and the event has to carry the same word as any other
    // answer rather than an empty string the root would read as noise.
    const element = await mount({ entry: describedSet({ experience: 'intermediate' }) });
    expect(group(element, EXPERIENCE_FIELD).value).toBe('intermediate');
    const seen = watch();

    await click(element, group(element, EXPERIENCE_FIELD), 'declined');

    expect(seen).toEqual([{ field: EXPERIENCE_FIELD, value: 'declined' }]);
  });

  it('reports the whole assistance selection rather than the box that moved', async () => {
    const element = await mount();
    const seen: ToggleGroupChangeDetail[] = [];
    const listener = (event: CustomEvent<ToggleGroupChangeDetail>): void => {
      seen.push(event.detail);
    };
    document.body.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(TOGGLE_GROUP_CHANGE_EVENT, listener);
    });

    await click(element, toggles(element, ASSISTED_FIELD), 'assisted');

    expect(seen.at(-1)?.values).toEqual(['assisted']);
  });

  it('reflects an assisted entry back into the toggle', async () => {
    const element = await mount({ entry: describedSet({ assisted: true }) });
    const box = toggles(element, ASSISTED_FIELD).shadowRoot?.querySelector('input');
    expect(box?.checked).toBe(true);
  });

  it('says what the sex question is for, next to the question', async () => {
    // Collected for one reason and it changes one thing. A question with no
    // stated purpose is a question a lifter is right to refuse.
    const element = await mount();
    expect(deepText(element)).toContain(
      'Two of the studies behind the weighting reported results separately for men and women.',
    );
    expect(deepText(element)).toContain('still produces an estimate');
  });

  it('has no accessibility violations with every question showing', async () => {
    const element = await mount();
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with the section open', async () => {
    // Seven groups of tiles, the longest of them carrying a description line —
    // the widest thing in the tool that is not a table.
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
