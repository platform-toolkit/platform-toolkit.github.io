import type { PtkSelect, SelectOption } from '@platform-toolkit/ui';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

// Through the package entry, not the relative path beside this file. A custom
// element may be defined once per registry and the two spellings are two
// modules: a relative import here would load the source copy and define the tag
// a second time. The registry throws, the story still looks correct because the
// first definition already won, and the only symptom is a console error.
import '@platform-toolkit/ui';

/**
 * The long-list control, and the states a working page never shows.
 *
 * The one worth opening the popup for is {@link Grouped}: a flat list of
 * eighteen divisions is the thing this element exists to stop, and the headings
 * are the only structure a native select offers. A screenshot cannot show that,
 * because the list is painted by the engine outside the page -- so the story is
 * here to be interacted with rather than to be looked at.
 */

/** Invented regions, short. Real ones come from published data (§5.1). */
const REGIONS: readonly SelectOption[] = [
  { value: 'north', label: 'North' },
  { value: 'south', label: 'South' },
  { value: 'east', label: 'East' },
  { value: 'west', label: 'West' },
];

/** Invented divisions, in the two families that make the headings worth having. */
const DIVISIONS: readonly SelectOption[] = [
  { value: 'j-teen', label: 'Teen 16-17', group: 'Juniors' },
  { value: 'j-1', label: 'Junior 18-19', group: 'Juniors' },
  { value: 'j-2', label: 'Junior 20-23', group: 'Juniors' },
  { value: 'm-1', label: 'Master 40-44', group: 'Masters' },
  { value: 'm-2', label: 'Master 45-49', group: 'Masters' },
  { value: 'm-3', label: 'Master 50-54', group: 'Masters' },
  { value: 'm-4', label: 'Master 55-59', group: 'Masters' },
];

const meta: Meta<PtkSelect> = {
  title: 'Shared/Select',
  component: 'ptk-select',
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text', description: 'The question. Becomes the accessible name.' },
    value: { control: 'text', description: 'The chosen value, or null for none.' },
    placeholder: { control: 'text', description: 'The option that means “no answer”.' },
    hint: {
      control: 'text',
      description: 'What the answer is used for. A description, not a name.',
    },
    emptyMessage: { control: 'text', description: 'Shown in place of the control when empty.' },
    disabled: { control: 'boolean' },
    options: { control: 'object' },
  },
  args: {
    label: 'State',
    options: REGIONS,
    value: null,
    placeholder: 'Not selected',
    hint: '',
    emptyMessage: 'No options available.',
    disabled: false,
  },
  render: (args) => html`
    <ptk-select
      .label=${args.label}
      .options=${args.options}
      .value=${args.value}
      .placeholder=${args.placeholder}
      .hint=${args.hint}
      empty-message=${args.emptyMessage}
      ?disabled=${args.disabled}
    ></ptk-select>
  `,
};

export default meta;

type Story = StoryObj<PtkSelect>;

/**
 * Nothing chosen, which is where an optional question starts and where it can
 * always be returned to. The placeholder is drawn as an absence rather than as
 * an answer, so a screen of these reads as unanswered at a glance.
 */
export const Unanswered: Story = {};

export const Answered: Story = {
  args: { value: 'south' },
};

/**
 * The reason this element exists rather than a row of tiles.
 *
 * Seven divisions here and eighteen in the real catalogue; as tiles they were
 * most of the screen, and the report underneath them is what a lifter came for.
 * Open the control to see the headings -- they are the one piece of structure a
 * native select gives, and they turn an unreadable flat list into two short ones.
 */
export const Grouped: Story = {
  args: {
    label: 'Masters or Juniors division',
    options: DIVISIONS,
    placeholder: 'Open only',
    hint: 'Optional. Open records and classifications are always shown.',
  },
};

/**
 * Answered, with the clearing route visible in the popup.
 *
 * The placeholder is never removed once something is chosen, which is what makes
 * every one of these optional questions reversible. A lifter who picked a
 * division by accident gets back to Open by choosing the first entry.
 */
export const AnsweredAndClearable: Story = {
  args: {
    label: 'Masters or Juniors division',
    options: DIVISIONS,
    value: 'm-2',
    placeholder: 'Open only',
    hint: 'Optional. Open records and classifications are always shown.',
  },
};

/**
 * A hint under the label, wired as a description rather than folded into the
 * name. "State, combo box, adds state records to the report", not "State adds
 * state records to the report, combo box".
 */
export const WithHint: Story = {
  args: { hint: 'Optional. Adds this state’s records to the report.' },
};

/**
 * A question that cannot be answered yet, because it depends on one that has
 * not been. The message is the caller's, since only the caller knows why.
 */
export const NothingToChooseFrom: Story = {
  args: {
    options: [],
    emptyMessage: 'Choose a federation to see the states it keeps records for.',
  },
};

/**
 * The value is not among the options, so nothing is selected.
 *
 * The case that makes the element safe to reuse across federations. Falling
 * through to the engine's default would select the first option -- an answer the
 * lifter never gave, on a screen whose whole job is matching a category exactly.
 */
export const ValueNotOffered: Story = {
  args: { value: 'a-region-this-federation-does-not-keep-records-for' },
};

/** Disabled by the tool while something it depends on is still loading. */
export const Disabled: Story = {
  args: { value: 'north', disabled: true },
};

/**
 * A label longer than the column it is in.
 *
 * A select sizes itself to its widest option by default, so this is the state
 * that pushes a page sideways. Worth its own story because the real catalogue
 * has entries like it and the default width looks fine with four short regions.
 */
export const LongLabels: Story = {
  args: {
    label: 'Division',
    options: [
      { value: 'combined', label: 'Submaster and Master combined, drug tested, single ply' },
      { value: 'open', label: 'Open' },
    ],
    value: 'combined',
  },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor; padding: 1rem;">
      <ptk-select
        .label=${args.label}
        .options=${args.options}
        .value=${args.value}
        .placeholder=${args.placeholder}
      ></ptk-select>
    </div>
  `,
};

/**
 * The width a phone actually gives this element.
 *
 * Constrained by the wrapper rather than by a viewport setting, because the
 * wrapper is the constraint the element responds to: a widget in a narrow
 * sidebar on a wide page is in the same situation as one on a phone. Reviewing
 * at desktop width is how a layout that only works there gets shipped.
 */
export const Narrow: Story = {
  args: {
    label: 'Masters or Juniors division',
    options: DIVISIONS,
    placeholder: 'Open only',
    hint: 'Optional. Open records and classifications are always shown.',
  },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor; padding: 1rem;">
      <ptk-select
        .label=${args.label}
        .options=${args.options}
        .value=${args.value}
        .placeholder=${args.placeholder}
        .hint=${args.hint}
      ></ptk-select>
    </div>
  `,
};
