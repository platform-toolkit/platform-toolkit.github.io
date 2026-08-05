// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Typing in a result the archive does not have.
 *
 * The manual path, and it must stay fully usable on its own -- a lifter whose federation
 * nobody mirrors, a meet from last weekend that has not been published yet, a meet
 * director checking a registration against a printout. Import assists; it is never the
 * way in.
 *
 * WHY THERE IS ONLY ONE INTERESTING STORY AND IT IS A PLAY FUNCTION
 *
 * This element holds its own draft and its own problems, and neither is a property: a
 * consumer cannot seed a half-filled form, and it would be wrong to let them, because the
 * draft is the reader's and nobody else may write to it. So the state worth documenting
 * -- eight fields answered wrongly, every problem reported at once rather than the first
 * one found (section 5.5) -- is only reachable by pressing the button, which is what
 * {@link EverythingWrongAtOnce} does.
 *
 * Every figure is invented (section 5.1).
 */
import { defineQualificationCheck } from '@platform-toolkit/qualification-check/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkResultForm } from './ptk-result-form.js';

// The registry is written once, explicitly. See the note in the composite root's stories.
defineQualificationCheck();

const meta: Meta<PtkResultForm> = {
  title: 'Qualification check/Result form',
  component: 'ptk-result-form',
  tags: ['autodocs'],
  render: () => html`<ptk-result-form></ptk-result-form>`,
};

export default meta;

type Story = StoryObj<PtkResultForm>;

/**
 * The empty form, which is where a lifter with no import starts.
 *
 * Nothing is marked. Every field is blank because the page just opened, and blank is not
 * a mistake -- a form that opens with eight errors on it has told the reader they are
 * already wrong before they have typed a character.
 */
export const Empty: Story = {};

/**
 * Submitted with nothing in it, so that every problem is on screen at once.
 *
 * The state the element exists to get right, and the reason `readTypedResult` collects
 * problems rather than returning the first: a reader who fixes one field, presses again,
 * and is told about the next one has been made to do eight round trips through a form
 * they could have completed in one. Each message names its own field, beside it.
 *
 * The press is a play function because there is no property that can seed this -- see the
 * note at the top of the file.
 */
export const EverythingWrongAtOnce: Story = {
  play: async ({ canvasElement }) => {
    const form = canvasElement.querySelector('ptk-result-form');
    await form?.updateComplete;
    const submit = form?.shadowRoot?.querySelector('ptk-button');
    submit?.shadowRoot?.querySelector('button')?.click();
    await form?.updateComplete;
  },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than by
 * a viewport parameter.
 *
 * Eight fields, one of them a date, three of them numeric, and every label has to fit
 * beside its own control at 200 % text without pushing the column sideways. The numeric
 * fields are `ptk-number-field`, which is `type="text"` with `inputmode="decimal"` -- a
 * real `type="number"` gives a phone a spinner nobody can hit and a keypad without a
 * decimal point on some locales.
 */
export const Narrow: Story = {
  render: () => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-result-form></ptk-result-form>
    </div>
  `,
};
