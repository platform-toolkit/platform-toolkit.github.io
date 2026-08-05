// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §19's screen, in the states a record attempt actually puts it in.
 *
 * Every story is a `MeetRecordState` built by the writers in `records.ts`, never
 * a literal, and the same fixture drives the browser tests -- `records-fixture.ts`
 * holds both rules and the reasons for them. Named after the situation rather
 * than after the pixels, per §20's story set: the question worth answering in
 * review is whether this is an honest reading of that moment, and a name
 * describing the layout cannot be checked against anything.
 *
 * WHY MOST OF THESE ARE THE SAME RECORD
 *
 * Seven of the nine stories below are 200 kg on the squat, and the differences
 * between them are one control each. That is deliberate: what this element is
 * for is showing that two attempts take the same record at two different
 * weights, and a story set that varied the record as well would let a reviewer
 * attribute a changed figure to the record rather than to the rule that moved
 * it. The two total-record stories are the exception because a total is the one
 * subject that changes the shape of the screen and not just its numbers.
 *
 * WHY THERE IS NO PLAY FUNCTION
 *
 * §20's reason, unchanged. This element owns nothing -- every answer arrives as
 * `state` and every change leaves as an event -- so every screen below is
 * reachable by setting two properties, which is also what lets the same element
 * serve the planning screen and one lifter open on the coach board.
 */
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkMeetRecord } from './ptk-meet-record.js';
import {
  aFigureThatWillNotRead,
  aRecordAtThisLevel,
  aRecordFromASmallerMeet,
  aRelationNobodyAnswered,
  aTotalRecord,
  aTotalRecordWithNothingBanked,
  afterAGoodThird,
  afterAMissedThird,
  anUnclaimedRecord,
  nothingTyped,
  onTheDeadlift,
  onTheSquat,
} from './records-fixture.js';
import './ptk-meet-record.js';

const meta: Meta<PtkMeetRecord> = {
  title: 'Meet day/Meet record',
  component: 'ptk-meet-record',
  tags: ['autodocs'],
  args: { state: aRecordAtThisLevel(), subject: 'squat', attempt: onTheSquat() },
  render: (args) =>
    html`<ptk-meet-record
      .state=${args.state}
      .subject=${args.subject}
      .attempt=${args.attempt}
    ></ptk-meet-record>`,
};

export default meta;

type Story = StoryObj<PtkMeetRecord>;

/**
 * The Thursday before the meet, with the record typed in and the level answered.
 *
 * The screen to read first, and the one that makes the element's whole argument:
 * one record, two headings, two different weights. The competition route is open
 * because nothing has been lifted; the fourth attempt is shut because there is no
 * third attempt for it to follow, and it keeps its heading while it says so.
 */
export const ARecordAtThisLevel: Story = {};

/**
 * No record typed in, which is how every lifter arrives here.
 *
 * There is nothing to plan and the screen says which box to fill in, but the
 * sentence §29 requires is on screen anyway. That is the judgement worth
 * reviewing: a disclaimer that appears only once there are figures to disclaim is
 * one a lifter meets for the first time at the moment they most want the number.
 */
export const NothingTyped: Story = {
  args: { state: nothingTyped() },
};

/**
 * The level question left alone, which is where most lifters stay.
 *
 * The lighter of the two conditions is applied -- the domain's own default -- and
 * the caveat above the routes names the heavier figure rather than hiding it.
 * Both halves have to be legible at once: the weight that is being shown, and the
 * weight that applies if the record turns out to be from a smaller meet.
 */
export const ARelationNobodyAnswered: Story = {
  args: { state: aRelationNobodyAnswered() },
};

/**
 * A state record at a national championship: the full loading increment.
 *
 * The same record as the first story at a heavier figure, and no caveat, because
 * the question has been answered. Worth reading directly after the story above --
 * the two differ by one segment and by half a kilogram, and half a kilogram is
 * the difference between a record and a lift nobody writes down.
 */
