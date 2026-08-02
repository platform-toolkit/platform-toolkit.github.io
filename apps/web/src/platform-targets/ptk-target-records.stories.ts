import type { CategoryCatalog, Lift, RecordBook } from '@platform-toolkit/data-contracts';
import type { WeightUnit } from '@platform-toolkit/domain';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';
import { ref } from 'lit/directives/ref.js';

import { PtkTargetRecords } from './ptk-target-records.js';
import type { RecordScopeField } from './record-scope.js';
import { ANSWERED, BOOK, CATALOG, bookOf, record } from './records-fixture.js';
import type { CategorySelection } from './selection.js';
import { LIFTS, NO_ENTRIES, setEntryUnit, typeLift, type LiftEntries } from './standards.js';

/**
 * The records that stand in a lifter's category, and how far away they are.
 *
 * The states worth looking at are the ones the published data produces rather
 * than the ones a lifter clicks into: a category the federation keeps no record
 * in, two records published for one category, a record whose holder was never
 * recorded. Each renders a different sentence, each is one property away, and
 * none of them is reachable by clicking around a working page -- which is why
 * the element takes its book as a property.
 *
 * The fixture is shared with the tests (`records-fixture.ts`) so a state
 * asserted there and a state looked at here cannot drift apart.
 */

/**
 * Answers the level, region and event questions once they exist.
 *
 * There is no property for them, deliberately: they are this element's own
 * questions (see its header), so a story that wants a card on screen has to
 * arrive there the way a lifter does. Each is a module constant rather than a
 * call in the template -- a fresh function per render makes Lit re-run the ref
 * callback every time, and a stable identity means it simply does not.
 */
function chooser(
  answers: readonly (readonly [RecordScopeField, string])[],
): (element: Element | undefined) => void {
  return (element) => {
    if (!(element instanceof PtkTargetRecords)) {
      return;
    }
    const host = element;
    void (async () => {
      await host.updateComplete;
      // One at a time, awaiting between. Choosing a level re-renders the
      // questions -- that is how the region question appears at all -- so a
      // region answered against the previous render presses a radio the next
      // render replaces.
      for (const [field, value] of answers) {
        press(host, field, value);
        await host.updateComplete;
      }
    })();
  };
}

/** Presses one radio. By `.value`, which is a property here and not an attribute. */
function press(host: PtkTargetRecords, field: RecordScopeField, value: string): void {
  const radios =
    host.shadowRoot
      ?.querySelector(`ptk-choice-group[data-record-field="${field}"]`)
      ?.shadowRoot?.querySelectorAll('input[type="radio"]') ?? [];
  for (const radio of radios) {
    if (radio instanceof HTMLInputElement && radio.value === value) {
      radio.click();
    }
  }
}

const ANSWER_NOTHING = chooser([]);
const ANSWER_NATIONAL = chooser([
  ['level', 'national'],
  ['discipline', 'full-power'],
]);
const ANSWER_A_STATE = chooser([
  ['level', 'state'],
  ['region', 'south-example'],
  ['discipline', 'full-power'],
]);
const ANSWER_BENCH_ONLY = chooser([
  ['level', 'national'],
  ['discipline', 'bench-only'],
]);

/** Lifts as though somebody typed them, through the same mapper the panel above uses. */
function lifted(typed: Partial<Record<Lift, string>>, unit: WeightUnit = 'kg'): LiftEntries {
  let entries = setEntryUnit(NO_ENTRIES, unit);
  for (const lift of LIFTS) {
    const text = typed[lift];
    if (text !== undefined) {
      entries = typeLift(entries, lift, text);
    }
  }
  return entries;
}

interface Args {
  readonly catalog: CategoryCatalog | null;
  readonly book: RecordBook | null;
  readonly status: PtkTargetRecords['status'];
  readonly selection: CategorySelection;
  readonly entries: LiftEntries;
  readonly answering: (element: Element | undefined) => void;
}

const meta: Meta<Args> = {
  title: 'Platform Targets/Records',
  component: 'ptk-target-records',
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'inline-radio',
      options: ['idle', 'loading', 'ready', 'failed'],
      description: 'Where the read of this partition’s records has got to.',
    },
    catalog: { control: 'object' },
    book: { control: 'object' },
    selection: { control: 'object' },
    entries: { table: { disable: true } },
    answering: { table: { disable: true } },
  },
  args: {
    status: 'ready',
    catalog: CATALOG,
    book: BOOK,
    selection: ANSWERED,
    entries: NO_ENTRIES,
    answering: ANSWER_NATIONAL,
  },
  render: (args) => html`
    <ptk-target-records
      ${ref(args.answering)}
      .status=${args.status}
      .catalog=${args.catalog}
      .book=${args.book}
      .selection=${args.selection}
      .entries=${args.entries}
    ></ptk-target-records>
  `,
};

export default meta;

type Story = StoryObj<Args>;

