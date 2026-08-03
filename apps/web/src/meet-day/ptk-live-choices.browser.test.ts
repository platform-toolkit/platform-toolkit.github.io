// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §13's three cards, and the fourth thing that is not a card.
 *
 * What is under test here is mostly *identification*: which card a press means,
 * which card the tool is pointing at, and which of two vocabularies a word on
 * the screen belongs to. The weights themselves are `liveChoicesFor`'s and are
 * covered in the domain suite -- this file would be measuring that module again
 * if it asserted them, and would go on passing if the element wired the wrong
 * card's weight to the wrong button.
 *
 * So the presses are checked against the *slot*, never against the position in
 * the list. The live screen is rebuilt off the clock seam four times a second
 * (§13.5), and after a grind the pass sits first and the recommendation second,
 * so a test that pressed "the first card" would agree with an element that
 * reported whatever card had moved into that position between the press
 * starting and the handler running. That failure is a declared weight nobody
 * chose, at an expeditor's table.
 *
 * Every fixture is a real sequence played through `applyMeetAction` (see
 * `live-fixture.ts`). A hand-written `LiveChoices` could hold a push slot beside
 * a report of pain, and a test asserting the screen copes with one proves the
 * screen copes with something the rules will never produce.
 *
 * A real browser for §5.8's usual reason: every answer here leaves a control's
 * own shadow tree as a composed event, and the delegated reads would see the
 * host with an empty dataset under `event.target`.
 */
import { NUMBER_FIELD_CHANGE_EVENT } from '@platform-toolkit/ui';
// The card padding, the badge and the 44px tap-target floor all read custom
// properties, and a declaration referencing an undefined one is dropped -- so
// without this the layout measured at 320px below is not the layout that ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import type { LiveChoices, LiveTarget } from '@platform-toolkit/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import {
  EXTRA_ATTEMPTS_HEADING,
  HIGHLIGHT_BADGE,
  OTHER_WEIGHT_MUST_BE_KILOGRAMS,
  PASS_LABEL,
  RISK_NOT_ASSESSED,
  refusalSentence,
} from './copy.js';
import { OTHER_WEIGHT_FIELD } from './fields.js';
import {
  CHART,
  OPENER,
  SECOND,
  START,
  choicesOf,
  contextAt,
  maximumOn,
  meetWith,
  take,
} from './live-fixture.js';
import { PROBABILITY_WORDS } from './planner-fixture.js';
import {
  LIVE_CHOICE_EVENT,
  type LiveChoiceDetail,
  type PtkLiveChoices,
} from './ptk-live-choices.js';
import './ptk-live-choices.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/** Invented (§5.1). The opener has to be a plausible share of it or the percentages read wrong. */
const MAXIMUM = 220;

const TARGETS: readonly LiveTarget[] = [
  { kind: 'personal-record', measure: 'lift', lift: 'squat', kilograms: 200, label: 'squat best' },
];

const GRADED = contextAt(START, { planning: maximumOn('squat', MAXIMUM), targets: TARGETS });

/** One made opener: the plain two-card screen with nothing unusual about it. */
function afterASolidOpener(): LiveChoices {
  return choicesOf(take(meetWith(), 'squat', OPENER), GRADED);
}

/**
 * A grind, which is the fixture most of this file runs on.
 *
 * Three cards, the pass in the secure slot, the highlight on the *second* card,
 * and a tactical push that reaches a target -- four of the things worth
 * asserting, all reachable from one sequence, and all of them arranged the way
 * only this branch arranges them.
 */
function afterAGrind(): LiveChoices {
  return choicesOf(take(meetWith(), 'squat', SECOND, { outcome: 'good', effort: 'grind' }), GRADED);
}

