// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The whole tool, driven the way a lifter drives it, in a real browser.
 *
 * Every other suite in this package tests a function against a fixture. This one
 * tests the *wiring*: seven custom elements in six shadow roots, connected by composed
 * events and nothing else. Tool 5 is the reason it exists -- every fixture in
 * that directory drove the document, so nothing drove the tool until a root-level
 * test played a whole meet through the elements, and the first time one did it found
 * three of nine attempts with no control to move them onto the platform.
 *
 * WHY A REAL BROWSER AND NOT AN EMULATION
 *
 * Three of the behaviours below exist only on the platform. An event crossing a
 * shadow boundary is retargeted, so every `data-` lookup in this package reads
 * `composedPath()` rather than `target` and an emulation with its own retargeting
 * rules would answer a different question. Lit batches updates on a microtask, so
 * "the figure moved" is a claim about scheduling. And a `<fieldset disabled>` does
 * not set `input.disabled`, which is the kind of detail a simulated DOM invents.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED
 *
 * No test here checks a *number* against a published ladder. The figures come from
 * `qualification.fixture.ts`, which is invented for section 5.1's reason, and the
 * grading arithmetic is `standing.test.ts`'s job. What is asserted is that an answer
 * given in one shadow root changes what a different shadow root prints -- because
 * that is the failure no unit test in this package can see, and the one that leaves
 * five controls visibly responding and changing nothing.
 */
import type { WeightClass } from '@platform-toolkit/data-contracts';
import type { PtkChoiceGroup } from '@platform-toolkit/ui/ptk-choice-group';
import type { PtkSelect } from '@platform-toolkit/ui/ptk-select';
// Without the stylesheet every declaration reading a custom property is dropped, so
// anything measured here has no padding, no gaps and no tap-target floor -- a layout
// that never ships, and one that passes and fails for the wrong reasons.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { RegistrationAxis } from '../core/registration.js';
import {
  TABLES_FIXTURE,
  VOCABULARY_FIXTURE,
  entry,
  meet,
  meetBook,
} from '../core/qualification.fixture.js';
import type { CalendarDay } from '../types.js';

import { ANSWER_NOTES, CHECK_NOTES, IMPORT_NOTES, STANDARDS_STATUS_NOTES } from './copy.js';
import { defineQualificationCheck } from './index.js';
import type { PtkMeetReading } from './ptk-meet-reading.js';
import {
  STANDARDS_NEEDED_EVENT,
  type PtkQualificationCheck,
  type StandardsNeededDetail,
} from './ptk-qualification-check.js';
import type { PtkRegistrationAnswers } from './ptk-registration-answers.js';
import type { PtkProfileImport } from './ptk-profile-import.js';
import type { PtkResultLog } from './ptk-result-log.js';
import type { PtkStandingReport } from './ptk-standing-report.js';
import { aMirror, twoNamesakes } from './story.fixture.js';

/**
 * A day inside the fixture meet's entry window.
 *
 * A literal rather than today's date, for the reason `today` is a property at all: a
 * test that read the clock would pass until 10 March 2027 and then start reporting
 * "Entry closed" as a regression in whatever was committed that week.
 */
const A_DAY_BEFORE_ENTRY_CLOSES: CalendarDay = '2026-08-05';

/**
 * An answer for every axis, whether or not the archive already proposes one.
 *
 * A `Record` and not a list of pairs, so that a sixth axis added to `RegistrationAxis`
 * stops this file compiling rather than leaving one control unanswered in every test
 * below -- which would read as the tool refusing to grade.
 */
const ANSWERS: Readonly<Record<RegistrationAxis, string>> = {
  sex: 'male',
  equipment: 'raw',
  'weight-class': 'to-94',
  division: 'open',
  tested: 'yes',
};

/** The order the screen asks them in. Answers live in {@link ANSWERS}; this is only order. */
const EVERY_AXIS: readonly RegistrationAxis[] = [
  'sex',
  'equipment',
  'weight-class',
  'division',
  'tested',
];

const teardown: (() => void)[] = [];

