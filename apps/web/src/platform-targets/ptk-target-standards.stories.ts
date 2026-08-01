import type {
  ClassificationBook,
  ClassificationTable,
  Lift,
} from '@platform-toolkit/data-contracts';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';
import { ref } from 'lit/directives/ref.js';

import { PtkTargetStandards } from './ptk-target-standards.js';
import type { CategorySelection } from './selection.js';

/**
 * What a lifter has lifted, read against their category's standards.
 *
 * The states worth looking at here are the ones the published data produces
 * rather than the ones a lifter does: a category the federation covers for the
 * total but not for the bench, two tables that are equally specific, a ladder
 * whose ranks contradict its weights. Each renders a different sentence, each is
 * one property away, and none of them is reachable by clicking around a working
 * page -- which is the whole reason the element takes its book as a property.
 */

/** Invented figures throughout. Real standards belong in published data. */
function table(lift: Lift, standards: ClassificationTable['standards']): ClassificationTable {
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
    standards,
  };
}

function ladder(third: number, second: number, first: number): ClassificationTable['standards'] {
  return [
    { id: 'third', label: 'Class III', rank: 0, requiredKilograms: third },
    { id: 'second', label: 'Class II', rank: 1, requiredKilograms: second },
    { id: 'first', label: 'Class I', rank: 2, requiredKilograms: first },
  ];
}

const BOOK: ClassificationBook = {
  id: 'example',
  label: 'Example Federation',
  tables: [
    table('squat', ladder(100, 122.5, 145)),
    table('bench', ladder(55, 67.5, 80)),
    table('deadlift', ladder(120, 145, 170)),
    table('total', ladder(275, 335, 395)),
  ],
};

/** A complete category. Incomplete is its own story, because it reads differently. */
const ANSWERED: CategorySelection = {
  sex: 'female',
  equipment: 'raw',
  weightClass: 'f-56',
  division: 'open',
  tested: 'tested',
};

/**
 * Types into the fields once they exist.
 *
 * What is in a field is this element's own state and there is no property for
 * it, deliberately -- §2.3 keeps a lifter's results out of anything that could
 * outlive the page, and a settable property is the first step toward a page that
 * stores them. So a story that wants the placed state has to arrive at it the
 * way a lifter does, by dispatching the same input event.
 *
 * Each of these is a module constant rather than a call in the template. A fresh
 * function per render makes Lit re-run the ref callback on every render; the
 * field's own guard makes that harmless, but a stable identity means it simply
 * does not happen.
 */
function typist(entries: Partial<Record<Lift, string>>): (element: Element | undefined) => void {
  return (element) => {
    if (!(element instanceof PtkTargetStandards)) {
      return;
    }
    const host = element;
    void host.updateComplete.then(() => {
      for (const [lift, value] of Object.entries(entries)) {
        const input = host.shadowRoot
          ?.querySelector(`ptk-number-field[data-lift="${lift}"]`)
          ?.shadowRoot?.querySelector('input');
        if (input instanceof HTMLInputElement) {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
      }
    });
  };
}

const TYPE_NOTHING = typist({});
const TYPE_A_FULL_MEET = typist({ squat: '130', bench: '72.5', deadlift: '160', total: '362.5' });
const TYPE_THREE_LIFTS = typist({ squat: '130', bench: '72.5', deadlift: '160' });
const TYPE_A_TYPO = typist({ squat: '1o5' });
const TYPE_UNDER_THE_LADDER = typist({ bench: '40' });

interface Args {
  readonly book: ClassificationBook | null;
  readonly status: PtkTargetStandards['status'];
  readonly selection: CategorySelection;
  readonly typing: (element: Element | undefined) => void;
}

const meta: Meta<Args> = {
  title: 'Platform Targets/Standards',
  component: 'ptk-target-standards',
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'inline-radio',
      options: ['idle', 'loading', 'ready', 'failed'],
      description: 'Where the read of this category’s standards has got to.',
    },
    book: { control: 'object' },
    selection: { control: 'object' },
    typing: { table: { disable: true } },
  },
  args: { status: 'ready', book: BOOK, selection: ANSWERED, typing: TYPE_NOTHING },
  render: (args) => html`
    <ptk-target-standards
      ${ref(args.typing)}
      .status=${args.status}
      .book=${args.book}
      .selection=${args.selection}
    ></ptk-target-standards>
  `,
};

