import {
  createPreferenceStore,
  memoryPreferenceStorage,
  type PreferenceStore,
} from '@platform-toolkit/preferences';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { describedSet, weighing } from './estimate-fixture.js';
import type { PtkOneRepMaxCalculator } from './ptk-one-rep-max-calculator.js';
import './ptk-one-rep-max-calculator.js';
import { saveEntry, type EstimateEntry } from './session.js';

/**
 * The whole tool, composed.
 *
 * Five elements in five shadow trees over two stores with two lifetimes: what a
 * lifter prefers — kilograms or pounds, which lift, how coarse the rounding —
 * outlives the tab, and the set they just described must not. Both stores are
 * properties, so every story below hands in a device of its own and none of them
 * touches the browser's real storage or leaks a set into the next story.
 *
 * The states worth comparing are the ones a screenshot of the happy path hides.
 * `NothingEntered` is what most visitors see first and it has to be inviting
 * rather than empty. `EveryQuestionAnswered` is the only way to reach the top
 * grade, and comparing it against `ADescribedSet` shows what those seven optional
 * questions are actually worth — the same set, the same figure, a different grade.
 * `RefusedSet` is the tool declining to answer, which it must do out loud.
 *
 * Every set below is invented. The figures beside them are not: each one comes
 * from the domain, through the same path the tool uses, so a story cannot show a
 * grade that does not follow from its own answers.
 */

/** A device that remembers, seeded through the tool's own writer. */
function deviceRemembering(entry: EstimateEntry): {
  readonly settings: PreferenceStore;
  readonly session: PreferenceStore;
} {
  const settings = createPreferenceStore(memoryPreferenceStorage());
  const session = createPreferenceStore(memoryPreferenceStorage());
  saveEntry(settings, session, entry);
  return { settings, session };
}

/**
 * One pair of stores per story, built once at module load.
 *
 * Building them inside `render` would look tidier and would throw away whatever
 * the reader had typed on every control change, which is the opposite of what an
 * interactive document is for.
 */
const FRESH = {
  settings: createPreferenceStore(memoryPreferenceStorage()),
  session: createPreferenceStore(memoryPreferenceStorage()),
};
const DESCRIBED = deviceRemembering(describedSet());
const ANSWERED = deviceRemembering(
  describedSet({
    techniqueId: 'competition-squat',
    reserve: '0',
    freshness: 'fresh',
    formQuality: 'consistent',
    experience: 'experienced',
  }),
);
const POUNDS = deviceRemembering(
  describedSet({ ...weighing('315 lb'), lift: 'deadlift', reserve: '1' }),
);
const REFUSED = deviceRemembering(describedSet({ repsText: '25' }));
const NARROW = deviceRemembering(describedSet(weighing('315 lb')));

/** A private window, or an embedder that blocked storage. */
const NO_STORAGE = createPreferenceStore(null);

const meta: Meta<PtkOneRepMaxCalculator> = {
  title: 'One-rep max/Calculator',
  component: 'ptk-one-rep-max-calculator',
  tags: ['autodocs'],
  argTypes: {
    settings: {
      control: false,
      description: 'The unit, the lift and the two step sizes. Outlives the tab.',
    },
    session: {
      control: false,
      description: 'The described set, including the reported sex. Must not outlive the tab.',
    },
  },
  args: { settings: FRESH.settings, session: FRESH.session },
  render: (args) => html`
    <ptk-one-rep-max-calculator
      .settings=${args.settings}
      .session=${args.session}
    ></ptk-one-rep-max-calculator>
  `,
};

export default meta;

type Story = StoryObj<PtkOneRepMaxCalculator>;

/**
 * A first visit.
 *
 * Two fields, six chips and a question, and a panel that says what will appear
 * where rather than sitting blank. The optional questions are folded and their
 * summary names what is unstated — a fold that reads as empty is a fold nobody
 * opens, and two of the questions behind it are what cost most estimates a grade.
 */
export const NothingEntered: Story = {};

/**
 * A set described and nothing optional answered.
 *
 * The state most visitors will actually read: 142.5 kg for five, no movement
 * standard, no reserve stated. The grade is Rough, and that is the honest answer
 * rather than a pessimistic one — the tool has been told a weight and a count and
 * is reading the set as taken to failure because nobody said otherwise.
 */
export const ADescribedSet: Story = {
  args: { settings: DESCRIBED.settings, session: DESCRIBED.session },
};

/**
 * The same set, with every optional question answered.
 *
 * Competition depth, taken to failure, fresh, form held, experienced with
 * singles. Compare the headline against `ADescribedSet`: it has not moved. What
 * moved is the grade and the list of advisories, which is the point — the
 * questions buy a better-founded reading of the same arithmetic, not a bigger
 * number. A tool where answering more made the estimate rise would be paying a
 * lifter to flatter it.
 */
export const EveryQuestionAnswered: Story = {
  args: { settings: ANSWERED.settings, session: ANSWERED.session },
};

/**
 * A deadlift in pounds, one rep left in the tank.
 *
 * Three things follow the unit and the lift rather than being labels on them: the
 * rounding steps are 1, 2.5 and 5 lb, the weight field's placeholder is a pound
 * figure, and the movement standards are sumo and straps rather than squat depth.
 * A fixed list of standards would not merely mislabel the question — a squat
 * identifier on a deadlift is a request the domain refuses outright.
 */
export const InPounds: Story = {
  args: { settings: POUNDS.settings, session: POUNDS.session },
};

/**
 * A set the tool will not estimate from.
 *
 * Twenty-five repetitions measures endurance, and the answer is a sentence saying
 * so and what to do instead — not a figure with a caveat under it. Note what is
 * *not* on screen: no percentage table and no equation list, because there is no
 * estimate for them to be about.
 */
export const RefusedSet: Story = {
  args: { settings: REFUSED.settings, session: REFUSED.session },
};

/**
 * A private window, or an embedder that blocked storage.
 *
 * `localStorage` throws on *property access* when access is denied, so a tool
 * that reaches for it at start-up dies at start-up — in exactly the configuration
 * these tools are designed to ship into. Here the whole screen works; the only
 * difference is that nothing typed survives a reload.
 */
export const NoStorageAvailable: Story = {
  args: { settings: NO_STORAGE, session: NO_STORAGE },
};

/**
 * A phone-width column with the whole tool in it.
 *
 * The primary target, not a degraded case. The weight and repetition fields stack
 * rather than sitting side by side, the quick-count chips wrap, and the two folded
 * sections keep the answer above the fold — which is the reason the equation list
 * and the percentage table are folded at all.
 */
export const Narrow: Story = {
  args: { settings: NARROW.settings, session: NARROW.session },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-one-rep-max-calculator
        .settings=${args.settings}
        .session=${args.session}
      ></ptk-one-rep-max-calculator>
    </div>
  `,
};