beforeAll(() => {
  defineQualificationCheck();
});

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(
  properties: Partial<
    Pick<
      PtkQualificationCheck,
      | 'importedEntries'
      | 'vocabulary'
      | 'tables'
      | 'book'
      | 'today'
      | 'standardsStatus'
      | 'mirror'
      | 'lookup'
      | 'lookupStatus'
    >
  > = {},
): Promise<PtkQualificationCheck> {
  const element = document.createElement('ptk-qualification-check');
  Object.assign(element, {
    vocabulary: VOCABULARY_FIXTURE,
    tables: TABLES_FIXTURE,
    today: A_DAY_BEFORE_ENTRY_CLOSES,
    ...properties,
  });
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/**
 * Every partition the tool asks for, in order, from before it is mounted.
 *
 * On `document.body` and not on the element, because the first announcement happens
 * inside the first update -- which `mount` has already awaited by the time it hands the
 * element back. A listener attached afterwards would see an empty list and the test
 * would read as "the tool never asks", which is the failure it exists to catch.
 */
function recordStandardsNeeded(): readonly StandardsNeededDetail[] {
  const asked: StandardsNeededDetail[] = [];
  const listener = (event: CustomEvent<StandardsNeededDetail>): void => {
    asked.push(event.detail);
  };
  document.body.addEventListener(STANDARDS_NEEDED_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(STANDARDS_NEEDED_EVENT, listener);
  });
  return asked;
}

/** Anything the root draws directly, by tag. */
function inRoot<K extends keyof HTMLElementTagNameMap>(
  element: PtkQualificationCheck,
  tag: K,
): HTMLElementTagNameMap[K] {
  const found = element.shadowRoot?.querySelector(tag);
  if (found === null || found === undefined) {
    throw new Error(`The tool is not showing a <${tag}>.`);
  }
  return found;
}

/** Whether the root is showing one at all, without failing when it is not. */
function has(element: PtkQualificationCheck, tag: string): boolean {
  return element.shadowRoot?.querySelector(tag) !== null;
}

/**
 * Everything one element has rendered, across every shadow root under it.
 *
 * Takes an `Element` rather than the root on purpose. Handed the root it reads the whole
 * screen, which is what section 29's vocabulary check wants; handed one child it reads
 * only that child, which is what anything about the *reading* wants -- the result log
 * lists every result the reader typed regardless of the window, so a "narrowed to these
 * dates" assertion made against the whole screen would find the excluded meet in the log
 * and fail while the reading underneath was perfectly correct.
 */
function readAll(element: Element): string {
  const parts: string[] = [];
  const visit = (root: DocumentFragment | HTMLElement): void => {
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot !== null) visit(node.shadowRoot);
    }
    parts.push(root.textContent);
  };
  const shadow = element.shadowRoot;
  if (shadow !== null) visit(shadow);
  return parts.join(' ');
}

/**
 * Answers a `ptk-choice-group` by clicking one of its radios.
 *
 * A click and not a property set, because a property set is how a control is
 * *rendered*, not how it is answered -- it fires nothing, so a test written that way
 * asserts against a screen the reader could not have produced.
 */
