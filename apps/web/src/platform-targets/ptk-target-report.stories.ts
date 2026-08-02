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
  bookOf,
  record,
} from './records-fixture.js';
import { NO_SELECTION, partitionKey } from './selection.js';
import { NO_ENTRIES, typeLift } from './standards.js';

/**
 * The report, with every read handed in rather than performed.
 *
 * This is the element the tool exists for, and it is also the one with the most
 * states nobody sees on a working connection. Classifications and each record
 * partition settle independently, so on any real visit there is a second where
 * the standards are drawn and the records are not, and a moment where one level
 * has arrived and another has failed. Those are the states worth looking at:
 * the finished report is the one a screenshot already tells you about.
 *
 * The unit of presentation is one lift, one target type, one compact matrix at a
 * time -- age division and Open together, one or two weight classes together,
 * the exact number first. Two bars above the matrices decide the first two. The
 * element owns which bar is where, so the stories that need the records half
 * seed it through `initialTargetType`; that seed is read once and the bars take
 * over, exactly as they do for a visitor.
 *
 * Not storyable, and asserted in `ptk-target-report.browser.test.ts` instead: an
 * **open record detail**. Which record is open is internal state with no seed,
 * deliberately -- a detail belongs to a cell in a matrix that only exists once
 * the reads have settled, so a property naming one would be a property whose
 * valid values the caller cannot know.
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
    initialLift: {
      control: 'inline-radio',
      options: ['squat', 'bench', 'deadlift', 'total'],
      description: 'Which lift a fresh report opens on. Read once; the bar decides after that.',
    },
    initialTargetType: {
      control: 'inline-radio',
      options: ['classifications', 'records'],
      description: 'Which half of the report opens. Read once; the bar decides after that.',
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
    initialLift: 'squat',
    initialTargetType: 'classifications',
  },
  render: (args) => html`
    <ptk-target-report
      .catalog=${args.catalog}
      .selection=${args.selection}
      .classifications=${args.classifications}
      .classificationsStatus=${args.classificationsStatus}
      .recordReads=${args.recordReads}
      .entries=${args.entries}
      .initialLift=${args.initialLift}
      .initialTargetType=${args.initialTargetType}
    ></ptk-target-report>
  `,
};

export default meta;

type Story = StoryObj<PtkTargetReport>;

/**
 * The narrowest report the tool will draw: one weight class, Open only, one
 * level of record. Requirement 9 -- sex, equipment, one weight class and
 * drug-tested status are enough, and nothing else blocks it.
 *
 * One class means one column and no second one held empty. A reserved or
 * disabled comparison column would read as a class the federation publishes
 * nothing for rather than as a question nobody asked.
 */
export const OneClassOpenOnly: Story = {};

/**
 * Everything answered: two weight classes to compare (requirement 8), a masters
 * division beside Open (requirement 2), and both levels of record at once
 * (requirement 3). This is the widest arrangement the element has to lay out,
 * and the one the matrix exists for -- the two classes are adjacent columns and
 * the two divisions adjacent rows, so both comparisons are a glance rather than
 * a scroll between two separate lists.
 */
export const EverythingAnswered: Story = {
  args: {
    selection: FULLY_ANSWERED,
    recordReads: reads(NORTH_READY, NATIONAL_READY),
  },
};

/**
 * The records half, which is where the redesign is most visible.
 *
 * The cell holds the **current record** and nothing else. The two weights that
 * take it -- the chip target and the full increment -- are behind the record a
 * lifter taps, and the rule that decides between them is explained once, above
 * the matrices, in a note and a fold. The audited version of this screen printed
 * two long rule sentences under each of seventy records.
 */
export const Records: Story = {
  args: {
    initialTargetType: 'records',
    selection: FULLY_ANSWERED,
    recordReads: reads(NORTH_READY, NATIONAL_READY),
  },
};

/**
 * A lift the federation publishes no record for, on a report that has plenty for
 * the others.
 *
 * The bar keeps all four lifts. A tab set that shortened as reads settled would
 * move a control under a thumb already travelling, and a lifter who could not
 * find the deadlift tab would conclude the tool was broken rather than that
 * nobody has set this record yet -- which is the sentence the panel says
 * instead, and it is an invitation.
 */
export const LiftWithNoRecord: Story = {
  args: {
    initialLift: 'deadlift',
    initialTargetType: 'records',
    recordReads: reads(NATIONAL_READY),
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

/** The mirror: the standards are drawn and the records are still in flight. */
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
 * Two records published for one category, which cannot both be current.
 *
 * Reported, never resolved by document order -- showing the first is a plausible
 * figure that is wrong half the time with nothing on screen to indicate it. The
 * matrix is withheld and the sentence names the scope, so a reader can see
 * exactly which cell the tool declines to fill.
 */
export const ConflictingRecords: Story = {
  args: {
    initialTargetType: 'records',
    classifications: null,
    recordReads: reads({
      partition: NATIONAL,
      status: 'ready',
      book: bookOf([record('squat', { kilograms: 145 }), record('squat', { kilograms: 150 })]),
    }),
  },
};

/**
 * With lifts entered. The figures already passed are dimmed and flagged
 * `Reached`, the first one ahead is flagged `Next`, and nothing is removed -- a
 * matrix that shortened as figures were typed would move the next row up under a
 * thumb already travelling, and hide what the lifter has already got.
 *
 * The flag is a word. Dimming alone is discarded under forced colours and is not
 * a distinction a reader who cannot separate the tones can make.
 */
export const WithLiftsEntered: Story = {
  args: {
    entries: typeLift(typeLift(NO_ENTRIES, 'squat', '125'), 'bench', '70'),
  },
};

/**
 * The federation's own two columns disagreeing about one record.
 *
 * Each record is published twice on one row, in kilograms and in pounds, and on
 * a corpus of six figures the two sometimes cannot both be right. Kilograms
 * govern -- the cell and both attempt weights come from the kilogram figure, and
 * nothing here re-enters the arithmetic -- so the detail prints both numbers and
 * says which one it used, rather than picking one silently or withholding a real
 * record over a contradiction the lifter can settle by following the link.
 *
 * Storied because it is the only place in the tool where a lifter is told not to
 * trust a figure, it appears on a few hundred rows out of a hundred and thirty
 * thousand, and nobody will meet it by clicking around. The caution itself is
 * inside the record detail, so this story shows the matrix it is reachable from;
 * the browser suite opens it.
 */
export const SourceContradictsItself: Story = {
  args: {
    initialTargetType: 'records',
    recordReads: reads({
      partition: NATIONAL,
      status: 'ready',
      // A decimal point one place left in the pound cell, which is what most of
      // the real disagreements look like. Invented figures (§5.1).
      book: bookOf([
        record('squat', {
          kilograms: 145,
          sourceDisagreement: { pounds: 32, impliedKilograms: 14.51 },
        }),
        record('bench', { kilograms: 82.5 }),
      ]),
    }),
  },
};

/**
 * A phone-width column, constrained by a wrapper rather than a viewport setting.
 * The matrices key off this element's own width, so the wrapper is what they
 * respond to -- and it stands in for a narrow embed column as well as a handset.
 *
 * This is the canonical width, not the degraded one. Two classes, two divisions
 * and two record levels at 320 px is the widest the report gets in the narrowest
 * column it has to fit, and the answer has to be a wrapped figure rather than a
 * sideways scroll.
 */
export const Narrow: Story = {
  args: {
    initialTargetType: 'records',
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
        .initialLift=${args.initialLift}
        .initialTargetType=${args.initialTargetType}
      ></ptk-target-report>
    </div>
  `,
};
