import type { Lift } from '@platform-toolkit/data-contracts';
import { PtkChoiceGroup, PtkDisclosure, PtkNumberField } from '@platform-toolkit/ui';
// Every spacing declaration in this panel reads a custom property, and a
// declaration referencing an undefined one is dropped -- so without the
// stylesheet the layout measured at the bottom of this file is not the shipped
// layout, and the narrow-width check passes by measuring a grid with no gaps.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ENTRIES_CHANGE_EVENT,
  type EntriesChangeDetail,
  type PtkTargetLifts,
} from './ptk-target-lifts.js';
import './ptk-target-lifts.js';

/**
 * Real browser, real custom elements, real Shadow DOM.
 *
 * Every keystroke here leaves a number field's own shadow tree, crosses this
 * host's root as a composed event, and is read out of `composedPath()`. An
 * emulated DOM that got the retargeting subtly wrong would leave a green suite
 * and a panel whose fields accept typing while no figure ever reaches the
 * report -- which reads as a rendering fault rather than an event one.
 */

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(): Promise<PtkTargetLifts> {
  const element = document.createElement('ptk-target-lifts');
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** Records what the panel reports, from outside its shadow root. */
function watch(): EntriesChangeDetail[] {
  const seen: EntriesChangeDetail[] = [];
  const listener = (event: CustomEvent<EntriesChangeDetail>): void => {
    seen.push(event.detail);
  };
  // On the body rather than on the element: the claim is that the event left the
  // shadow root, and a listener on the element would hold whether it did or not.
  document.body.addEventListener(ENTRIES_CHANGE_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(ENTRIES_CHANGE_EVENT, listener);
  });
  return seen;
}

/**
 * The one element matching, or a failure naming the selector.
 *
 * Not generic, for the reason the warm-up suite gives: `querySelector<T>` is an
 * assertion wearing a function's clothes, so a selector typo hands back the
 * wrong element typed as the right one and the failure arrives three lines later
 * as a missing method. The narrowing below is a claim the runtime can refuse.
 */
function find(element: PtkTargetLifts, selector: string): Element {
  const found = element.shadowRoot?.querySelector(selector);
  if (found === null || found === undefined) {
    throw new Error(`Nothing rendered for "${selector}".`);
  }
  return found;
}

function fold(element: PtkTargetLifts): PtkDisclosure {
  const found = find(element, 'ptk-disclosure');
  if (!(found instanceof PtkDisclosure)) throw new Error('The panel is not a disclosure.');
  return found;
}

function field(element: PtkTargetLifts, lift: Lift): PtkNumberField {
  const found = find(element, `ptk-number-field[data-lift="${lift}"]`);
  if (!(found instanceof PtkNumberField)) throw new Error(`"${lift}" is not a number field.`);
  return found;
}

function units(element: PtkTargetLifts): PtkChoiceGroup {
  const found = find(element, 'ptk-choice-group');
  if (!(found instanceof PtkChoiceGroup))
    throw new Error('The unit control is not a choice group.');
  return found;
}

