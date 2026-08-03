// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { Goal } from './goals.js';
import type { PtkTargetGoals } from './ptk-target-goals.js';
import './ptk-target-goals.js';
import { CATALOG, CLASSIFICATIONS } from './records-fixture.js';
import { NO_ENTRIES, typeLift } from './standards.js';

/**
 * What a lifter has committed to, and how far away it is.
 *
 * The tray is the second half of the review's goal flow: the report is where a
 * figure is chosen, this is where the choice is kept. It owns none of it -- the
 * list, the vocabulary and the entered lifts all arrive as properties -- so
 * every state below is reachable with no network, no storage and no report
 * above it, which is the whole reason the composition root holds the list.
 *
 * What to check while you are in here:
 *
 * - **The gap is arithmetic and nothing else.** Three figures and a
 *   subtraction, no bar, no percentage, no encouragement. A percentage reads as
 *   progress towards something and is wrong the moment two goals are in
 *   different lifts.
 * - **Nothing invents a gap.** Without a current best the row prints the goal
 *   and stops -- see `NoCurrentBest`, which is the state a tray spends most of
 *   its life in, since entering lifts is optional and stays optional.
 * - **A record goal names its attempt.** The record itself is not a goal;
 *   equalling it takes nothing. `RecordGoal` shows the chip target, which is one
 *   of two commitments at two different meets.
 * - **Every row's controls are named for the row.** P1's repeated-name finding
 *   lands hardest here: every goal carries a picker labelled "Label" and a
 *   button labelled "Remove", so a reader moving control by control hears the
 *   same two words however many goals are saved. Turn on a screen reader in
 *   `TwoGoals` and listen to the four controls.
 * - **"Reached" is a word, never a colour.** A colour alone is discarded under
 *   forced colours; check `Reached` with the high-contrast emulation on.
 *
 * Not storyable, and asserted in `ptk-target-goals.browser.test.ts` instead
 * (`renders nothing at all until something is saved`): the **empty tray**. It
 * renders `nothing` on purpose -- an empty "My goals" heading is a promise the
 * tool has not kept yet, occupying space under a report somebody is reading --
 * and `scripts/smoke-stories.mjs` fails any story that renders no text, so a
 * story of it could only exist by wrapping it in text that would then be the
 * thing the story documented (§5.10).
 *
 * Every figure below is invented (§5.1). Real ones live in published data.
 */

/**
 * A classification goal, as the report's standard panel builds one.
 *
 * Three axes empty rather than absent: a classification has no level, no region
 * and no event.
 */
const CLASS_GOAL: Goal = {
  lift: 'squat',
  kind: 'classification',
  kilograms: 150,
  standardId: 'first',
  weightClassId: 'f-56',
  divisionId: 'masters-1',
  levelId: '',
  regionId: '',
  disciplineId: '',
  attempt: 'none',
  tag: 'none',
};

/** A record goal on the subdivided level, so the region reaches the title. */
const RECORD_GOAL: Goal = {
  lift: 'bench',
  kind: 'record',
  kilograms: 130.5,
  standardId: '',
  weightClassId: 'f-56',
  divisionId: 'open',
  levelId: 'state',
  regionId: 'north-example',
  disciplineId: 'full-power',
  attempt: 'chip',
  tag: 'none',
};

const meta: Meta<PtkTargetGoals> = {
  title: 'Platform Targets/Goal tray',
  component: 'ptk-target-goals',
  tags: ['autodocs'],
  argTypes: {
    goals: { control: 'object' },
    entries: { control: 'object' },
    catalog: { control: 'object' },
    classifications: { control: 'object' },
  },
  args: {
    goals: [CLASS_GOAL],
    entries: NO_ENTRIES,
    catalog: CATALOG,
    classifications: CLASSIFICATIONS,
  },
  render: (args) => html`
    <ptk-target-goals
      .goals=${args.goals}
      .entries=${args.entries}
      .catalog=${args.catalog}
      .classifications=${args.classifications}
    ></ptk-target-goals>
  `,
};

