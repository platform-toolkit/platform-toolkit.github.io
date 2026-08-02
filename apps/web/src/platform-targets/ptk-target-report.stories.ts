import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PartitionRead, PtkTargetReport } from './ptk-target-report.js';
import './ptk-target-report.js';
import {
  ANSWERED,
  BOOK,
  CATALOG,
  CLASSIFICATIONS,
  FULLY_ANSWERED,
  NATIONAL,
  NORTH,
  STATE_BOOK,
} from './records-fixture.js';
import { NO_SELECTION, partitionKey } from './selection.js';
import { NO_ENTRIES, typeLift } from './standards.js';

/**
 * The report, with every read handed in rather than performed.
 *
 * This is the element the tool exists for, and it is also the one with the most
 * states nobody sees on a working connection. Classifications and each record
 * partition settle independently, so on any real visit there is a second where
 * the ladders are drawn and the records are not, and a moment where one level
 * has arrived and another has failed. Those are the states worth looking at:
 * the finished report is the one a screenshot already tells you about.
 *
 * Every figure below is invented (§5.1). Real ones live in published data.
 */

/** The read map the element takes, keyed the way the element looks entries up. */
function reads(...entries: readonly PartitionRead[]): ReadonlyMap<string, PartitionRead> {
  return new Map(entries.map((entry) => [partitionKey(entry.partition), entry] as const));
}

const NATIONAL_READY: PartitionRead = { partition: NATIONAL, status: 'ready', book: BOOK };
const NORTH_READY: PartitionRead = { partition: NORTH, status: 'ready', book: STATE_BOOK };

const meta: Meta<PtkTargetReport> = {
  title: 'Platform Targets/Report',
  component: 'ptk-target-report',
  tags: ['autodocs'],
  argTypes: {
    classificationsStatus: {
      control: 'inline-radio',
      options: ['idle', 'loading', 'ready', 'failed'],
      description: 'Where the read of this category’s standards has got to.',
    },
    catalog: { control: 'object' },
    selection: { control: 'object' },
    classifications: { control: 'object' },
  },
  args: {
    catalog: CATALOG,
    selection: ANSWERED,
    classifications: CLASSIFICATIONS,
    classificationsStatus: 'ready',
    recordReads: reads(NATIONAL_READY),
    entries: NO_ENTRIES,
  },
  render: (args) => html`
    <ptk-target-report
      .catalog=${args.catalog}
      .selection=${args.selection}
      .classifications=${args.classifications}
      .classificationsStatus=${args.classificationsStatus}
      .recordReads=${args.recordReads}
      .entries=${args.entries}
    ></ptk-target-report>
  `,
};

export default meta;

type Story = StoryObj<PtkTargetReport>;

/**
 * The narrowest report the tool will draw: one weight class, Open only, one
 * level of record. Requirement 9 -- sex, equipment, one weight class and
 * drug-tested status are enough, and nothing else blocks it.
 */
export const OneClassOpenOnly: Story = {};

/**
 * Everything answered: two weight classes to compare (requirement 8), a masters
 * division beside Open (requirement 2), and both levels of record at once
 * (requirement 3). This is the widest arrangement the element has to lay out,
 * and the one where the column grid earns its keep.
 */
export const EverythingAnswered: Story = {
  args: {
    selection: FULLY_ANSWERED,
    recordReads: reads(NORTH_READY, NATIONAL_READY),
  },
};

/**
 * Not enough answered yet. It names what is missing rather than showing an empty
 * frame, because an empty report and a report about nothing look identical.
 */
export const NotEnoughAnswered: Story = {
  args: { selection: NO_SELECTION },
};

/**
 * The state every visit passes through: the questions are answered and the
 * standards have not landed. The records that *have* landed are drawn anyway --
 * a report that waited for the last read would be blank for the whole time a
 * phone on gym signal is doing the work.
 */
export const StandardsStillLoading: Story = {
  args: { classifications: null, classificationsStatus: 'loading' },
};

export const StandardsFailed: Story = {
  args: { classifications: null, classificationsStatus: 'failed' },
};

/** The mirror: the ladders are drawn and the records are still in flight. */
export const RecordsStillLoading: Story = {
  args: {
    selection: FULLY_ANSWERED,
    recordReads: reads({ partition: NORTH, status: 'loading', book: null }, NATIONAL_READY),
  },
};

/**
 * One level failed and the other did not.
 *
 * The reason the reads are separate. Collapsing them would make a failed state
 * read look like a federation that keeps no state records, which is a real
 * answer nobody investigates -- so the failure is named, by level, above a
 * report that is otherwise complete.
 */
export const OnePartitionFailed: Story = {
  args: {
    selection: FULLY_ANSWERED,
    recordReads: reads({ partition: NORTH, status: 'failed', book: null }, NATIONAL_READY),
  },
};

/**
 * Both reads succeeded and the federation publishes neither standards nor
 * records for this category. Not an error, and offered no reload: the read
 * worked, and the honest thing to say is that there is nothing here.
 */
export const NothingPublished: Story = {
  args: {
    classifications: null,
    classificationsStatus: 'ready',
    recordReads: reads({ partition: NATIONAL, status: 'ready', book: null }),
  },
};

/**
 * With lifts entered. The rungs already passed are dimmed and struck from the
 * running, the next one is flagged, and nothing is removed -- a ladder that
 * shortened as figures were typed would move the next row up under a thumb
 * already travelling, and hide what the lifter has already got.
 */
export const WithLiftsEntered: Story = {
  args: {
    entries: typeLift(typeLift(NO_ENTRIES, 'squat', '125'), 'bench', '70'),
  },
};

/**
 * A phone-width column, constrained by a wrapper rather than a viewport setting.
 * The column grid keys off this element's own width, so the wrapper is what it
 * responds to -- and it stands in for a narrow embed column as well as a handset.
 */
export const Narrow: Story = {
  args: {
    selection: FULLY_ANSWERED,
    recordReads: reads(NORTH_READY, NATIONAL_READY),
  },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-target-report
        .catalog=${args.catalog}
        .selection=${args.selection}
        .classifications=${args.classifications}
        .classificationsStatus=${args.classificationsStatus}
        .recordReads=${args.recordReads}
        .entries=${args.entries}
      ></ptk-target-report>
    </div>
  `,
};