async function mount(
  choices: LiveChoices | null = afterASolidOpener(),
  patch: Partial<Pick<PtkLiveChoices, 'chart' | 'unit' | 'refusals'>> = {},
): Promise<PtkLiveChoices> {
  const element = document.createElement('ptk-live-choices');
  element.choices = choices;
  element.chart = CHART;
  Object.assign(element, patch);
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** The choice button for one slot, found by the slot and never by position. */
function slotButton(element: PtkLiveChoices, slot: string): HTMLElement {
  const host = element.shadowRoot?.querySelector(`ptk-button[data-slot="${slot}"]`);
  if (!(host instanceof HTMLElement)) throw new Error(`There is no "${slot}" card on screen.`);
  return host;
}

/** The native button inside a `ptk-button`, which is what a thumb lands on. */
function nativeButton(host: Element): HTMLButtonElement {
  const button = host.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error('The control did not render.');
  return button;
}

/** The "Use this weight" control, which is the one `ptk-button` carrying no slot. */
function useTypedButton(element: PtkLiveChoices): HTMLButtonElement {
  const host = element.shadowRoot?.querySelector('ptk-button:not([data-slot])');
  if (host === null || host === undefined) throw new Error('The typed-weight control is missing.');
  return nativeButton(host);
}

/** Types into the free-entry field by driving the shared control's own input. */
async function typeWeight(element: PtkLiveChoices, text: string): Promise<PtkLiveChoices> {
  const host = element.shadowRoot?.querySelector(`[data-field="${OTHER_WEIGHT_FIELD}"]`);
  const input = host?.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error('The weight field did not render.');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
  return element;
}

/**
 * Records what escapes the element, listening on `document.body`.
 *
 * Not on the element: what is being proved is that the event crossed the shadow
 * boundary composed, and a listener on the element itself would pass without it.
 */
function watch(): LiveChoiceDetail[] {
  const seen: LiveChoiceDetail[] = [];
  const listener = (event: CustomEvent<LiveChoiceDetail>): void => {
    seen.push(event.detail);
  };
  document.body.addEventListener(LIVE_CHOICE_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(LIVE_CHOICE_EVENT, listener);
  });
  return seen;
}

