import type { PtkNumberField } from '@platform-toolkit/ui';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

// Through the package entry rather than the relative path beside this file. The
// two spellings are two modules, and a custom element may only be defined once
// per registry -- the second definition throws while the story still renders
// correctly off the first, so the only symptom is a console error.
import '@platform-toolkit/ui';

/**
 * A number a lifter types, and the states that go with typing one.
 *
 * The filled-in field is the least interesting of these. What a reader cannot
 * guess is what the element does with text that is not a number, how an error
 * reads underneath it, and how wide the box is when the column is a phone.
 */

const meta: Meta<PtkNumberField> = {
  title: 'Shared/Number field',
  component: 'ptk-number-field',
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text', description: 'The question. Becomes the accessible name.' },
    value: { control: 'text', description: 'What is in the field. A string, never parsed here.' },
    unit: { control: 'text', description: 'Shown inside the box; described, not named.' },
    placeholder: { control: 'text' },
    hint: { control: 'text', description: 'A standing note. Not a validation message.' },
    error: { control: 'text', description: 'What is wrong with the value, or empty.' },
    disabled: { control: 'boolean' },
  },
  args: {
    label: 'Squat',
    value: '',
    unit: 'kg',
    placeholder: '0',
    hint: '',
    error: '',
    disabled: false,
  },
  render: (args) => html`
    <ptk-number-field
      .label=${args.label}
      .value=${args.value}
      .unit=${args.unit}
      .placeholder=${args.placeholder}
      .hint=${args.hint}
      .error=${args.error}
      ?disabled=${args.disabled}
    ></ptk-number-field>
  `,
};

export default meta;

type Story = StoryObj<PtkNumberField>;

export const Empty: Story = {};

export const Entered: Story = {
  args: { value: '142.5' },
};

/**
 * A note about what belongs in the field, standing regardless of its contents.
 *
 * Distinct from an error and rendered differently, because a hint that looked
 * like a problem would read as one every time the field is empty.
 */
export const WithHint: Story = {
  args: { hint: 'Your best competition squat.', value: '142.5' },
};

/**
 * Text the visitor typed that is not a number.
 *
 * This is the state `type="number"` cannot produce: the browser would have
 * emptied the field, leaving nothing to show back and nothing to explain. Here
 * the input survives, so the message can be about what was actually typed.
 */
export const Invalid: Story = {
  args: { value: '1o5', error: 'Enter a weight in kilograms, for example 142.5.' },
};

/**
 * A value that parses and is still not usable.
 *
 * Worth its own story because the field looks identical to the case above while
 * the message has to do entirely different work.
 */
export const OutOfRange: Story = {
  args: { value: '0', error: 'Enter a weight above zero.' },
};

/** No unit, which is the right shape for a rep count rather than a weight. */
export const WithoutUnit: Story = {
  args: { label: 'Repetitions', unit: '', value: '5', placeholder: '1' },
};

/** Disabled by the tool while something the value depends on is still loading. */
export const Disabled: Story = {
  args: { value: '142.5', disabled: true },
};

/**
 * The width a phone actually gives this element.
 *
 * Constrained by a wrapper rather than a viewport setting, because the wrapper
 * is the constraint the element responds to. Four fields together, since a
 * single field in isolation never shows the spacing problem that a stack of
 * them does.
 */
export const Narrow: Story = {
  args: { hint: 'Kilograms, to the nearest 0.5.' },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor; padding: 1rem;">
      ${['Squat', 'Bench press', 'Deadlift', 'Total'].map(
        (lift) => html`
          <ptk-number-field
            style="margin-block-end: 1rem;"
            .label=${lift}
            .value=${args.value}
            .unit=${args.unit}
            .placeholder=${args.placeholder}
            .hint=${args.hint}
            .error=${args.error}
            ?disabled=${args.disabled}
          ></ptk-number-field>
        `,
      )}
    </div>
  `,
};