/**
 * Nothing typed above. Each card states what it would take to replace the
 * record, which is the only useful thing to say before there is a lift to
 * measure -- and the fourth says nobody has set one.
 */
export const Standing: Story = {};

/**
 * The questions unanswered, which is where every visit starts. No cards at all:
 * the event decides which lifts even hold records, so there is nothing honest to
 * draw one for yet.
 */
export const NothingChosen: Story = {
  args: { answering: ANSWER_NOTHING },
};

/**
 * A subdivided level. The region question exists only under "State" -- there is
 * one national record, and an empty "Region" under it would read as missing data
 * where it is the complete and correct state.
 */
export const StateRecords: Story = {
  args: { answering: ANSWER_A_STATE, book: null },
};

/**
 * One event, one card. A bench-only meet contests one lift, and four cards with
 * three of them irrelevant is the version that looks finished and is wrong.
 */
export const OneLiftEvent: Story = {
  args: { answering: ANSWER_BENCH_ONLY },
};

/**
 * Three lifts entered above, measured against the records.
 *
 * The squat is short, the bench clears, and the total is derived from the three
 * -- which the card says, because a figure the lifter did not type needs to
 * account for itself.
 */
export const Measured: Story = {
  args: { entries: lifted({ squat: '140', bench: '85', deadlift: '170' }) },
};

/**
 * A lift heavy enough to replace the record.
 *
 * The sentence stays conditional. This tool does not adjudicate a lift, and "you
 * have broken this record" claims an authority it does not have -- the record
 * stands until a meet is held under the federation's own officials.
 */
export const WouldReplace: Story = {
  args: { entries: lifted({ squat: '150' }) },
};

/**
 * The same screen for a lifter working in pounds. Every figure is converted; the
 * federation publishes kilograms and the records themselves do not move.
 */
export const InPounds: Story = {
  args: { entries: lifted({ squat: '310' }, 'lb') },
};

/**
 * The category questions above are half answered. Not an error and not empty: a
 * record matches exactly on every axis, so an unanswered one selects nothing
 * rather than something broader.
 */
export const CategoryIncomplete: Story = {
  args: { selection: { ...ANSWERED, division: null, tested: null } },
};

export const StillLoading: Story = {
  args: { status: 'loading', book: null },
};

/**
 * A partition the federation publishes no records for. Not a failure -- a reload
 * will not change it -- and every card says what it would take to set the first.
 */
export const NoneStanding: Story = {
  args: { status: 'ready', book: null },
};

export const ReadFailed: Story = {
  args: { status: 'failed', book: null },
};

/**
 * A record whose holder the source never named. All three of holder, date and
 * meet are nullable in the contract and any of them can be missing for a real
 * record, so the line is assembled from what is there rather than printed with
 * gaps.
 */
export const HolderNotPublished: Story = {
  args: {
    book: bookOf([
      record('squat', { kilograms: 145, holderName: null, achievedOn: null, meetName: null }),
      record('bench', { kilograms: 82.5, holderName: null }),
    ]),
  },
};

/**
 * A record the federation seeded and nobody has taken yet.
 *
 * On the real corpus this is a tenth of every row: founding a record book means
 * putting a bar in every category so the first lifter in it has something to
 * beat. The card says so in its own line rather than leaving the holder blank,
 * because a blank is how "the source did not publish a name" looks — the same
 * screen for the opposite situation, and the less useful of the two.
 */
export const Unclaimed: Story = {
  args: {
    book: bookOf([
      record('squat', { kilograms: 145, unclaimed: true }),
      record('bench', { kilograms: 82.5 }),
    ]),
  },
};

/**
 * Two records published for one category.
 *
 * Refused rather than resolved by document order. Both cannot be current, and
 * showing the first is a plausible figure that is wrong half the time with
 * nothing on screen to indicate it.
 */
export const Ambiguous: Story = {
  args: {
    book: bookOf([
      record('squat', { kilograms: 145 }),
      record('squat', { kilograms: 150 }),
      record('bench', { kilograms: 82.5 }),
    ]),
  },
};

/**
 * The categories have not loaded. Said once here rather than repeating the
 * catalogue's own loading, failed and not-published sentences, which the panel
 * above already has on screen.
 */
export const NoCatalog: Story = {
  args: { catalog: null, book: null, status: 'idle' },
};

/**
 * A phone-width column, constrained by a wrapper rather than a viewport setting:
 * the element keys its layout to its own width, so the wrapper is what it
 * actually responds to and a viewport control would prove nothing about an
 * embed. Five things to say about a record and 320 pixels to say them in is the
 * reason these are cards and not a table.
 */
export const Narrow: Story = {
  args: { entries: lifted({ squat: '140', bench: '85', deadlift: '170' }) },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-target-records
        ${ref(args.answering)}
        .status=${args.status}
        .catalog=${args.catalog}
        .book=${args.book}
        .selection=${args.selection}
        .entries=${args.entries}
      ></ptk-target-records>
    </div>
  `,
};