async function choose(
  element: PtkQualificationCheck,
  group: PtkChoiceGroup,
  value: string,
): Promise<void> {
  const radio = [...(group.shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.value === value,
  );
  if (radio === undefined) {
    throw new Error(`No tile for "${value}" in "${group.label}".`);
  }
  radio.click();
  await element.updateComplete;
}

/**
 * Answers a `ptk-select`, or clears it with the placeholder's empty value.
 *
 * Kept separate from {@link choose} rather than folded into one `answer` helper: the
 * two controls fail differently and a merged helper would report "no option" for a
 * tile group that rendered as a select, which sends the reader to the wrong file.
 */
async function pick(
  element: PtkQualificationCheck,
  select: PtkSelect,
  value: string,
): Promise<void> {
  const native = select.shadowRoot?.querySelector('select');
  if (!(native instanceof HTMLSelectElement)) {
    throw new Error(`"${select.label}" has no options to pick from.`);
  }
  if (![...native.options].some((option) => option.value === value)) {
    throw new Error(`No option "${value}" in "${select.label}".`);
  }
  native.value = value;
  // What a real picker dispatches on the way out. `input` is not enough: `ptk-select`
  // reports on `change`, which is the event a native picker fires when it closes.
  native.dispatchEvent(new Event('change', { bubbles: true }));
  await element.updateComplete;
}

/**
 * The meet picker, found the way the root element's own handler finds it.
 *
 * By `data-picker` and not by label: the label is copy, and the attribute is the
 * thing `#onSelect` actually reads. Looking it up by either identifies the same
 * control today, but only this one fails when the wrapper is dropped -- and
 * dropping the wrapper is what silently turns every other select on the screen
 * into a meet picker.
 */
function meetPicker(element: PtkQualificationCheck): PtkSelect {
  // Two steps rather than one descendant selector, because a single-tag
  // `querySelector` resolves through `HTMLElementTagNameMap` and a compound one
  // returns `Element` -- which would need the cast section 2.4 forbids.
  const wrapper = element.shadowRoot?.querySelector('[data-picker="meet"]');
  const found = wrapper?.querySelector('ptk-select');
  if (found === null || found === undefined) throw new Error('No meet picker.');
  return found;
}

/** One axis block on the registration screen, two shadow roots down. */
function axisBlock(element: PtkQualificationCheck, axis: RegistrationAxis): Element {
  const answers = inRoot(element, 'ptk-registration-answers');
  const block = answers.shadowRoot?.querySelector(`[data-axis="${axis}"]`);
  if (block === null || block === undefined) {
    throw new Error(`No "${axis}" question on the registration screen.`);
  }
  return block;
}

/** The control inside one axis block, whichever kind it is. */
function control<K extends 'ptk-choice-group' | 'ptk-select'>(
  element: PtkQualificationCheck,
  axis: RegistrationAxis,
  tag: K,
): HTMLElementTagNameMap[K] {
  const found = axisBlock(element, axis).querySelector(tag);
  if (found === null) {
    throw new Error(`The "${axis}" question is not a <${tag}>.`);
  }
  return found;
}

/**
 * Answers one axis, whichever kind of control it turns out to be drawn with.
 *
 * {@link choose} and {@link pick} stay separate below this, because the two controls fail
 * differently and a merged one would send the reader to the wrong file. This is the other
 * half of that: a test that cares *which* axes are still open cannot also know which
 * control each is drawn with, since that is `fields.ts`'s decision and it changes when a
 * federation publishes eleven weight classes instead of four.
 */
async function answerAxisWith(
  element: PtkQualificationCheck,
  axis: RegistrationAxis,
  value: string,
): Promise<void> {
  const group = axisBlock(element, axis).querySelector('ptk-choice-group');
  if (group !== null) {
    await choose(element, group, value);
    return;
  }
  await pick(element, control(element, axis, 'ptk-select'), value);
}

/** The same, with the answer this suite gives that axis everywhere else. */
async function answerAxis(element: PtkQualificationCheck, axis: RegistrationAxis): Promise<void> {
  await answerAxisWith(element, axis, ANSWERS[axis]);
}

/** Settles all five registration answers, which is what makes a report appear. */
async function answerEverything(element: PtkQualificationCheck): Promise<void> {
  for (const axis of EVERY_AXIS) {
    await answerAxis(element, axis);
  }
}

/** The axes the screen is still asking about, in the order it asks them. */
function stillOpen(element: PtkQualificationCheck): RegistrationAxis[] {
  const answers = inRoot(element, 'ptk-registration-answers');
  const blocks = answers.shadowRoot?.querySelectorAll('.axis.needed') ?? [];
  return [...blocks]
    .map((block) => block.getAttribute('data-axis'))
    .filter((axis): axis is RegistrationAxis => axis !== null);
}

/**
 * Types into one of the two window bounds.
 *
 * `input`, and not `change`. `ptk-date-field` binds a single native `<input type="date">`
 * with `@input`, so a test dispatching only `change` moves nothing and then asserts
 * against the screen it started with -- which is a passing test for two of the three
 * things it claims and a silent one for the third. This cost two failures the first time
 * this suite ran.
 */
async function typeDate(
  element: PtkQualificationCheck,
  bound: 'from' | 'to',
  value: string,
): Promise<void> {
  const field = element.shadowRoot?.querySelector(`[data-bound="${bound}"] ptk-date-field`);
  const input = field?.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`No "${bound}" date field on the window.`);
  }
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await element.updateComplete;
}

/**
 * Picks one of the archive's candidates, from outside the panel that offers them.
 *
 * Three shadow roots deep, and deliberately driven by a click rather than by dispatching
 * {@link ATHLETE_CHOSEN_EVENT} at the root. Firing the event directly would test the
 * root's handler against an event this suite wrote, and the failure it is here to catch
 * is the panel's event not reaching the root at all.
 */
