// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkPlatformTargets } from './ptk-platform-targets.js';
import type { PartitionRead } from './ptk-target-report.js';
import {
  BOOK,
  CATALOG,
  CLASSIFICATIONS,
  NATIONAL,
  NORTH,
  STATE_BOOK,
} from '../core/records.fixture.js';
import { partitionKey } from '../core/selection.js';
import { definePlatformTargets } from '@platform-toolkit/platform-targets/element';

// Through the package entry and behind an explicit call, not a side-effecting relative
// import. A relative import here would load the source copy of every element and define
// seven tags a second time: the registry throws on the second write, the story still looks
// right because the first definition already won, and the only symptom is a console
// error -- which `smoke-stories.mjs` fails on, for exactly this reason.
definePlatformTargets();

/**
 * The whole tool, with all three reads handed in rather than performed.
 *
 * The three panels are storied separately and this is not a fourth copy of
 * them. What it is for is the seams between them -- the questions choose a
 * category, the report draws whatever has arrived for it, the lift entry marks
 * which rungs are behind -- and the states where the reads disagree about how
 * far along they are. Those are the combinations nobody thinks to check,
 * because a working network produces each of them for about half a second and
 * then never again.
 *
 * Answer sex, equipment, a weight class and drug-tested status and the report
 * appears; that is requirement 9, and it is the only thing this element
 * contributes over its three children.
 *
 * Every figure is invented (§5.1) and comes from the tool's one fixture.
 */

function reads(...entries: readonly PartitionRead[]): ReadonlyMap<string, PartitionRead> {
  return new Map(entries.map((entry) => [partitionKey(entry.partition), entry] as const));
}

const NATIONAL_READY: PartitionRead = { partition: NATIONAL, status: 'ready', book: BOOK };
const NORTH_READY: PartitionRead = { partition: NORTH, status: 'ready', book: STATE_BOOK };

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
    book: CLASSIFICATIONS,
    standardsStatus: 'ready',
    recordReads: reads(NATIONAL_READY, NORTH_READY),
  },
  render: (args) => html`
    <ptk-platform-targets
      .catalog=${args.catalog}
      .catalogStatus=${args.catalogStatus}
      .book=${args.book}
      .standardsStatus=${args.standardsStatus}
      .recordReads=${args.recordReads}
    ></ptk-platform-targets>
  `,
};

export default meta;

type Story = StoryObj<PtkPlatformTargets>;

/**
 * The screen a lifter arrives at. The report says what is still needed before it
 * can draw anything, and the lift entry is folded below it and out of the way.
 */
export const Unanswered: Story = {};

/**
 * Every read still going. The panels say so separately rather than the page
 * showing one spinner, because they fail separately too.
 */
export const StillLoading: Story = {
  args: {
    catalog: null,
    catalogStatus: 'loading',
    book: null,
    standardsStatus: 'loading',
    recordReads: reads(),
  },
};

/**
 * The state that occurs on every visit and lasts about a second: the questions
 * are answerable, and the standards for the chosen category are not there yet.
 * A single page-level loading state would hide the half that works.
 */
export const StandardsStillLoading: Story = {
  args: { book: null, standardsStatus: 'loading' },
};

/**
 * The catalogue failed and the standards did not. Nothing can be asked, so the
 * report has nothing to be about -- and it must not claim the federation
 * publishes nothing, which is a statement about the data rather than about a
 * failed request.
 */
export const CatalogFailed: Story = {
  args: { catalog: null, catalogStatus: 'failed' },
};

/**
 * The reverse: the questions work and the standards read failed. Answering is
 * still worth doing -- the records are unaffected and the report draws them --
 * and a reader who reloads gets the other half back.
 */
export const StandardsFailed: Story = {
  args: { book: null, standardsStatus: 'failed' },
};

/**
 * One record level failed while the other arrived. Named by level, above a
 * report that is otherwise complete: a missing state ladder is otherwise
 * indistinguishable from a federation that keeps no state records.
 */
export const OneRecordLevelFailed: Story = {
  args: {
    recordReads: reads(NATIONAL_READY, { partition: NORTH, status: 'failed', book: null }),
  },
};

/**
 * A federation with nothing published at all. Not an error: the tool is meant to
 * gain federations over time, and telling someone to reload a page that will
 * never load is worse than saying plainly that nothing is published yet.
 */
export const NothingPublished: Story = {
  args: {
    catalog: null,
    catalogStatus: 'unavailable',
    book: null,
    standardsStatus: 'ready',
    recordReads: reads(),
  },
};

/**
 * A phone-width column, constrained by a wrapper rather than a viewport setting.
 * Every panel keys its layout to its own width, so the wrapper is what they
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
        .recordReads=${args.recordReads}
      ></ptk-platform-targets>
    </div>
  `,
};