describe('ptk-live-choices', () => {
  it('re-renders when the choices are replaced after the first render', async () => {
    // The canary for Lit's decorator configuration (§5.8). Everything else in
    // this file passes when it is wrong and the screen simply stops updating --
    // which on this element means three cards from the previous attempt sitting
    // under a heading for the current one, all of them still pressable.
    const element = await mount(afterASolidOpener());
    expect(element.shadowRoot?.querySelectorAll('.card')).toHaveLength(2);

    element.choices = afterAGrind();
    await element.updateComplete;

    expect(element.shadowRoot?.querySelectorAll('.card')).toHaveLength(3);
  });

  it('says no lift is under way rather than rendering an empty screen', async () => {
    // Where the live screen sits once the lifter's meet is over. A blank panel
    // with a dead field reads as the tool having failed to load.
    const text = deepText(await mount(null));

    expect(text).toContain('No lift under way');
  });

  it('heads every card with its slot and marks the highlighted one in words', async () => {
    // §13 asks for one option to be highlighted. The badge is the highlight and
    // the border is decoration on top of it, so this asserts the words -- a
    // border is invisible to a reader who cannot separate the hues and gone
    // entirely when the card is read aloud, which is how it is usually read.
    const element = await mount(afterAGrind());
    const text = deepText(element);

    expect(text).toContain('Secure');
    expect(text).toContain('Recommended');
    expect(text).toContain('Push');
    expect(element.shadowRoot?.querySelectorAll('.badge')).toHaveLength(1);
    expect(text).toContain(HIGHLIGHT_BADGE);
  });

  it('puts the highlight on the card the domain marked, not on the first one', async () => {
    // The mutation this exists for: reading the highlight off `choices[0]` is
    // right in every branch except this one. After a grind the pass sits first,
    // in the secure slot where a thumb lands, and the tool still recommends the
    // smallest legal increase beside it -- so a positional highlight tells a
    // lifter who ground out an attempt that their day is over.
    const element = await mount(afterAGrind());

    const marked = [...(element.shadowRoot?.querySelectorAll('.card') ?? [])].filter((card) =>
      card.hasAttribute('data-highlighted'),
    );

    expect(marked).toHaveLength(1);
    expect(deepText(marked[0] as HTMLElement)).toContain('Recommended');
    // The control: the first card is a real card, and it is not the marked one.
    const first = element.shadowRoot?.querySelector('.card');
    expect(first?.hasAttribute('data-highlighted')).toBe(false);
  });

  it('reports the slot that was pressed and the weight on that card', async () => {
    const choices = afterAGrind();
    const element = await mount(choices);
    const seen = watch();

    nativeButton(slotButton(element, 'push')).click();

    const push = choices.choices.find((choice) => choice.slot === 'push');
    expect(seen).toEqual([
      { attemptId: choices.attemptId, kilograms: push?.kilograms, slot: 'push' },
    ]);
  });

  it('reports a pass as a choice, not as an absence', async () => {
    // §13.5's Pass / Stop This Lift. `kilograms: null` has to reach the caller
    // as a decision -- a caller that read it as "nothing was decided" would
    // leave the lift open and go on offering increases to somebody who stopped.
    const choices = afterAGrind();
    const element = await mount(choices);
    const seen = watch();

    const pass = slotButton(element, 'secure');
    expect(deepText(pass)).toContain(PASS_LABEL);
    nativeButton(pass).click();

    expect(seen).toEqual([{ attemptId: choices.attemptId, kilograms: null, slot: 'secure' }]);
  });

  it('labels each choice button with its weight rather than with "Choose"', async () => {
    // Three buttons reading "Choose" are three identical accessible names in one
    // list, which is what a screen reader announces and what a voice control
    // has to disambiguate. The weight is already the thing being chosen.
    const element = await mount(afterAGrind());

    const labels = [...(element.shadowRoot?.querySelectorAll('ptk-button[data-slot]') ?? [])].map(
      (button) => deepText(button as HTMLElement),
    );

    expect(new Set(labels).size).toBe(labels.length);
  });

  it('never prints a risk band as a bare word', async () => {
    // The collision this screen was designed around: §13 names the three slots
    // Secure, Recommended and Push, and §10.2 names three of the four risk bands
    // the same. A card headed "Push" carrying a bare chip reading "Recommended"
    // cannot be read at all, so the band always arrives prefixed and the slot is
    // always the heading.
    const element = await mount(afterAGrind());

    const facts = [...(element.shadowRoot?.querySelectorAll('.facts li') ?? [])].map((item) =>
      item.textContent.trim(),
    );
    const bands = facts.filter((fact) => /^(Secure|Recommended|Push|Long shot)$/.test(fact));

    expect(bands).toEqual([]);
    // The control: a prefixed band is on screen, so the assertion above is not
    // passing because no band was rendered at all.
    expect(facts.some((fact) => fact.startsWith('Risk: '))).toBe(true);
  });

  it('grades no risk at all on the pass card', async () => {
    // Found by mutation: removing the `kilograms === null` guard in `riskLine`
    // survived the whole suite, and what it produces is "Risk: not graded"
    // printed on Pass. There is nothing to grade about not lifting, and that
    // sentence on that card reads as a warning about stopping -- on the one
    // branch where stopping is what the tool is recommending.
    const element = await mount(afterAGrind());

    const cards = [...(element.shadowRoot?.querySelectorAll('.card') ?? [])].filter(
      (card): card is HTMLElement => card instanceof HTMLElement,
    );
    const pass = cards.find((card) => deepText(card).includes(PASS_LABEL));
    const weighted = cards.find((card) => deepText(card).includes('Choose'));
    if (pass === undefined || weighted === undefined) {
      throw new Error('The grind fixture did not render both a pass and a weighted card.');
    }

    expect(deepText(pass)).not.toContain('Risk');
    // The control: a card beside it does carry a risk line, so this is not
    // passing because the facts list stopped rendering.
    expect(deepText(weighted)).toContain('Risk');
  });

  it('says a risk was not graded rather than leaving the line off', async () => {
    // An absent band would be read as a safe one. §10 keeps risk and data
    // confidence on separate axes, and this is the axis that has no answer when
    // no maximum was confirmed -- so it says so instead of grading on nothing.
    const element = await mount(choicesOf(take(meetWith(), 'squat', OPENER), contextAt(START)));

    const text = deepText(element);
    expect(text).toContain(RISK_NOT_ASSESSED);
    expect(text).not.toContain('% of your meet-day maximum');
  });

  it('uses no probability vocabulary anywhere on the screen', async () => {
    // §10.2, asserted rather than reviewed. The research behind the guardrails
    // is nowhere near good enough to put a number on whether a lift goes up, so
    // a word implying one is a lie with a citation behind it.
    const text = deepText(await mount(afterAGrind())).toLowerCase();

    for (const word of PROBABILITY_WORDS) {
      expect(text).not.toContain(word);
    }
  });

  it('marks a pound figure as coming off the chart', async () => {
    // §16. That the figure is not computed is proven in `attempt-pounds.ts`,
    // where the chart disagrees with the arithmetic; what this asserts is the
    // attribution, which is the part a lifter acts on -- a bare pound figure
    // beside an attempt is a number they will read aloud at the table, and only
    // the chart's is the one the officials are holding.
    //
    // The grind fixture because its push card lands on a chart row. The two
    // cards offered after a solid opener sit between rows, which is the *other*
    // state and gets its own test below.
    const element = await mount(afterAGrind());

    expect(deepText(element)).toContain('on the chart');
  });

  it('says a legal weight has no chart row rather than filling the gap', async () => {
    // §13.2's "legal and published are kept apart": a chart printed in five
    // kilogram steps does not make 181 kg illegal, and the bar multiple does not
    // put a row on the chart. Two sources, two questions -- so the honest answer
    // is the reason plus a figure labelled approximate, not a computed pound
    // number wearing the chart's authority.
    const element = await mount(afterASolidOpener());

    const text = deepText(element);
    expect(text).toContain('The federation chart has no row for this weight.');
    expect(text).toContain('about ');
    expect(text).not.toContain('on the chart');
  });

  it('explains a missing pound figure once, not once per card', async () => {
    // "No chart is loaded" is one fact about the read, not three facts about
    // three weights, and said three times it reads as three separate problems.
    const uncharted = contextAt(START, {
      chart: null,
      planning: maximumOn('squat', MAXIMUM),
      targets: TARGETS,
    });
    const element = await mount(choicesOf(take(meetWith(), 'squat', OPENER), uncharted), {
      chart: null,
    });

    const text = deepText(element);
    const occurrences = text.split('No published pound chart is loaded').length - 1;

    expect(occurrences).toBe(1);
    // The control: the approximate conversion the sentence is about is on screen.
    expect(text).toContain('about ');
  });

  it('offers a free-entry weight and reports it with no slot', async () => {
    // §13's last line -- never prevent a different legal weight. The `null` slot
    // is what lets a caller tell "took our recommendation" from "typed 187.5"
    // without comparing floating-point weights.
    const choices = afterAGrind();
    const element = await mount(choices);
    const seen = watch();

    await typeWeight(element, '187.5');
    useTypedButton(element).click();

    expect(seen).toEqual([{ attemptId: choices.attemptId, kilograms: 187.5, slot: null }]);
  });

  it('will not report a typed weight until one has been typed', async () => {
    const element = await mount(afterAGrind());
    const seen = watch();

    expect(useTypedButton(element).disabled).toBe(true);

    // Dispatched at the `ptk-button` host rather than at the native button: a
    // disabled `<button>` fires no click at all, so a press through it proves
    // nothing about the guard inside the handler. A thumb landing on the host's
    // own padding does run it.
    const host = element.shadowRoot?.querySelector('ptk-button:not([data-slot])');
    host?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

    expect(seen).toEqual([]);
  });

  it('refuses a typed pound figure instead of converting it', async () => {
    // §16 again, arriving where it is most tempting to break: the lifter typed a
    // number and the tool could work out the kilograms. Doing so would make this
    // screen the author of the weight called to the expeditor, which the
    // published chart owns and nothing else does.
    const element = await mount(afterAGrind());
    const seen = watch();

    await typeWeight(element, '400 lb');

    expect(deepText(element)).toContain(OTHER_WEIGHT_MUST_BE_KILOGRAMS);
    expect(useTypedButton(element).disabled).toBe(true);
    expect(seen).toEqual([]);
  });

  it('says what is wrong with an unreadable figure', async () => {
    const element = await mount(afterAGrind());

    await typeWeight(element, 'heavy');

    expect(useTypedButton(element).disabled).toBe(true);
    expect(deepText(element)).not.toContain('Use this weight, ');
  });

  it('treats an empty field as unanswered rather than as an error', async () => {
    // A field nobody has touched has nothing wrong with it, and an error under
    // an empty box on a screen that repaints four times a second reads as the
    // tool complaining about the lifter standing still.
    const element = await mount(afterAGrind());

    await typeWeight(element, '190');
    await typeWeight(element, '');

    const field = element.shadowRoot?.querySelector(`[data-field="${OTHER_WEIGHT_FIELD}"]`);
    expect(field?.getAttribute('error')).toBe('');
  });

  it('clears a typed weight when the attempt changes', async () => {
    // Otherwise a figure typed against the second attempt is submitted against
    // the third, by a lifter who typed it once and pressed once.
    const element = await mount(afterASolidOpener());
    await typeWeight(element, '191');

    // A second made attempt, so the next attempt is genuinely the third and the
    // id genuinely changes. This is worth spelling out: the grind fixture is one
    // attempt in, exactly like the solid opener, so the two produce *the same*
    // attempt id -- and a test written against them would report the reset
    // working while asserting that nothing changed.
    element.choices = choicesOf(take(take(meetWith(), 'squat', OPENER), 'squat', SECOND), GRADED);
    await element.updateComplete;

    expect(useTypedButton(element).disabled).toBe(true);
  });

  it('keeps a typed weight when the same attempt is rebuilt', async () => {
    // The other direction, and the one that looks like a bug in review. The live
    // view is rebuilt off the clock seam four times a second, so a fresh
    // `LiveChoices` for the same attempt arrives between two digits -- keying the
    // reset on object identity would read as the keyboard dropping characters.
    const choices = afterAGrind();
    const element = await mount(choices);
    await typeWeight(element, '191');

    element.choices = { ...choices };
    await element.updateComplete;

    expect(useTypedButton(element).disabled).toBe(false);
  });

  it('renders the rule book refusals it was handed', async () => {
    // The element does not check legality and must not start: a second opinion
    // in a template is a copy of a federation's rules that goes stale in silence.
    const element = await mount(afterAGrind(), { refusals: ['below-a-failed-attempt'] });

    expect(deepText(element)).toContain(refusalSentence('below-a-failed-attempt'));
  });

  it('keeps a granted extra attempt out of the three cards', async () => {
    // §13.8. An extra attempt does not raise the floor under a competition
    // attempt, so a card for it among the three would put a weight into the
    // round sequence that the rules do not have a slot for.
    const choices = choicesOf(
      take(meetWith(), 'squat', SECOND, { outcome: 'extra-attempt-granted' }),
      GRADED,
    );
    const element = await mount(choices);

    const extras = element.shadowRoot?.querySelector('.extras');
    expect(deepText(element)).toContain(EXTRA_ATTEMPTS_HEADING);
    expect(extras).not.toBeNull();
    expect(element.shadowRoot?.querySelector('.cards')?.contains(extras ?? null)).toBe(false);
  });

  it('shows a reduction as a step down rather than as an unsigned figure', async () => {
    // The set-aside branch is the one that produces a negative jump: the attempt
    // that was put aside is no longer the floor, so the offer sits below it. An
    // unsigned figure here tells the lifter they are going up.
    const element = await mount(
      choicesOf(take(meetWith(), 'squat', SECOND, { outcome: 'extra-attempt-granted' }), GRADED),
    );

    expect(deepText(element)).toContain('Down ');
  });

  it('raises a strong advisory as an error notice', async () => {
    // After a report of pain the tool stops offering an increase and says why.
    // The severity has to reach the eye as well as the reader: §5.8 puts the
    // word in the notice, and the tone is what makes it stand out beside the
    // notes that are only notes.
    const element = await mount(
      choicesOf(take(meetWith(), 'squat', SECOND, { outcome: 'no-lift', reason: 'pain' }), GRADED),
    );

    const notices = [...(element.shadowRoot?.querySelectorAll('ptk-notice') ?? [])];
    expect(notices.some((notice) => notice.getAttribute('tone') === 'error')).toBe(true);
  });

  it('offers no push slot after a report of pain', async () => {
    // §13.5's reason for slot and highlight being two fields. This is the branch
    // where the tool must not offer an increase at all, and a screen that drew
    // three cards because three is the number would offer one.
    const element = await mount(
      choicesOf(take(meetWith(), 'squat', SECOND, { outcome: 'no-lift', reason: 'pain' }), GRADED),
    );

    expect(element.shadowRoot?.querySelector('ptk-button[data-slot="push"]')).toBeNull();
    // The control: the pass is on screen and highlighted, so the assertion above
    // is not passing because nothing rendered.
    expect(deepText(slotButton(element, 'secure'))).toContain(PASS_LABEL);
  });

  it('reads a typed weight through the composed path, not through the target', async () => {
    // §5.8. The field's event is retargeted to this host on the way out of the
    // child's shadow tree, so a handler reading `event.target.dataset` sees an
    // empty dataset and drops every keystroke while the field visibly accepts
    // them. An event carrying no field at all must change nothing.
    const element = await mount(afterAGrind());

    element.dispatchEvent(
      new CustomEvent(NUMBER_FIELD_CHANGE_EVENT, {
        detail: { value: '195' },
        bubbles: true,
        composed: true,
      }),
    );
    await element.updateComplete;

    expect(useTypedButton(element).disabled).toBe(true);
  });

  it('fits a 320px column and has no axe violations', async () => {
    // §5.7's floor. Measured on the grind fixture because it is the widest of
    // the branches -- three cards, a tactical note and a target sentence.
    const column = document.createElement('div');
    column.style.width = '320px';
    document.body.append(column);
    teardown.push(() => {
      column.remove();
    });

    const element = document.createElement('ptk-live-choices');
    element.choices = afterAGrind();
    element.chart = CHART;
    column.append(element);
    await element.updateComplete;

    expect(element.scrollWidth).toBeLessThanOrEqual(320);

    const results = await axe.run(column);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