/** Types the way a lifter does, so the element's own delegated listener runs. */
async function type(element: PtkTargetLifts, lift: Lift, text: string): Promise<void> {
  const input = field(element, lift).shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No input inside "${lift}".`);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** Presses a unit option the way a lifter does. */
async function chooseUnit(element: PtkTargetLifts, value: string): Promise<void> {
  const radios = units(element).shadowRoot?.querySelectorAll('input[type="radio"]') ?? [];
  for (const radio of radios) {
    if (radio instanceof HTMLInputElement && radio.value === value) {
      radio.click();
      await element.updateComplete;
      return;
    }
  }
  throw new Error(`No unit option "${value}".`);
}

function summaryOf(element: PtkTargetLifts): string {
  return fold(element).getAttribute('summary') ?? '';
}

describe('ptk-target-lifts', () => {
  /**
   * Requirement 11, and the whole reason this element was rebuilt. It used to
   * open unfolded above the records, so the first thing a lifter met after
   * answering the questions was a form asking them to type their meet in.
   */
  it('starts folded and out of the way', async () => {
    const element = await mount();
    expect(fold(element).open).toBe(false);
    expect(fold(element).getAttribute('label')).toBe('Your lifts (optional)');
  });

  /**
   * A fold is only safe when its summary states the whole of what is true while
   * closed (§5.8). Here that is which figures the report was marked against: a
   * lifter who cannot see them has no way to notice that a mistyped bench is
   * what struck out half a column.
   */
  it('says plainly that nothing has been entered', async () => {
    expect(summaryOf(await mount())).toBe('Nothing entered yet.');
  });

  it('names every figure entered, with its unit, while folded', async () => {
    const element = await mount();
    await type(element, 'squat', '142.5');
    await type(element, 'bench', '80');
    expect(summaryOf(element)).toBe('Squat 142.5 kg, Bench press 80 kg.');
  });

  /**
   * A rejected value is left out. The field itself carries the error, and naming
   * it in a summary of what was entered would say it counted -- against a report
   * that has not been marked with it at all.
   */
  it('leaves a rejected entry out of the summary and says why on the field', async () => {
    const element = await mount();
    await type(element, 'squat', '1o5');
    expect(summaryOf(element)).toBe('Nothing entered yet.');
    expect(field(element, 'squat').error).not.toBe('');
  });

  /**
   * The canary for Lit's decorator configuration. Everything else in this file
   * passes when `experimentalDecorators` and `useDefineForClassFields` disagree;
   * only a state change after the first render fails, and the symptom in the
   * product is a panel that never updates.
   */
  it('re-renders the fields after the first render', async () => {
    const element = await mount();
    expect(field(element, 'squat').value).toBe('');
    await type(element, 'squat', '150');
    expect(field(element, 'squat').value).toBe('150');
  });

  /**
   * The derived total is shown in the field rather than left blank, so the
   * number a lifter reads is the number the report is measured against. A blank
   * total beside a report striking through rungs at 300 kg reads as a fault.
   */
  it('shows the total derived from the three lifts', async () => {
    const element = await mount();
    await type(element, 'squat', '100');
    await type(element, 'bench', '60');
    await type(element, 'deadlift', '140');
    expect(field(element, 'total').value).toBe('300');
    expect(summaryOf(element)).toContain('Total 300 kg');
  });

  /**
   * A unit change converts; it never rereads. Tool 2 asks which was meant,
   * because a rack setup is configuration somebody might be re-stating. A
   * competition best is not -- it is a fact about a meet that already happened,
   * and rereading 405 lb as 405 kg comes back as Elite with nothing on screen to
   * catch it.
   */
  it('converts what was typed when the unit changes', async () => {
    const element = await mount();
    await type(element, 'squat', '100');
    await chooseUnit(element, 'lb');
    expect(summaryOf(element)).toBe('Squat 220.5 lb.');
    expect(field(element, 'squat').value).not.toBe('100');
  });

  it('leaves text that never read as a weight alone', async () => {
    // Rewriting it would delete what the lifter typed in the middle of
    // correcting it -- and there is nothing there to convert either way.
    const element = await mount();
    await type(element, 'squat', '1o5');
    await chooseUnit(element, 'lb');
    expect(field(element, 'squat').value).toBe('1o5');
  });

  it('reports every change outside its own shadow root', async () => {
    const element = await mount();
    const seen = watch();
    await type(element, 'squat', '150');
    expect(seen.at(-1)?.entries.fields.squat.text).toBe('150');
    await chooseUnit(element, 'lb');
    expect(seen.at(-1)?.entries.unit).toBe('lb');
    expect(seen).toHaveLength(2);
  });

  it('reports nothing for a property set, only for a lifter', async () => {
    // A listener that wrote state back on the event would loop. Nothing here
    // sets a property from outside, so the assertion is that mounting and
    // rendering alone are silent.
    const seen = watch();
    await mount();
    expect(seen).toEqual([]);
  });

  it('offers the unit the entries are currently read in', async () => {
    const element = await mount();
    expect(units(element).value).toBe('kg');
    await chooseUnit(element, 'lb');
    expect(units(element).value).toBe('lb');
  });

  it('has no accessibility violations, folded or open', async () => {
    const element = await mount();
    const folded = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(folded.violations).toEqual([]);

    fold(element).open = true;
    await element.updateComplete;
    await type(element, 'squat', '1o5');
    const open = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(open.violations).toEqual([]);
  });

  it('fits a 320 pixel column with the fold open', async () => {
    const element = await mount();
    fold(element).open = true;
    await element.updateComplete;

    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });
    frame.append(element);
    await element.updateComplete;

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
