import type { Choice, PtkSegmented } from '@platform-toolkit/ui';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

// Through the package entry, not `./ptk-segmented.js` beside this file. The two
// spellings are two modules, a custom element may be defined once per registry,
// and the second definition throws -- silently, because the story still renders
// from the first one. See the same note in `ptk-select.stories.ts`.
import '@platform-toolkit/ui';

/**
 * The compact single-choice bar.
 *
 * Use it for a switch a lifter flips while reading -- which lift is on screen,
 * which family of targets, which unit comes first. Use `ptk-choice-group`
 * instead for a question they answer once and move past: it has room for a
 * second line, draws a visible radio, and reads as a form field rather than as
 * navigation.
 */

const LIFTS: readonly Choice[] = [
  { value: 'squat', label: 'Squat' },
  { value: 'bench', label: 'Bench' },
  { value: 'deadlift', label: 'Deadlift' },
  { value: 'total', label: 'Total' },
];

const meta: Meta<PtkSegmented> = {
  title: 'UI/Segmented',
  component: 'ptk-segmented',
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
    value: { control: 'text' },
    hideLabel: { control: 'boolean' },
    disabled: { control: 'boolean' },
    emptyMessage: { control: 'text' },
  },
  args: {
    label: 'Lift',
    choices: LIFTS,
    value: 'squat',
    hideLabel: false,
    disabled: false,
    // Stated rather than left to the element's own default, because the render
    // below binds it as a property: an absent arg would bind `undefined` and
    // overwrite that default with nothing, which the empty story would then
    // show as a blank line where its one sentence belongs.
    emptyMessage: 'No options available.',
  },
  render: (args) => html`
    <ptk-segmented
      .label=${args.label}
      .choices=${args.choices}
      .value=${args.value}
      ?hide-label=${args.hideLabel}
      ?disabled=${args.disabled}
      .emptyMessage=${args.emptyMessage}
    ></ptk-segmented>
  `,
};

export default meta;

type Story = StoryObj<PtkSegmented>;

export const FourLifts: Story = {};

/** Two answers, which is the other shape this gets used in: a target family. */
export const TwoOptions: Story = {
  args: {
    label: 'Targets',
    choices: [
      { value: 'classifications', label: 'Classifications' },
      { value: 'records', label: 'Records' },
    ],
    value: 'records',
  },
};

/**
 * The legend clipped out of sight because a heading beside the bar already says
 * it. The name is still in the accessibility tree -- the whole point of clipping
 * rather than removing.
 */
export const LabelHiddenFromSight: Story = {
  args: { hideLabel: true },
};

/**
 * Nothing chosen. A real state on first paint, and it must not snap to the first
 * option: a bar that silently selects something puts a screen in front of a
 * reader that they did not ask for.
 */
export const NothingChosen: Story = {
  args: { value: null },
};

export const Disabled: Story = {
  args: { disabled: true },
};

/**
 * No options at all -- published data that has not arrived. An empty bar reads
 * as a rendering failure, so it says so instead.
 */
export const NoOptions: Story = {
  args: { choices: [], emptyMessage: 'No lifts are published for this category.' },
};

/**
 * A phone-width column, constrained by a wrapper rather than a viewport setting.
 *
 * The bar keys off its own width, so the wrapper is what it responds to. Four
 * lifts wrap to two rows here rather than scrolling sideways, which is the
 * behaviour worth looking at: a strip that scrolls hides its own last option,
 * and at a rack that is as often the one wanted as the first.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-segmented
        .label=${args.label}
        .choices=${args.choices}
        .value=${args.value}
      ></ptk-segmented>
    </div>
  `,
};