export default meta;

type Story = StoryObj<Args>;

/**
 * Nothing entered yet. Each lift states the range it is published over, which is
 * the only useful thing to say before there is a number to place.
 */
export const Empty: Story = {};

export const Placed: Story = {
  args: { typing: TYPE_A_FULL_MEET },
};

/**
 * Three lifts and no total. The total is added up and the field says so, because
 * a sentence about 362.5 kg over an empty box reads as a bug.
 */
export const DerivedTotal: Story = {
  args: { typing: TYPE_THREE_LIFTS },
};

/**
 * A lift under the lowest published standard.
 *
 * Worth its own story: "below the first published standard" is a different
 * sentence from a classification, and it is the one a newer lifter sees.
 */
export const BelowTheLadder: Story = {
  args: { typing: TYPE_UNDER_THE_LADDER },
};

/**
 * A typo. The field keeps what was typed rather than blanking it, which is the
 * argument for `type="text"` over `type="number"` in one screenshot.
 */
export const Invalid: Story = {
  args: { typing: TYPE_A_TYPO },
};

/**
 * The questions above are half answered. Not an error and not empty: a category
 * is what chooses a table, so there is nothing to say until there is one.
 */
export const CategoryIncomplete: Story = {
  args: { selection: { ...ANSWERED, division: null, tested: null } },
};

export const StillLoading: Story = {
  args: { status: 'loading', book: null },
};

/**
 * A category the federation publishes no standards for. Real today for several
 * divisions, and not a failure -- a reload will not change it.
 */
export const NotPublished: Story = {
  args: { status: 'ready', book: null },
};

export const ReadFailed: Story = {
  args: { status: 'failed', book: null },
};

/**
 * Standards for two lifts and not the others, which is the ordinary shape of a
 * real federation's data rather than an edge case.
 */
export const PartlyPublished: Story = {
  args: {
    book: {
      ...BOOK,
      tables: BOOK.tables.filter((entry) => entry.scope.lift !== 'bench'),
    },
    typing: TYPE_A_FULL_MEET,
  },
};

/**
 * Two tables equally specific to this category.
 *
 * Refused rather than resolved by document order. Picking one would put a
 * plausible classification on screen that is wrong half the time, with nothing
 * to indicate it; saying it cannot be chosen sends someone to the data.
 */
export const Ambiguous: Story = {
  args: {
    book: {
      ...BOOK,
      tables: [
        ...BOOK.tables,
        { ...table('squat', ladder(105, 130, 155)), id: 'example-squat-alternate' },
      ],
    },
    typing: TYPE_A_FULL_MEET,
  },
};

/**
 * A published ladder that contradicts itself -- the ranks climb while the weights
 * fall. Caught by the smart constructor rather than rendered, because a ladder in
 * the wrong order places every lifter in the wrong class.
 */
export const Unreadable: Story = {
  args: {
    book: {
      ...BOOK,
      tables: [
        table('deadlift', [
          { id: 'third', label: 'Class III', rank: 0, requiredKilograms: 170 },
          { id: 'second', label: 'Class II', rank: 1, requiredKilograms: 145 },
          { id: 'first', label: 'Class I', rank: 2, requiredKilograms: 120 },
        ]),
        ...BOOK.tables.filter((entry) => entry.scope.lift !== 'deadlift'),
      ],
    },
    typing: TYPE_A_FULL_MEET,
  },
};

/**
 * A phone-width column, constrained by a wrapper rather than a viewport setting:
 * the element keys its layout to its own width, so the wrapper is the thing it
 * actually responds to and a viewport control would prove nothing about an embed.
 */
export const Narrow: Story = {
  args: { typing: TYPE_A_FULL_MEET },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-target-standards
        ${ref(args.typing)}
        .status=${args.status}
        .book=${args.book}
        .selection=${args.selection}
      ></ptk-target-standards>
    </div>
  `,
};
