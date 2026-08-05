// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Four grades and the results under them, in the states that make the wording matter.
 *
 * Nothing on this element can be pressed: it is markup over a value somebody else
 * computed, so every state is reachable by assigning a property and none of these stories
 * needs a play function. What is worth reviewing is the *sentences* -- an ungraded lift
 * has five different reasons for being ungraded and each one gets its own, because
 * "no grade" over a lift the lifter definitely made is the fastest way to lose their
 * trust in the rest of the page.
 *
 * Every figure is invented (section 5.1).
 */
import { defineQualificationCheck } from '@platform-toolkit/qualification-check/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkStandingReport } from './ptk-standing-report.js';
import { VOCABULARY_FIXTURE, aReport, aStanding, entry } from './story.fixture.js';

// The registry is written once, explicitly. See the note in the composite root's stories.
defineQualificationCheck();

const meta: Meta<PtkStandingReport> = {
  title: 'Qualification check/Standing report',
  component: 'ptk-standing-report',
  tags: ['autodocs'],
  args: {
    standing: aStanding(),
    report: aReport(),
    vocabulary: VOCABULARY_FIXTURE,
    standardsStatus: 'ready',
  },
  render: (args) => html`
    <ptk-standing-report
      .standing=${args.standing}
      .report=${args.report}
      .vocabulary=${args.vocabulary}
      .standardsStatus=${args.standardsStatus}
    ></ptk-standing-report>
  `,
};

export default meta;

type Story = StoryObj<PtkStandingReport>;

/**
 * A full-power result read in the Open, which is the ordinary page.
 *
 * Three lifts and a total, each graded against the table the registration selects, each
 * naming the meet and the day it came from. The source line is not decoration: a grade
 * with no result behind it is a number the lifter cannot check, and the whole argument
 * for this screen is that they can.
 */
export const InTheOpen: Story = {};

/**
 * The same lifter, the same lifts, read in a Masters division.
 *
 * The pair to read beside {@link InTheOpen}, and the reason the registration is on the
 * page rather than implied. Nothing about the performance changed; the table did. The
 * fixture's two total tables are a rung apart at this total by construction, so the grade
 * visibly moves -- which is what a reader needs to understand before they trust either
 * page.
 */
export const InAMastersDivision: Story = {
  args: { report: aReport({ divisionId: 'master-1' }) },
};

/**
 * A bench-only meet, where two of the four lines have no grade and say why.
 *
 * The state this element exists for. "No successful squat inside these dates" is a
 * different sentence from "the federation publishes no squat standard for this category",
 * and both are different from a blank -- a reader who sees a blank assumes the tool
 * failed. Five reasons are modelled; this story shows the commonest.
 */
export const NotEveryLiftContested: Story = {
  args: (() => {
    // `null` and not `0`. A lift nobody contested is not a lift of nothing, and a zero
    // would put this lifter at the bottom of a ladder they were never on.
    const standing = aStanding([
      entry({ event: 'B', squatKg: null, deadliftKg: null, totalKg: null }),
    ]);
    return { standing, report: aReport({}, standing) };
  })(),
};

/**
 * Nothing read yet, which is what the property holds before a registration is settled.
 *
 * Not a defensive default. The composite root paints this element only once every axis is
 * answered, so a consumer wiring it directly will hold `null` first, and the honest render
 * of "no reading yet" is a sentence rather than an empty box with four headings over it.
 */
export const BeforeThereIsAReading: Story = {
  args: { standing: null, report: null },
};

/**
 * The standards are on their way, and the panel says so instead of guessing.
 *
 * The state a consumer reading one partition at a time is in for as long as the request
 * takes -- this federation publishes its ladders one artifact per sex and equipment
 * category, and each is the better part of a megabyte, so nobody holds all eight. With no
 * status the same empty table list renders as {@link NoStandardsForThisCategory}, which
 * tells a lifter something false about their federation in a sentence they would repeat
 * to a meet director.
 *
 * Everything the results themselves say stays on screen. Only the grades depend on a
 * table, so only the grades wait.
 */
export const StandardsStillArriving: Story = {
  args: { report: aReport({}, undefined, []), standardsStatus: 'loading' },
};

/**
 * The read failed, and the page owns it rather than reporting an absence.
 *
 * Marked as a fault and not as information, because reloading is a thing the reader can
 * usefully do about this one -- and because the alternative reading, that their category
 * has no published ladder, is a statement this tool has no evidence for.
 */
export const StandardsCouldNotBeRead: Story = {
  args: { report: aReport({}, undefined, []), standardsStatus: 'failed' },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than by
 * a viewport parameter.
 *
 * The grade rows are the tight part: a lift, a figure, a grade name and a source meet on
 * one line is four facts, and at 320 pixels with 200 % text they have to stack rather
 * than scroll sideways.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-standing-report
        .standing=${args.standing}
        .report=${args.report}
        .vocabulary=${args.vocabulary}
        .standardsStatus=${args.standardsStatus}
      ></ptk-standing-report>
    </div>
  `,
};
