import type {
  CategoryCatalog,
  ClassificationBook,
  ClassificationTable,
  Lift,
} from '@platform-toolkit/data-contracts';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkPlatformTargets } from './ptk-platform-targets.js';
import './ptk-platform-targets.js';

/**
 * The whole tool, with both reads handed in rather than performed.
 *
 * The two halves are storied separately and this is not a third copy of them.
 * What it is for is the seam between them -- the questions produce a category,
 * the standards consume it -- and the states where the two reads disagree about
 * how far along they are. Those combinations are the ones nobody thinks to
 * check, because a working network produces them for about half a second each
 * and then never again.
 */

/** Invented figures throughout. Real boundaries belong in published data. */
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
};

function table(lift: Lift, third: number, second: number, first: number): ClassificationTable {
  return {
    id: `example-${lift}`,
    label: `Example ${lift}`,
    scope: {
      sex: 'female',
      lift,
      equipmentId: null,
      weightClassId: null,
      divisionId: null,
      tested: null,
    },
    standards: [
      { id: 'third', label: 'Class III', rank: 0, requiredKilograms: third },
      { id: 'second', label: 'Class II', rank: 1, requiredKilograms: second },
      { id: 'first', label: 'Class I', rank: 2, requiredKilograms: first },
    ],
  };
}

const BOOK: ClassificationBook = {
  id: 'example',
  label: 'Example Federation',
  tables: [
    table('squat', 100, 122.5, 145),
    table('bench', 55, 67.5, 80),
    table('deadlift', 120, 145, 170),
    table('total', 275, 335, 395),
  ],
};

const meta: Meta<PtkPlatformTargets> = {
  title: 'Platform Targets/Whole tool',
  component: 'ptk-platform-targets',
  tags: ['autodocs'],
  argTypes: {
    catalogStatus: {
      control: 'inline-radio',
      options: ['loading', 'ready', 'unavailable', 'failed'],
      description: 'Where the catalogue read has got to.',
    },
    standardsStatus: {
      control: 'inline-radio',
      options: ['idle', 'loading', 'ready', 'failed'],
      description: 'Where the read of this category’s standards has got to.',
    },
    catalog: { control: 'object' },
    book: { control: 'object' },
  },
  args: {
    catalog: CATALOG,
    catalogStatus: 'ready',
    book: BOOK,
    standardsStatus: 'ready',
  },
  render: (args) => html`
    <ptk-platform-targets
      .catalog=${args.catalog}
      .catalogStatus=${args.catalogStatus}
      .book=${args.book}
      .standardsStatus=${args.standardsStatus}
    ></ptk-platform-targets>
  `,
};

export default meta;

type Story = StoryObj<PtkPlatformTargets>;

/**
 * The screen a lifter arrives at. Answer the questions and the standards below
 * follow -- that is the whole interaction, and it is the only thing this element
 * contributes over its two children.
 */
export const Unanswered: Story = {};

/**
 * Both reads still going. The two halves say so separately rather than the page
 * showing one spinner, because they fail separately too.
 */
export const StillLoading: Story = {
  args: { catalog: null, catalogStatus: 'loading', book: null, standardsStatus: 'loading' },
};

/**
 * The state that actually occurs on every visit and lasts about a second: the
 * questions are answerable and the standards for the chosen category are not
 * there yet. A single page-level loading state would hide the half that works.
 */
export const StandardsStillLoading: Story = {
  args: { book: null, standardsStatus: 'loading' },
};

/**
 * The catalogue failed and the standards did not. Nothing can be asked, so the
 * panel below has nothing to be about -- but it must not claim the federation
 * publishes no standards, which is a statement about the data rather than about
 * a failed request.
 */
export const CatalogFailed: Story = {
  args: { catalog: null, catalogStatus: 'failed' },
};

/**
 * The reverse: the questions work, the standards read failed. Answering is still
 * worth doing, and a lifter who reloads gets the other half back.
 */
export const StandardsFailed: Story = {
  args: { book: null, standardsStatus: 'failed' },
};

/**
 * A federation with nothing published at all. Not an error: the tool is meant to
 * gain federations over time, and telling someone to reload a page that will
 * never load is worse than saying plainly that nothing is published yet.
 */
export const NothingPublished: Story = {
  args: { catalog: null, catalogStatus: 'unavailable', book: null, standardsStatus: 'ready' },
};

/**
 * A phone-width column, constrained by a wrapper rather than a viewport setting.
 * Both halves key their layout to their own width, so the wrapper is what they
 * respond to -- and it stands in for an embed column as well as a handset.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-platform-targets
        .catalog=${args.catalog}
        .catalogStatus=${args.catalogStatus}
        .book=${args.book}
        .standardsStatus=${args.standardsStatus}
      ></ptk-platform-targets>
    </div>
  `,
};
