// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Every result the reading is built from, imported and typed alike, and a way to remove
 * one.
 *
 * The point of this element is that it does not distinguish. A result the reader typed in
 * and a result that arrived from an archive import are the same kind of thing here and
 * are removable on the same terms -- because an import assists and never locks anybody in,
 * and a lifter who cannot delete a row somebody else's database is wrong about has been
 * handed a tool that argues with them.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not filter by the date window. Narrowing the dates changes what is *read*, not
 * what was entered, and a list that quietly shortened itself when a date changed would
 * look like the tool losing results.
 *
 * Every figure is invented (section 5.1).
 */
import { defineQualificationCheck } from '@platform-toolkit/qualification-check/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkResultLog } from './ptk-result-log.js';
import { aGearedMeet, entry } from './story.fixture.js';

// The registry is written once, explicitly. See the note in the composite root's stories.
defineQualificationCheck();

const meta: Meta<PtkResultLog> = {
  title: 'Qualification check/Result log',
  component: 'ptk-result-log',
  tags: ['autodocs'],
  args: { entries: [entry()] },
  render: (args) => html`<ptk-result-log .entries=${args.entries}></ptk-result-log>`,
};

export default meta;

type Story = StoryObj<PtkResultLog>;

/** One full-power meet, with everything the archive recorded about it on the row. */
export const OneResult: Story = {};

/**
 * Three meets across two registrations, which is the list a real lifter has.
 *
 * Raw at 94, single-ply at 112, and a bench-only meet with no total. The rows are
 * deliberately not sorted into groups: grouping them would be the log answering the
 * registration question, which belongs to the reader and to the screen below.
 */
export const SeveralMeets: Story = {
  args: {
    entries: [
      entry(),
      aGearedMeet(),
      entry({
        meetName: 'Invented Winter Bench',
        date: '2026-12-05',
        event: 'B',
        squatKg: null,
        deadliftKg: null,
        totalKg: null,
      }),
    ],
  },
};

/**
 * A disqualified total, which is a result and is not a total anybody qualifies on.
 *
 * The row is struck rather than dropped. Dropping it would leave a lifter looking for a
 * meet they definitely lifted at and finding nothing, and the tool would have made a
 * judgement about their record without saying so.
 */
export const ADisqualifiedResult: Story = {
  args: { entries: [entry(), entry({ meetName: 'Invented Summer Open', place: 'DQ' })] },
};

/**
 * Nothing entered yet, which is where the page opens.
 *
 * A sentence and no table. Column headings over an empty body is the render that reads as
 * a failed load.
 */
export const Empty: Story = {
  args: { entries: [] },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than by
 * a viewport parameter.
 *
 * The hardest row in the tool: up to eleven facts about one meet, laid out one per line
 * rather than as a table, because eleven columns at 320 pixels is the sideways scroll
 * section 27 forbids -- and no more readable here just because nobody is acting on it.
 */
export const Narrow: Story = {
  args: {
    entries: [entry(), aGearedMeet()],
  },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-result-log .entries=${args.entries}></ptk-result-log>
    </div>
  `,
};
