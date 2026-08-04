// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §22.1's setup form, in the four states it passes through on the way to a meet.
 *
 * Hand-written `LifterSetup` literals rather than a timeline, deliberately
 * unlike the board's stories and the live screens': nothing on this form is
 * ranked, derived or graded -- sixteen answers go in and the same sixteen come
 * back out -- so a literal is the honest fixture and `applyMeetAction` here
 * would be scaffolding between a reviewer and the four facts each story is
 * about. §13.5's rule is about documents the transitions can reach and a
 * literal cannot; a `LifterSetup` has no such states, because every field is an
 * optional free string and every combination of them is one a lifter can type.
 *
 * The refusing story is the one worth reviewing carefully. Both times parse
 * through one function, so the pair is where a message can end up under the
 * wrong field, and the story shows one refusal beside one clean answer rather
 * than refusing both -- a form refusing everything looks the same whether it is
 * right or broken.
 */
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { EMPTY_PREP, type LifterSetup, type MeetPrep } from './prep.js';
import type { PtkMeetPrep } from './ptk-meet-prep.js';
import './ptk-meet-prep.js';

/**
 * A setup filled in the way somebody who has done this before fills it in.
 *
 * Rack numbers are labels read off somebody else's equipment, so they are the
 * shapes real ones take -- a bare number, a number with a word, a letter -- and
 * not a tidy sequence. The two notes are the length a lifter actually writes:
 * one line each, because this is typed on a phone in a queue.
 */
const ANSWERED: LifterSetup = {
  squatRackHeight: '14',
  squatSafetyHeight: '6',
  monoliftSetting: 'out 3',
  squatStart: 'monolift',
  benchRackHeight: '9',
  benchSafetyHeight: '4',
  footBlocks: 'yes',
  handoff: 'own-handler',
  deadliftNotes: 'Stiff bar, deep platform. Chalk the shins.',
  commands: 'Start, rack. No press command until the bar settles.',
  flight: 'B',
  lot: '147',
  platform: '2',
  session: 'Afternoon',
  weighInTime: '8:30 am',
  liftingStartTime: '10:30 am',
};

function withSetup(setup: Partial<LifterSetup>): MeetPrep {
  return { ...EMPTY_PREP, setup: { ...ANSWERED, ...setup } };
}

const meta: Meta<PtkMeetPrep> = {
  title: 'Meet day/Meet prep',
  component: 'ptk-meet-prep',
  tags: ['autodocs'],
  args: { prep: withSetup({}) },
  render: (args) => html`<ptk-meet-prep .prep=${args.prep}></ptk-meet-prep>`,
};

export default meta;

type Story = StoryObj<PtkMeetPrep>;

/** The form as it reads once the lifter has been to the venue. */
export const Answered: Story = {};

/**
 * Nothing answered, which is what the fold opens to weeks before the meet.
 *
 * Every field here is optional and §22.1's whole premise is that some of it is
 * not known until the morning, so a blank form says nothing at all rather than
 * refusing sixteen times. All five section headings are still on screen: there
 * is deliberately no property that could hide one, because a tick is state
 * `prep.ts` keeps and a typed sentence is not -- three empty boxes are cheaper
 * than a deadlift note nobody can see or correct.
 */
export const Blank: Story = {
  args: { prep: EMPTY_PREP },
};

/**
 * A time the form cannot read, refused under the field it is about.
 *
 * The lifting start is answered acceptably beside it, which is the control: a
 * screen putting the sentence under all sixteen looks identical to a correct
 * one if only the refused field is reviewed. Note the answer is kept exactly as
 * typed rather than blanked -- §2.4 forbids silent coercion, and the words the
 * lifter wrote are what they need to see to correct them.
 */
export const ARefusedTime: Story = {
  args: { prep: withSetup({ weighInTime: 'early doors' }) },
};

/**
 * The morning-of state: times and a lot number, no rack numbers yet.
 *
 * This is the order the answers really arrive in -- the schedule is published
 * before the venue is open and the rack heights are read off the equipment in
 * the warm-up room -- and it is the state the fold is opened in most often, so
 * it is worth being able to look at.
 */
export const OnlyWhatIsKnownYet: Story = {
  args: {
    prep: withSetup({
      squatRackHeight: '',
      squatSafetyHeight: '',
      monoliftSetting: '',
      squatStart: 'unstated',
      benchRackHeight: '',
      benchSafetyHeight: '',
      footBlocks: 'unstated',
      handoff: 'unstated',
      deadliftNotes: '',
      commands: '',
    }),
  },
};

/**
 * The narrowest phone still in use (§5.7), constrained by a wrapper rather than
 * by a viewport setting -- the wrapper is what the element's container queries
 * respond to, and a viewport parameter would document a screen the component
 * never sees. Answered rather than blank, because the paired fields are what
 * has to fold to one column and the longest label on the form sits above the
 * widest box.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-meet-prep .prep=${args.prep}></ptk-meet-prep>
    </div>
  `,
};