async function importAthlete(element: PtkQualificationCheck, value: string): Promise<void> {
  const panel: PtkProfileImport = inRoot(element, 'ptk-profile-import');
  const wrapper = panel.shadowRoot?.querySelector('[data-picker="athlete"]');
  const group = wrapper?.querySelector('ptk-choice-group');
  const radio = [...(group?.shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.value === value,
  );
  if (radio === undefined) throw new Error(`The archive is offering no candidate "${value}".`);
  radio.click();
  await element.updateComplete;
}

/** The three text fields a result needs, and the button that submits it. */
async function typeResult(
  element: PtkQualificationCheck,
  values: Readonly<Record<string, string>>,
): Promise<void> {
  const form = inRoot(element, 'ptk-result-form');
  for (const [field, value] of Object.entries(values)) {
    const block = form.shadowRoot?.querySelector(`[data-field="${field}"]`);
    const input = block?.querySelector('ptk-text-field, ptk-number-field, ptk-date-field');
    const native = input?.shadowRoot?.querySelector('input');
    if (!(native instanceof HTMLInputElement)) {
      throw new Error(`No "${field}" field on the result form.`);
    }
    native.value = value;
    native.dispatchEvent(new Event('input', { bubbles: true }));
    native.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const submit = form.shadowRoot?.querySelector('ptk-button');
  const button = submit?.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('The result form has no submit control.');
  }
  button.click();
  await element.updateComplete;
}

describe('ptk-qualification-check', () => {
  it('says so, once, when the federation has published no categories', async () => {
    const element = await mount({ vocabulary: null, importedEntries: [entry()] });

    expect(readAll(element)).toContain(CHECK_NOTES.noVocabulary);
    // And nothing else. A screen that printed the results, the dates and the standings
    // under that sentence would be offering four controls that can produce no reading,
    // which reads as the tool being broken rather than as the data being absent.
    expect(has(element, 'ptk-result-form')).toBe(false);
    expect(has(element, 'ptk-standing-report')).toBe(false);
  });

  it('opens with no results and asks for one', async () => {
    const element = await mount();

    expect(readAll(element)).toContain(CHECK_NOTES.standingEmpty);
    expect(has(element, 'ptk-standing-report')).toBe(false);
    // The two date fields are drawn and *not* marked. An empty tool is a state the
    // page opens in, not two mistakes to put in red.
    const dates = element.shadowRoot?.querySelectorAll('ptk-date-field') ?? [];
    expect(dates.length).toBe(2);
    for (const field of dates) {
      expect(field.error).toBe('');
    }
  });

  it('carries a typed result through the form into the log', async () => {
    const element = await mount();

    await typeResult(element, {
      date: '2026-03-14',
      meetName: 'A Typed Meet',
      federation: 'Invented Federation',
      sex: 'M',
      equipment: 'Raw',
      squatKg: '205',
      benchKg: '140',
      deadliftKg: '250',
    });

    const log: PtkResultLog = inRoot(element, 'ptk-result-log');
    expect(log.entries.length).toBe(1);
    expect(log.shadowRoot?.textContent).toContain('A Typed Meet');
    // The result crossed two shadow boundaries to get here. Nothing else in this
    // package proves the event survives the trip.
    expect(readAll(element)).not.toContain(CHECK_NOTES.standingEmpty);
  });

  it('takes a result back out when the log asks it to', async () => {
    const element = await mount({ importedEntries: [entry(), entry({ meetName: 'Second' })] });
    expect(inRoot(element, 'ptk-result-log').entries.length).toBe(2);

    const remove = inRoot(element, 'ptk-result-log').shadowRoot?.querySelectorAll('ptk-button');
    const second = [...(remove ?? [])][1]?.shadowRoot?.querySelector('button');
    if (!(second instanceof HTMLButtonElement)) throw new Error('No second remove control.');
    second.click();
    await element.updateComplete;

    const left = inRoot(element, 'ptk-result-log').entries;
    expect(left.length).toBe(1);
    expect(left[0]?.meetName).toBe(entry().meetName);
  });

  it('leaves the archive off the page entirely when the build published none', async () => {
    const element = await mount();

    // Production today: root section 9's mirror gate is shut, so `getAthleteMirror()`
    // answers `null` and the manual route is the whole tool. Not a disabled search box
    // and not an empty section either -- an empty one still carries the bottom margin
    // every other section gets, which is a gap above "Your results" on every page load.
    expect(has(element, 'ptk-profile-import')).toBe(false);
    expect(readAll(element)).not.toContain(IMPORT_NOTES.heading);
  });

  it('takes the results of the lifter the reader picked out of the archive', async () => {
    const element = await mount({
      mirror: aMirror(),
      lookup: { outcome: 'found', matches: twoNamesakes() },
    });

    await importAthlete(element, '1');

    // The event crossed two shadow boundaries and was adopted by the element that drew
    // the panel, rather than being handed back by a consumer. An element that renders a
    // control and then needs its consumer to feed that control's output into one of its
    // own properties has a hole in it.
    const log: PtkResultLog = inRoot(element, 'ptk-result-log');
    expect(log.entries.length).toBe(1);
    expect(readAll(log)).toContain('Invented Autumn Classic');
  });

  it('starts the reading over when a second lifter is imported', async () => {
    const element = await mount({
      mirror: aMirror(),
      lookup: { outcome: 'found', matches: twoNamesakes() },
    });
    await importAthlete(element, '0');
    await answerEverything(element);
    expect(has(element, 'ptk-standing-report')).toBe(true);

    await importAthlete(element, '1');

    // The reset is the whole point and it is not tidiness. Those five answers are
    // statements about the lifter the previous results belonged to, and carrying them
    // would grade a different person's history under the first one's weight class and
    // division with nothing on screen to show that it had happened.
    expect(has(element, 'ptk-standing-report')).toBe(false);
    expect(readAll(inRoot(element, 'ptk-result-log'))).not.toContain('Invented Spring Open');
  });

  it('reads a single registration without making the reader tick it', async () => {
    const element = await mount({ importedEntries: [entry()] });

    // One standing is not a question, so the registration screen is already open.
    expect(has(element, 'ptk-registration-answers')).toBe(true);
    const answers: PtkRegistrationAnswers = inRoot(element, 'ptk-registration-answers');
    expect(answers.proposal).not.toBeNull();
  });

  it('makes the reader choose when the results carry two registrations', async () => {
    const element = await mount({
      importedEntries: [entry(), entry({ equipment: 'Single-ply', meetName: 'A Geared Meet' })],
    });

    // Two is a real question. Nothing below it is drawn until it is answered, because
    // every figure there would be read under one of the two and would not say which.
    expect(has(element, 'ptk-registration-answers')).toBe(false);

    const tiles = inRoot(element, 'ptk-choice-group');
    await choose(element, tiles, '0');
    expect(has(element, 'ptk-registration-answers')).toBe(true);
  });

  it('drops the answers given for one registration when the reader moves to another', async () => {
    const element = await mount({
      importedEntries: [entry(), entry({ equipment: 'Single-ply', meetName: 'A Geared Meet' })],
    });
    await choose(element, inRoot(element, 'ptk-choice-group'), '0');
    await answerEverything(element);
    expect(has(element, 'ptk-standing-report')).toBe(true);

    await choose(element, inRoot(element, 'ptk-choice-group'), '1');

    // The division somebody entered raw is not the division they entered geared, and a
    // carried-over answer would look like a default the tool had proposed.
    expect(has(element, 'ptk-standing-report')).toBe(false);
    expect(inRoot(element, 'ptk-registration-answers').answers).toEqual({});
  });

  /**
   * All but one is the case this refuses to render, and "all but one" is read off the
   * screen rather than counted.
   *
   * The first draft of this test answered five axes and expected no report after four. It
   * failed, and the code was right: the fixture entry carries an age class and a
   * bodyweight, so `proposeRegistration` already has a measured default under three of the
   * five and only two are open questions. Hard-coding the count asserted the fixture --
   * one edit to an entry's `ageClass` and the test would have started failing on a change
   * that broke nothing.
   */
  it('grades only once every axis it is still asking about is answered', async () => {
    const element = await mount({ importedEntries: [entry()] });

    // Three, for the fixture, and the test does not care which three. It does need more
    // than one, or the first step and the last would be the same one and nothing would
    // be proven.
    let open = stillOpen(element);
    expect(open.length).toBeGreaterThan(1);

    // Re-read after every answer rather than walking the list captured up front, and
    // the reason is a dependency between two of the axes. Weight classes are published
    // per sex, so until sex is answered that control has nothing to offer -- and the
    // moment it is answered the entered class is measured against the ladder and may
    // settle on its own. One answer can therefore take two questions off the screen,
    // and a loop over a stale list would go looking for a control that is no longer
    // drawn. Always answering the *first* still-open axis is what a reader does anyway:
    // `stillOpen` reports them in the order the screen asks them.
    for (let guard = 0; open.length > 0; guard += 1) {
      // Every intermediate state, not just the last one. A report drawn at any of them
      // would be printing figures from whichever table happened to match.
      expect(has(element, 'ptk-standing-report')).toBe(false);
      expect(readAll(inRoot(element, 'ptk-registration-answers'))).toContain(
        ANSWER_NOTES.stillToAnswer,
      );

      const [next] = open;
      if (next === undefined) throw new Error('The screen is asking nothing.');
      // An answer that does not stick would otherwise spin here forever, and a hung
      // suite says far less than a failed one.
      if (guard >= EVERY_AXIS.length) {
        throw new Error(`Answering "${next}" left the screen still asking for it.`);
      }
      await answerAxis(element, next);
      open = stillOpen(element);
    }

    const report: PtkStandingReport = inRoot(element, 'ptk-standing-report');
    expect(report.report).not.toBeNull();
  });

  /**
   * The only answer on this form that can invalidate another one.
   *
   * Weight classes are published one ladder per sex, so changing sex can strand a class
   * that no longer exists. What makes it worth a test rather than a comment is how it
   * fails when it is missed: nothing throws, nothing is logged, and `gradeStanding`
   * simply finds no table keyed on a class the new ladder never had -- so the report
   * says this federation publishes no standards for the combination. That sentence is
   * about the federation, the reader cannot tell it is about their own stale answer, and
   * there is no gesture available that would fix it.
   */
  it('drops a weight class the newly answered sex does not publish', async () => {
    const element = await mount({ importedEntries: [entry()] });
    await answerAxis(element, 'sex');
    // A class the reader chose, and deliberately not the one already filled in for
    // them. Picking the default writes nothing -- a control set to the value it is
    // already showing fires no change event -- so the answer under test would never
    // exist and the test would pass on an empty draft.
    await answerAxisWith(element, 'weight-class', 'to-112');

    const answers = inRoot(element, 'ptk-registration-answers');
    expect(answers.answers.weightClassId).toBe('to-112');

    await answerAxisWith(element, 'sex', 'female');

    // Gone from the answers, and the question is back on the screen -- both halves
    // matter. Dropped without being re-asked is a form that silently lost an answer.
    expect(inRoot(element, 'ptk-registration-answers').answers.weightClassId).toBeUndefined();
    expect(stillOpen(element)).toContain('weight-class');
    expect(has(element, 'ptk-standing-report')).toBe(false);
  });

  it('keeps one both ladders publish, because discarding it would be gratuitous', async () => {
    // The other half of the rule, and it needs its own vocabulary: the two fixture
    // ladders deliberately share no class, which is what makes the test above
    // unambiguous and makes this case unreachable with it. Real ladders overlap through
    // the middle, and a screen that cleared the answer on every switch of sex would be
    // erasing something the reader chose for no reason at all.
    const shared: readonly WeightClass[] = [
      { id: 'to-90', label: '90 kg', maximumKilograms: 90 },
      { id: 'over-90', label: '90+ kg', maximumKilograms: null },
    ];
    const element = await mount({
      importedEntries: [entry()],
      vocabulary: {
        ...VOCABULARY_FIXTURE,
        weightClassLadders: [
          { id: 'both-female', label: 'Female', sex: 'female', classes: [...shared] },
          { id: 'both-male', label: 'Male', sex: 'male', classes: [...shared] },
        ],
      },
    });

    await answerAxis(element, 'sex');
    await answerAxisWith(element, 'weight-class', 'over-90');
    await answerAxisWith(element, 'sex', 'female');

    expect(inRoot(element, 'ptk-registration-answers').answers.weightClassId).toBe('over-90');
  });

  /**
   * The one test the `data-axis` contract has.
   *
   * `#axisBlock` writes that attribute as a literal because lit-html cannot bind an
   * attribute *name*, so the compiler cannot hold the template and `fields.ts` in
   * step. A rename on either side leaves five controls that visibly respond and
   * change nothing, and this is what fails on it: the division answer has to reach
   * the root, select a different table, and move a printed grade.
   */
  it('moves the grade when one answer changes', async () => {
    const element = await mount({ importedEntries: [entry()] });
    await answerEverything(element);
    const open = readAll(element);

    await pick(element, control(element, 'division', 'ptk-select'), 'master-1');
    const masters = readAll(element);

    expect(masters).not.toBe(open);
    // The fixture's two total tables are a rung apart at 595 kg by construction, so
    // the printed grade is the thing that moved rather than a label somewhere.
    expect(open).toContain('First Class');
    expect(masters).toContain('Elite');
  });

  it('narrows the reading to the dates the reader typed', async () => {
    const element = await mount({
      importedEntries: [entry(), entry({ date: '2026-09-20', meetName: 'A Later Meet' })],
    });

    await typeDate(element, 'from', '2026-06-01');

    // Both results are still listed -- narrowing the dates is not withdrawing a result --
    // so the reading is read on its own. Against the whole screen this assertion would be
    // testing the log, which is doing exactly what it should by showing both.
    expect(inRoot(element, 'ptk-result-log').entries.length).toBe(2);
    await answerEverything(element);
    const reading = readAll(inRoot(element, 'ptk-standing-report'));
    expect(reading).toContain('A Later Meet');
    expect(reading).not.toContain('Invented Spring Open');
  });

  it('marks a range typed the wrong way round, and reads nothing under it', async () => {
    const element = await mount({ importedEntries: [entry()] });

    await typeDate(element, 'to', '2020-01-01');

    const fields = [...(element.shadowRoot?.querySelectorAll('ptk-date-field') ?? [])];
    // On the first field, because a range typed backwards is almost always a first
    // date that should have been the second.
    expect(fields[0]?.error).not.toBe('');
    expect(has(element, 'ptk-standing-report')).toBe(false);
  });

  it('reads a meet the reader picks, and stops reading it when they unpick it', async () => {
    const element = await mount({ importedEntries: [entry()], book: meetBook() });
    await answerEverything(element);
    expect(has(element, 'ptk-meet-reading')).toBe(false);

    const picker = meetPicker(element);
    await pick(element, picker, meet().id);

    const reading: PtkMeetReading = inRoot(element, 'ptk-meet-reading');
    expect(reading.reading?.meet.label).toBe(meet().label);
    // The timing badge is computed from the supplied day, not from a clock.
    expect(reading.timing).toBe('entry-open');
    // The criteria's own words, set apart. Paraphrasing them would be this tool
    // stating an entry requirement in its own voice.
    expect(readAll(element)).toContain('Entrants must have a First Class total');

    await pick(element, picker, '');
    expect(has(element, 'ptk-meet-reading')).toBe(false);
  });

  /**
   * The `data-picker` guard on `#onSelect`, which the screen has no other defence for.
   *
   * Every control here is inside this element's shadow tree and a `ptk-select` change
   * is composed, so the two pickers on the registration screen -- weight class and
   * division -- report to `ptk-registration-answers` *and* arrive at the root. An
   * unguarded handler reads the second of those as a meet identifier, `meetId` becomes
   * `master-1`, `findQualifyingMeet` finds nothing, and the reader is told the meet
   * they picked is not in the published list because they answered a question about
   * their age. Worth a test of its own rather than an assertion tacked onto the one
   * above: the fault only appears when the meet is picked *first*, and every other
   * test on this screen answers the registration axes before it touches the book.
   */
  it('keeps the picked meet when a registration answer changes after it', async () => {
    const element = await mount({ importedEntries: [entry()], book: meetBook() });
    await answerEverything(element);
    await pick(element, meetPicker(element), meet().id);

    await pick(element, control(element, 'division', 'ptk-select'), 'master-1');

    const reading: PtkMeetReading = inRoot(element, 'ptk-meet-reading');
    expect(reading.reading?.meet.label).toBe(meet().label);
    expect(readAll(element)).not.toContain(CHECK_NOTES.meetNotFound);
  });

  it('says so when the federation has no transcribed meets', async () => {
    const element = await mount({ importedEntries: [entry()], book: meetBook({ meets: [] }) });
    await answerEverything(element);

    expect(readAll(element)).toContain(CHECK_NOTES.meetEmpty);
    expect(has(element, 'ptk-meet-reading')).toBe(false);
  });

  /**
   * Section 29, asserted as vocabulary rather than as a rule nobody can check.
   *
   * The phrases below convert an arithmetic result into a ruling the federation has not
   * made. The screen is read whole, across every shadow root, because the sentence that
   * breaks this will be added to whichever component seemed to need it.
   *
   * Phrases and not words, which the first draft got wrong: it banned "eligible" outright
   * and failed on `ANSWER_NOTES.divisionChoice`, whose whole job is to say that being
   * eligible for a division is not the same as entering it and that the choice is the
   * lifter's. Banning the adjective would have deleted the tool's clearest disclaimer to
   * satisfy a test about disclaiming. What section 29 forbids is the tool taking a
   * position -- "you are eligible", "you qualify" -- not the noun appearing on screen.
   */
  it('never rules on whether the lifter may enter', async () => {
    const element = await mount({ importedEntries: [entry()], book: meetBook() });
    await answerEverything(element);
    await pick(element, meetPicker(element), meet().id);

    const screen = readAll(element).toLowerCase();
    for (const banned of [
      'you are eligible',
      'you are not eligible',
      'is eligible',
      'is not eligible',
      'ineligible',
      'you qualify',
      'you have qualified',
      'does not qualify',
    ]) {
      expect(screen).not.toContain(banned);
    }
    expect(readAll(element)).toContain('is not made here');
  });

  /**
   * The event exists because the standards are too big to send all at once.
   *
   * A federation publishes them one artifact per sex and equipment category, and this
   * federation's eight are the better part of eight megabytes, so a consumer holds one
   * at a time. Which one is a question only this element can answer: the pair falls out
   * of the same merge `resolveRegistration` performs, over a proposal built from a
   * standing and a date window that are private state in here.
   *
   * Both axes are answered rather than proposed, and that is `mayPreselect` doing its
   * job rather than an accident of the fixture -- a sex letter and an equipment name are
   * *spelled* matches, and this federation's `Raw` and the archive's `Raw` disagree over
   * knee wraps. The other three are measured from a bodyweight and an age, so for this
   * entry the answer that reveals the partition is also the answer that resolves the
   * registration, and the report is drawn in the same update the request goes out in.
   * That is the case `standardsStatus` exists for: the panel is on screen with no table
   * behind it, and what it must not say is that the federation publishes none.
   */
  it('asks for the partition of standards its reading needs', async () => {
    const asked = recordStandardsNeeded();
    const element = await mount({ importedEntries: [entry()] });

    // Nothing yet. Neither axis may be filled in for somebody, and a pair guessed from
    // the archive's spelling is how a lifter gets graded against the wrong ladder.
    expect(asked).toEqual([]);

    await answerAxis(element, 'sex');
    expect(asked).toEqual([]);

    await answerAxis(element, 'equipment');
    expect(asked).toEqual([{ sex: 'male', equipmentId: 'raw' }]);
    // Asked for in the same update the report first appears in, not after it.
    expect(has(element, 'ptk-standing-report')).toBe(true);
  });

  it('asks nothing while there is nothing to read', async () => {
    const asked = recordStandardsNeeded();
    await mount();

    // No results, so no standing, so no category at all -- not even a question to answer
    // one from.
    expect(asked).toEqual([]);
  });

  /**
   * Asked once per category and not once per render.
   *
   * Nearly every keystroke on this screen changes something and almost none of them
   * change the category. Without the guard on the pair itself a consumer would refetch
   * the whole partition for every character typed into a date field -- which works, and
   * costs the better part of a megabyte a keystroke on a phone.
   */
  it('asks again only when an answer moves it to another category', async () => {
    const asked = recordStandardsNeeded();
    const element = await mount({ importedEntries: [entry()] });
    await answerAxis(element, 'sex');
    await answerAxis(element, 'equipment');
    expect(asked.length).toBe(1);

    await typeDate(element, 'from', '2020-01-01');
    await answerAxisWith(element, 'weight-class', 'to-112');
    await answerAxis(element, 'tested');
    // Three changes, one of them a registration answer, none of them a partition.
    expect(asked.length).toBe(1);

    await answerAxisWith(element, 'equipment', 'single-ply');
    expect(asked).toEqual([
      { sex: 'male', equipmentId: 'raw' },
      { sex: 'male', equipmentId: 'single-ply' },
    ]);
  });

  /**
   * The half-second in which the honest answer is "not yet", not "there are none".
   *
   * A consumer fetching a partition has an empty table list until it arrives, and an
   * empty list renders exactly like a category the federation publishes no ladder for.
   * A lifter told that acts on it -- it is the sort of thing somebody repeats to a meet
   * director -- so the status is carried down and the panel says which it is.
   */
  it('does not report a category as unpublished while its standards are still arriving', async () => {
    const element = await mount({
      importedEntries: [entry()],
      tables: [],
      standardsStatus: 'loading',
    });
    await answerEverything(element);

    const report = readAll(inRoot(element, 'ptk-standing-report'));
    expect(report).toContain(STANDARDS_STATUS_NOTES.loading);
    // Everything the results themselves say is still on screen. The grades are the only
    // part of this panel that depends on a table.
    expect(report).toContain('Results counted');
    expect(report).not.toContain(CHECK_NOTES.noVocabulary);
  });

  it('owns a read of the standards that failed, and keeps the rest of the screen', async () => {
    const element = await mount({
      importedEntries: [entry()],
      tables: [],
      standardsStatus: 'failed',
    });
    await answerEverything(element);

    const report: PtkStandingReport = inRoot(element, 'ptk-standing-report');
    expect(readAll(report)).toContain(STANDARDS_STATUS_NOTES.failed);
    // Marked as a fault rather than as information, because reloading is a thing the
    // reader can usefully do about this one and nothing on the screen says so otherwise.
    const notice = report.shadowRoot?.querySelector('ptk-notice');
    expect(notice?.tone).toBe('error');
  });

  it('has no accessibility violations with the whole screen open', async () => {
    const element = await mount({ importedEntries: [entry()], book: meetBook() });
    await answerEverything(element);

    const results = await axe.run(element, {
      // Disabled for the reason every suite in this collection disables it: the
      // component is measured outside the page's own background, so the contrast
      // engine compares a token against whatever the test harness painted.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
