import {
  createPreferenceStore,
  memoryPreferenceStorage,
  type PreferenceStore,
} from '@platform-toolkit/preferences';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { DEFAULT_EQUIPMENT, saveEquipment, type Equipment } from './equipment.js';
import type { PtkWarmUpCalculator } from './ptk-warm-up-calculator.js';
import './ptk-warm-up-calculator.js';
import { saveEntries, type LiftEntry } from './session.js';

/**
 * The whole tool, composed.
 *
 * Three elements in three shadow trees, wired together by events, over two
 * stores with two different lifetimes -- what the lifter squats outlives the
 * tab, which sets they have finished today must not. Both stores are properties
 * here, so a story can hand in a device that remembers nothing, a device that
 * remembers a session from Tuesday, or a device with no storage at all, and none
 * of the three touches the browser's real `localStorage`.
 *
 * Every weight below is invented.
 */

/** A device that remembers, seeded with a session already in progress. */
function deviceRemembering(equipment: Equipment, entries: readonly LiftEntry[]): PreferenceStore {
  const store = createPreferenceStore(memoryPreferenceStorage());
  saveEquipment(store, equipment);
  saveEntries(store, entries, equipment.plateUnit);
  return store;
}

const SQUAT: LiftEntry = {
  key: 'squat',
  liftId: 'squat',
  name: 'Squat',
  family: 'squat-press',
  barId: '',
  weight: '140',
  sets: '3',
  reps: '5',
};

/** Two lifts, in the order they are done. */
const TUESDAY: readonly LiftEntry[] = [
  SQUAT,
  {
    key: 'bench-press',
    liftId: 'bench-press',
    name: 'Bench Press',
    family: 'squat-press',
    barId: '',
    weight: '95',
    sets: '3',
    reps: '5',
  },
];

/**
 * One store per story, built once at module load.
 *
 * Building them inside `render` would look tidier and would throw away whatever
 * the reader had typed on every control change, which is the opposite of what an
 * interactive doc is for.
 */
const SESSION_STORE = deviceRemembering(DEFAULT_EQUIPMENT, TUESDAY);
const POUND_STORE = deviceRemembering({ ...DEFAULT_EQUIPMENT, plateUnit: 'lb' }, [
  { ...SQUAT, weight: '315' },
]);
const FRESH_STORE = createPreferenceStore(memoryPreferenceStorage());

/** A device that refuses storage, which is the third-party iframe case. */
const NO_STORAGE = createPreferenceStore(null);

const meta: Meta<PtkWarmUpCalculator> = {
  title: 'Warm-up/Calculator',
  component: 'ptk-warm-up-calculator',
  tags: ['autodocs'],
  argTypes: {
    settings: { control: false, description: 'The rack and the weights. Outlives the tab.' },
    marks: { control: false, description: 'Which sets are done. Must not outlive the tab.' },
  },
  args: { settings: FRESH_STORE, marks: createPreferenceStore(memoryPreferenceStorage()) },
  render: (args) => html`
    <ptk-warm-up-calculator
      .settings=${args.settings}
      .marks=${args.marks}
    ></ptk-warm-up-calculator>
  `,
};

export default meta;

type Story = StoryObj<PtkWarmUpCalculator>;

/** A first visit: the rack folded away, the catalogue open, nothing on the list. */
export const FirstVisit: Story = {};

/** A device that remembers Tuesday's session, restored on load rather than re-entered. */
export const RememberedSession: Story = {
  args: { settings: SESSION_STORE },
};

/** The same tool in pounds, which is a different set of plate denominations and not a label. */
export const InPounds: Story = {
  args: { settings: POUND_STORE },
};

/**
 * A private window, or an embedder that blocked storage.
 *
 * `localStorage` throws on *property access* when access is denied, so a tool
 * that reaches for it at start-up dies at start-up -- in exactly the
 * configuration these tools are designed to ship into. Here the whole screen
 * works and the equipment section says plainly that nothing will be kept.
 */
export const NoStorageAvailable: Story = {
  args: { settings: NO_STORAGE, marks: NO_STORAGE },
};

/**
 * A phone-width column with the whole tool in it. This is the primary target,
 * not a degraded case: the tool is read at a warm-up rack, one-handed.
 */
export const Narrow: Story = {
  args: { settings: SESSION_STORE },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-warm-up-calculator
        .settings=${args.settings}
        .marks=${args.marks}
      ></ptk-warm-up-calculator>
    </div>
  `,
};
