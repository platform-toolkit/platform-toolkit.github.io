import type { CategoryCatalog } from '@platform-toolkit/data-contracts';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkTargetCategories } from './ptk-target-categories.js';
import './ptk-target-categories.js';

/**
 * The manual selection path, with the catalogue handed in rather than fetched.
 *
 * That the element takes its data as a property is what makes these stories
 * possible at all, and the stories are the argument for keeping it that way: the
 * three ways a read can end -- still going, nothing published, failed -- are
 * each a different sentence on screen, and each is one property away from being
 * looked at. A component that loaded its own data would show only whichever of
 * them the network happened to produce.
 */

/** Invented figures. Real boundaries belong in published data. */
const CATALOG: CategoryCatalog = {
  id: 'example',
  label: 'Example Federation',
  equipment: [
    { id: 'raw', label: 'Raw' },
    { id: 'single-ply', label: 'Single-ply' },
  ],
  weightClassLadders: [
    {
      id: 'example-female',
      label: 'Female classes',
      sex: 'female',
      classes: [
        { id: 'f-52', label: '52 kg', maximumKilograms: 52 },
        { id: 'f-56', label: '56 kg', maximumKilograms: 56 },
        { id: 'f-plus', label: '56+ kg', maximumKilograms: null },
      ],
    },
    {
      id: 'example-male',
      label: 'Male classes',
      sex: 'male',
      classes: [
        { id: 'm-75', label: '75 kg', maximumKilograms: 75 },
        { id: 'm-plus', label: '75+ kg', maximumKilograms: null },
      ],
    },
  ],
  ageDivisions: {
    id: 'example-divisions',
    label: 'Divisions',
    basis: 'age-on-meet-date',
    divisions: [
      { id: 'open', label: 'Open', minimumAge: null, maximumAge: null },
      { id: 'junior', label: 'Junior', minimumAge: null, maximumAge: 23 },
      { id: 'masters-1', label: 'Masters 1', minimumAge: 40, maximumAge: 49 },
      { id: 'masters-4', label: 'Masters 4', minimumAge: 70, maximumAge: null },
    ],
  },

  // The records screen's vocabulary. This element draws neither.
  levels: [{ id: 'national', label: 'National', regions: [] }],
  disciplines: [
    { id: 'full-power', label: 'Full power', lifts: ['squat', 'bench', 'deadlift', 'total'] },
  ],
};

const meta: Meta<PtkTargetCategories> = {
  title: 'Platform Targets/Category selection',
  component: 'ptk-target-categories',
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'inline-radio',
      options: ['loading', 'ready', 'unavailable', 'failed'],
      description: 'Where the catalogue read has got to.',
    },
    catalog: { control: 'object' },
  },
  args: { status: 'ready', catalog: CATALOG },
  render: (args) => html`
    <ptk-target-categories .status=${args.status} .catalog=${args.catalog}></ptk-target-categories>
  `,
};

export default meta;

type Story = StoryObj<PtkTargetCategories>;

/**
 * Nothing answered. The weight class question is empty on purpose: it cannot be
 * asked until a sex category has been, and saying so is better than showing one
 * federation's ladder and hoping it is the right one.
 */
export const Unanswered: Story = {};

export const StillLoading: Story = {
  args: { status: 'loading', catalog: null },
};

/**
 * A federation with no published catalogue. Not an error -- the tool is meant to
 * gain federations over time, and telling a reader to reload a page that will
 * never load is worse than saying plainly that nothing is published yet.
 */
export const NotPublished: Story = {
  args: { status: 'unavailable', catalog: null },
};

export const ReadFailed: Story = {
  args: { status: 'failed', catalog: null },
};

/**
 * Two ladders claiming one sex category.
 *
 * Refused rather than resolved by document order. Showing the first would put a
 * plausible list of classes on screen that is wrong half the time, with nothing
 * to indicate it; saying none can be shown at least sends someone to look at the
 * published data.
 */
export const AmbiguousLadders: Story = {
  args: {
    catalog: {
      ...CATALOG,
      weightClassLadders: [
        ...CATALOG.weightClassLadders,
        {
          id: 'example-female-alternate',
          label: 'Female classes (alternate)',
          sex: 'female',
          classes: [{ id: 'f-57', label: '57 kg', maximumKilograms: 57 }],
        },
      ],
    },
  },
};

/**
 * A federation that publishes one ladder asks a question with one answer.
 *
 * The sex choices come from the ladders rather than from the schema's picklist,
 * so there is no option here that leads to an empty weight class question.
 */
export const SingleLadder: Story = {
  args: {
    catalog: {
      ...CATALOG,
      weightClassLadders: CATALOG.weightClassLadders.filter((ladder) => ladder.sex === 'female'),
    },
  },
};