export const ARecordFromASmallerMeet: Story = {
  args: { state: aRecordFromASmallerMeet() },
};

/**
 * A record nobody holds yet, which is a standard the federation seeded.
 *
 * Still charged the ordinary margin, and the advisory says whose figure it is.
 * The failure this documents is the tempting one: no record book has been read
 * here, so nothing in this tool knows whether this federation lets a seeded
 * standard be taken by matching it, and the answer that costs an attempt is
 * cheaper than the answer that costs the record.
 */
export const AnUnclaimedRecord: Story = {
  args: { state: anUnclaimedRecord() },
};

/**
 * "about 200" in the record box, which is what a half-remembered record looks
 * like when it is typed at a warm-up rack.
 *
 * Not a stray character. The screen refuses in the same words it uses for an
 * empty box, because the two situations are the same one -- there is no figure
 * to measure from -- and the field itself carries the reading error.
 */
export const AFigureThatWillNotRead: Story = {
  args: { state: aFigureThatWillNotRead() },
};

/**
 * Three attempts in, the third good: the fourth attempt is open and the
 * competition route has run out.
 *
 * The mirror of the first story and the reason both headings are always drawn.
 * Every condition this federation attaches to a fourth attempt is on screen at
 * once -- the clock to submit it, the permission, the equipment check, and the
 * fact that it does not count toward the total -- because a lifter granted one
 * has about a minute to satisfy all four.
 */
export const AfterAGoodThird: Story = {
  args: { attempt: afterAGoodThird() },
};

/**
 * The same three attempts with the third missed, which is the other refusal.
 *
 * Both routes are shut and neither disappears. What to check is that the two
 * reasons are different sentences naming different facts: the competition route
 * has run out of attempts and the fourth attempt is owed a good third, and a
 * lifter who reads one as the other spends the next ten minutes arguing with an
 * expeditor about the wrong rule.
 */
export const AfterAMissedThird: Story = {
  args: { attempt: afterAMissedThird() },
};

/**
 * A total record on the deadlift, with the other lifts in the bag.
 *
 * The only subject that changes the shape of the screen: a third question
 * appears, and the open route names two figures -- what goes on the bar and what
 * it adds up to. The fourth-attempt route is shut on a rule rather than on a
 * weight, because this federation excludes a fourth attempt from the total, and
 * that is the one refusal a lifter cannot fix by lifting better.
 */
export const ATotalRecord: Story = {
  args: { state: aTotalRecord(), subject: 'total', attempt: onTheDeadlift() },
};

/**
 * The same total record with the banked figure not filled in.
 *
 * A blank field is not a total of zero, and the refusal is the point: without
 * that figure there is no way to say what the bar needs, and a screen that
 * assumed zero would print the whole record as a deadlift. The sentence under the
 * shut route is the one that names the box.
 */
export const ATotalRecordWithNothingBanked: Story = {
  args: { state: aTotalRecordWithNothingBanked(), subject: 'total', attempt: onTheDeadlift() },
};

/**
 * No federation chosen yet, which is a different screen from an empty one.
 *
 * Every margin here belongs to a rule book, so with none read there is no
 * lighter answer to fall back on -- there is none at all. The questions stay on
 * screen and answerable, because a lifter who has the record in front of them
 * should be able to type it before going back up to the setup.
 */
export const NoRuleBookYet: Story = {
  args: { attempt: null },
};

/**
 * The narrowest phone still in use (§5.7), constrained by a wrapper rather than
 * by a viewport setting -- the wrapper is what the element responds to.
 *
 * The fourth-attempt state deliberately, because it is the widest: two route
 * blocks side by side where there is room, four condition lines under one of
 * them, and the mandatory sentence under both. 320 pixels is where the decision
 * to lay the routes out on an intrinsic grid either holds or does not.
 */
export const Narrow: Story = {
  args: { attempt: afterAGoodThird() },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-meet-record
        .state=${args.state}
        .subject=${args.subject}
        .attempt=${args.attempt}
      ></ptk-meet-record>
    </div>
  `,
};
