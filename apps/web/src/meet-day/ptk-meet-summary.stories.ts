// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §26's page, in the states a lifter would actually be handed one in.
 *
 * Every story is a meet walked through `applyMeetAction` and projected by
 * `summariseMeet`, never a hand-written `MeetSummary`. A literal is free to hold
 * a page the builder would never produce -- a total under a bomb-out, an attempt
 * carrying advice the undo history no longer holds, a lesson with no evidence
 * beside it -- and those are exactly the pages a reviewer would study, because
 * they look wrong and are meant to. `summary-fixture.ts` is the one builder,
 * shared with the browser tests and the unit suite for the reason §13.7 gives.
 *
 * They are named after the day rather than after the screen, the way §23.1's
 * sheet is: the question worth answering in review is whether this is the correct
 * summary of that meet, and a name describing the pixels cannot be checked
 * against anything.
 *
 * WHY THE EMPTY PAGE IS A STORY AND NOT AN EDGE CASE
 *
 * The rule this element exists for is that no section is ever dropped, and the
 * only way to review it is to look at the page where five of the eight have
 * nothing to say. Four of those five -- targets, notes, lessons, timing -- are
 * empty on a perfectly ordinary meet too, so `AnOrdinaryDay` and
 * `EverythingThePageCanHold` are the pair that shows a sentence appearing and
 * disappearing rather than a heading appearing over a blank.
 *
 * WHY NO PLAY FUNCTION
 *
 * Unlike §12's result card and the composite root, this element holds no draft
 * and nothing on it can be pressed: it is plain markup over a value somebody else
 * decided. So every state is reachable by assigning a property, which is what
 * these stories do. Anything that needed a press here would be a fact the page
 * computes, and this page computes nothing.
 */
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkMeetSummary } from './ptk-meet-summary.js';
import './ptk-meet-summary.js';
import { aFullPage, aGoodDay, bombedOnBench, summaryOf } from './summary-fixture.js';
import { EMPTY_SUMMARY } from './summary.js';

const meta: Meta<PtkMeetSummary> = {
  title: 'Meet day/Meet summary',
  component: 'ptk-meet-summary',
  tags: ['autodocs'],
  args: { summary: summaryOf(aGoodDay()), unit: 'kg' },
  render: (args) =>
    html`<ptk-meet-summary .summary=${args.summary} .unit=${args.unit}></ptk-meet-summary>`,
};

export default meta;

type Story = StoryObj<PtkMeetSummary>;

/**
 * Nine attempts, all of them made, at the weights the plan set out.
 *
 * The boring meet, and the one worth reviewing first: four of the eight sections
 * have nothing to say about it. No target was set, no note was written, the
 * referee lights were never entered, and nothing about the day fell into a shape
 * §26 has a name for -- so the page carries four sentences saying so rather than
 * four blanks. "That is an ordinary day, not a missing answer" is the whole
 * argument for this screen in one line.
 */
export const AnOrdinaryDay: Story = {};

/**
 * Three misses on the bench, which is the day the page is hardest to write.
 *
 * A bomb-out is the one state whose summary is a different *shape* rather than
 * different figures: there is no total, the total line has to say why without
 * pretending the squats and deadlifts did not happen, and the two lessons that
 * only a lost lift produces appear under a caveat saying one meet is one meet.
 * §9.4's floor is two meets, so nothing here tells the lifter what to do next --
 * every sentence is about the day that happened.
 */
export const NoTotalOnTheDay: Story = {
  args: { summary: summaryOf(bombedOnBench()) },
};

/**
 * The same day with a target on either side of it and a note under the opener.
 *
 * The control for the four empty sentences above: every section has content, so
 * a reviewer can see that the sentences are conditional rather than always
 * present. The two targets are deliberately unreachable and easily reached, which
 * is what puts a shortfall figure on one line and none on the other -- a target
 * that was met needs no number beside it.
 */
export const EverythingThePageCanHold: Story = {
  args: { summary: aFullPage() },
};

/**
 * No meet at all, which is what the property holds before one is summarised.
 *
 * Not a defensive default: a route paints this before a lifter has finished, and
 * every heading is still on the page over a sentence saying why it is empty. The
 * one section that vanishes is "Not on this page", and only because it is empty
 * -- today it never is, since the same two omissions are declared on every
 * summary the builder produces.
 */
export const BeforeThereIsAMeet: Story = {
  args: { summary: EMPTY_SUMMARY },
};

/**
 * The same ordinary day for a lifter who set the tool to pounds.
 *
 * §16 is the thing to check here, and it is a difference rather than a
 * conversion: the total follows the unit, and not one declared attempt does. An
 * attempt is a kilogram figure -- it is what went to the expeditor's table -- so
 * a page that converted the attempt rows would be printing a weight nobody
 * declared, beside a published pound reading off the federation's own chart.
 */
export const InPounds: Story = {
  args: { unit: 'lb' },
};

/**
 * The narrowest phone still in use (§5.7), constrained by a wrapper rather than
 * by a viewport setting -- the wrapper is what the element responds to, and a
 * viewport parameter would document a screen the component never sees.
 *
 * This is the longest page in the tool and the one most likely to be read on a
 * phone in a car park afterwards. The attempt rows are the tight part: up to nine
 * facts each, laid out one per line rather than as a table, because nine columns
 * at 320px is the sideways scroll §27 forbids -- and no more readable here just
 * because nobody is acting on it.
 */
export const Narrow: Story = {
  args: { summary: aFullPage() },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-meet-summary .summary=${args.summary} .unit=${args.unit}></ptk-meet-summary>
    </div>
  `,
};
