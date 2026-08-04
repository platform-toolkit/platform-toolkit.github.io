// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §9.4's panel, in the states a lifter's own shelf actually puts it in.
 *
 * Every story is a history run through `calibrateFrom`, never a hand-written
 * `CalibrationReport`. A literal is free to hold a report the domain would never
 * produce -- a median with no observations behind it, an `established` grade off
 * one meet, a cluster of four misses out of three -- and those are exactly the
 * panels a reviewer would study, because they look wrong and are meant to.
 * `calibration-fixture.ts` is the one builder, shared with the browser tests for
 * the reason §13.7 gives.
 *
 * They are named after the lifter's record rather than after the screen, the way
 * §26's are: the question worth answering in review is whether this is an honest
 * reading of that shelf, and a name describing the pixels cannot be checked
 * against anything.
 *
 * WHY THE EMPTY PANEL IS A STORY AND NOT AN EDGE CASE
 *
 * It is the panel every lifter sees at their first meet, and the rule this
 * element exists for is that no section is dropped when it is empty. `NoHistory`
 * and `FiveComparableMeets` are the pair that shows a sentence appearing and
 * disappearing rather than a heading appearing over a blank. `NeverMissed` is the
 * subtler half of the same rule: the panel is *mostly* full and the three empty
 * rows in it are the ones that flatter, so an element that dropped them would
 * look finished.
 *
 * WHY NO PLAY FUNCTION
 *
 * Nothing on this panel can be pressed and it holds no draft -- it is plain
 * markup over a value `history.ts` and the domain decided. Anything that needed
 * a press would be a fact this panel computes, and it computes none.
 */
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import {
  aRecord,
  neverMissed,
  noHistory,
  oneMeet,
  withMeetsOutOfScope,
} from './calibration-fixture.js';
import type { PtkMeetCalibration } from './ptk-meet-calibration.js';
import './ptk-meet-calibration.js';

const meta: Meta<PtkMeetCalibration> = {
  title: 'Meet day/Meet calibration',
  component: 'ptk-meet-calibration',
  tags: ['autodocs'],
  args: { report: aRecord(), unit: 'kg' },
  render: (args) =>
    html`<ptk-meet-calibration .report=${args.report} .unit=${args.unit}></ptk-meet-calibration>`,
};

export default meta;

type Story = StoryObj<PtkMeetCalibration>;

/**
 * Five comparable meets, which is every figure at its strongest grade.
 *
 * The panel with nothing withheld, and the one to read first: two of the fifteen
 * rows are still empty, because this lifter has never missed a jump on the squat
 * or the deadlift. That is the shape of the whole design -- an empty row here is
 * a fact about the lifter, sitting in a list where the rows around it carry
 * figures, so it cannot be read as a number that failed to arrive.
 *
 * The bench is where the misses are, and the cluster sentence names it with both
 * counts rather than the multiple that found it.
 */
export const FiveComparableMeets: Story = {};

/**
 * One earlier meet, which is under §9.4's floor and still carries every figure.
 *
 * The judgement worth reviewing: the floor sentence is above the figures rather
 * than instead of them. Hiding a median that rests on one meet would leave a
 * lifter unable to see what the tool is counting, and this panel's whole claim is
 * that it shows its working -- so every figure is drawn, every one is graded "not
 * enough yet", and the sentence at the top says how many meets it would take.
 */
export const OneMeetSoFar: Story = {
  args: { report: oneMeet() },
};

/**
 * A lifter on their first day, with nothing behind them at all.
 *
 * Both headings are still on the panel, each over a sentence. The one that has to
 * be right is the cluster line: "No lift holds more of your misses than the
 * others" is true of somebody who has never lifted, and it is deliberately the
 * same sentence a lifter with five clean meets reads. A separate "you have missed
 * nothing" line would be a compliment on a panel with no business paying one.
 */
export const NoHistory: Story = {
  args: { report: noHistory() },
};

/**
 * The same five meets from a lifter who has never missed an attempt.
 *
 * Three rows go empty at once -- one missed jump per lift -- and the third
 * attempts read five of five. This is the flattering-empty case: a panel that
 * dropped an empty row would show a shorter, tidier list to the lifter with the
 * best record, and there would be nothing on screen to say a question had been
 * asked and not answered.
 */
export const NeverMissed: Story = {
  args: { report: neverMissed() },
};

/**
 * Five raw meets read and two under wraps left on the shelf.
 *
 * The line to check is the second one, and that it appears at all. Every figure
 * below it is identical to `FiveComparableMeets` -- the wrapped meets contributed
 * nothing -- so without the out-of-scope sentence this is a panel quietly
 * answering "your typical jump" from part of a lifter's record while looking
 * exactly like one that read all of it.
 */
export const SomeMeetsLeftOut: Story = {
  args: { report: withMeetsOutOfScope() },
};

/**
 * The same record for a lifter who set the tool to pounds.
 *
 * Unlike §26's page one screen up, everything here converts. Every weight on this
 * panel is a *difference* between two attempts rather than an attempt, so §16's
 * rule -- that a pound figure is read off the published chart, never computed --
 * does not reach it: no figure here is a weight anybody called to the table. The
 * two counts and the percentage are unaffected, which is the other half of what
 * this story documents.
 */
export const InPounds: Story = {
  args: { unit: 'lb' },
};

/**
 * The narrowest phone still in use (§5.7), constrained by a wrapper rather than
 * by a viewport setting -- the wrapper is what the element responds to, and a
 * viewport parameter would document a screen the component never sees.
 *
 * Fifteen rows of three lines each, which is why the label, the figure and its
 * evidence are stacked rather than paired across the row. Three of the five
 * labels are a short sentence ("Best lift against the maximum you planned"), and
 * a two-column layout at this width is a wrapped label beside a two-character
 * figure with nowhere to put the working underneath it.
 */
export const Narrow: Story = {
  args: { report: withMeetsOutOfScope() },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-meet-calibration .report=${args.report} .unit=${args.unit}></ptk-meet-calibration>
    </div>
  `,
};