export default meta;

type Story = StoryObj<PtkTargetGoals>;

/**
 * One commitment, and no figure to measure it against.
 *
 * The ordinary state, because the lift entry is optional and folded away below
 * the report. The row prints the goal alone and the secondary action offers the
 * only route to the missing half -- it opens the entry panel rather than
 * pulling a field up here, since there is one place in this tool where a lifter
 * says what they lift and a second would be a second answer.
 */
export const NoCurrentBest: Story = {};

/**
 * The same goal with a best entered: goal, best, gap, in that order.
 *
 * The subtraction happens in kilograms and only then converts. A gap worked out
 * in pounds and converted back lands between two legal loadings.
 */
export const WithCurrentBest: Story = {
  args: { entries: typeLift(NO_ENTRIES, 'squat', '140') },
};

/**
 * The goal met.
 *
 * "Reached", not "Beaten" and not a tick. The review allows a value to be
 * marked reached *only* once there is a current best to compare against, which
 * is exactly this state, and forbids the judgement that would otherwise attach
 * to it.
 */
export const Reached: Story = {
  args: { entries: typeLift(NO_ENTRIES, 'squat', '150') },
};

/**
 * A record goal, which carries which attempt it is for.
 *
 * The record itself is not a goal -- equalling it takes nothing -- so the row
 * names the chip target beside the title. The other attempt is a different
 * commitment at a different meet and would be a separate row.
 */
export const RecordGoal: Story = {
  args: { goals: [RECORD_GOAL] },
};

/**
 * Two goals in two lifts, one of which has a figure and one of which does not.
 *
 * The state the secondary action's condition turns on: it is still offered,
 * because one saved goal is still missing its half. Offering it only when
 * *every* goal is blank would hide it from the lifter most likely to want it.
 */
export const TwoGoals: Story = {
  args: {
    goals: [CLASS_GOAL, RECORD_GOAL],
    entries: typeLift(NO_ENTRIES, 'squat', '140'),
  },
};

/**
 * A goal filed under a horizon.
 *
 * The picker holds the stored value; clearing it back to the placeholder is how
 * a label is removed, which is why "No label" is the placeholder rather than an
 * option beside the other three. Two ways of saying the same thing in one
 * picker would leave the control answering itself differently depending on how
 * it was cleared.
 */
export const Labelled: Story = {
  args: {
    goals: [
      { ...CLASS_GOAL, tag: 'next-meet' },
      { ...RECORD_GOAL, tag: 'long-term' },
    ],
  },
};

/**
 * The vocabulary has not arrived -- a first paint, or a read that failed.
 *
 * Names are resolved at render time and never stored as a sentence: a stored
 * caption asserts last month's number under this month's heading. What will not
 * resolve is left out rather than printed as a slug. A tray reading "f-56" has
 * shown a lifter an internal identifier, so the row falls back to what it can
 * still say truthfully and the weight is unaffected either way.
 */
export const VocabularyMissing: Story = {
  args: { goals: [CLASS_GOAL, RECORD_GOAL], catalog: null, classifications: null },
};

/**
 * A phone-width column, constrained by a wrapper rather than a viewport
 * setting, because the wrapper is the constraint the element responds to -- and
 * it stands in for a narrow embed column as well as a handset.
 *
 * Two things to look at: the picker and the Remove button stack instead of
 * sharing a line, and the arithmetic wraps without either figure leaving the
 * column. Both controls must still clear the 48 px gym floor.
 */
export const Narrow: Story = {
  args: {
    goals: [CLASS_GOAL, RECORD_GOAL],
    entries: typeLift(NO_ENTRIES, 'squat', '140'),
  },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-target-goals
        .goals=${args.goals}
        .entries=${args.entries}
        .catalog=${args.catalog}
        .classifications=${args.classifications}
      ></ptk-target-goals>
    </div>
  `,
};
