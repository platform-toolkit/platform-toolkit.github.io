// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §22.1: the sixteen answers a lifter writes down before the day and reads on it.
 *
 * Rack heights, safety pins, the monolift setting, who hands the bar off, the
 * commands as this federation gives them, and where and when the lifter is
 * expected. Nothing here is computed and nothing here reaches a recommendation
 * -- `prep.ts` explains at length why that separation is structural rather than
 * tidy, and this element is the visible half of it: it imports nothing from
 * `plan.ts` or `live.ts`, and there is no path from an answer typed here to a
 * weight offered anywhere.
 *
 * WHY EVERY SECTION IS DRAWN WHATEVER THE MEET CONTESTS
 *
 * The checklist beside this one hides rows the meet does not reach -- a
 * bench-only day is not asked about deadlift socks -- so the obvious next step is
 * to hide the squat section on the same evidence. It is not taken, and the
 * asymmetry is deliberate. A checklist row is a tick, and `prep.ts` keeps a tick
 * whose row has gone so that correcting the format back restores it. A setup
 * answer is a sentence somebody typed, and it goes on to §23's printed page and
 * §24's saved document; a section that disappears takes that sentence off the
 * screen while leaving it in both. The lifter would have no way to see it, no
 * way to correct it, and no reason to suspect it was there. Three boxes nobody
 * fills in is the cheaper failure.
 *
 * WHY THE ERROR SENTENCES ARE DERIVED HERE AND NOT PASSED IN
 *
 * `setupProblems` is pure and total over the setup, so calling it in `render` is
 * the same answer the root would compute and one fewer property to keep in step.
 * The only two answers it can refuse are the two times -- everything else on this
 * screen is a label on somebody else's rack, and `prep.ts` says why parsing one
 * would be worse than accepting it.
 *
 * This element is presentation. It owns nothing: the whole `MeetPrep` is the
 * root's, and every answer is reported as the shared components' own composed
 * events tagged with `data-field` (§5.8), where the field name *is* the
 * `LifterSetup` key it writes -- see `SETUP_FIELDS` in `fields.ts`.
 */
import '@platform-toolkit/ui';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  FOOT_BLOCKS_CHOICES,
  HANDOFF_CHOICES,
  SETUP_HEADING,
  SETUP_HINT,
  SETUP_LABELS,
  SETUP_SECTION_HEADINGS,
  SQUAT_START_CHOICES,
  setupProblemText,
  type SetupFieldCopy,
} from './copy.js';
import {
  EMPTY_PREP,
  problemFor,
  setupProblems,
  type LifterSetup,
  type MeetPrep,
  type SetupProblem,
} from './prep.js';

@customElement('ptk-meet-prep')
export class PtkMeetPrep extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .setup {
      display: grid;
      gap: var(--ptk-space-lg);
    }

    h3 {
      margin: 0;
      font-size: var(--ptk-font-size-lg);
    }

    h4 {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-md);
    }

    p {
      margin: 0;
    }

    .hint {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .fields {
      display: grid;
      gap: var(--ptk-space-md);
    }

    /*
     * auto-fit against this element's own width, never the viewport: the same
     * markup is a phone and a 320px embed column on a desktop page (§5.7). The
     * track minimum is narrower than the plan screen's because these are the
     * shortest answers in the tool -- a rack height is two characters, and a
     * wider minimum would keep "Lot number" and "Platform" one per row on a
     * screen with the space for both.
     */
    .pair {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
      gap: var(--ptk-space-md);
    }
  `;

  @property({ attribute: false }) prep: MeetPrep = EMPTY_PREP;

  override render(): TemplateResult {
    const problems = setupProblems(this.prep.setup);
    return html`
      <section class="setup">
        <div>
          <h3>${SETUP_HEADING}</h3>
          <p class="hint">${SETUP_HINT}</p>
        </div>
        ${this.#renderSquat(problems)} ${this.#renderBench(problems)}
        ${this.#renderDeadlift(problems)} ${this.#renderCommands(problems)}
        ${this.#renderWhere(problems)}
      </section>
    `;
  }

  #renderSquat(problems: readonly SetupProblem[]): TemplateResult {
    return html`
      <section>
        <h4>${SETUP_SECTION_HEADINGS.squat}</h4>
        <div class="fields">
          <div class="pair">
            ${this.#renderText('squatRackHeight', problems)}
            ${this.#renderText('squatSafetyHeight', problems)}
          </div>
          ${this.#renderText('monoliftSetting', problems)}
          <ptk-choice-group
            data-field="squatStart"
            label=${SETUP_LABELS.squatStart.label}
            .choices=${SQUAT_START_CHOICES}
            .value=${this.prep.setup.squatStart}
          ></ptk-choice-group>
        </div>
      </section>
    `;
  }

  #renderBench(problems: readonly SetupProblem[]): TemplateResult {
    return html`
      <section>
        <h4>${SETUP_SECTION_HEADINGS.bench}</h4>
        <div class="fields">
          <div class="pair">
            ${this.#renderText('benchRackHeight', problems)}
            ${this.#renderText('benchSafetyHeight', problems)}
          </div>
          <ptk-choice-group
            data-field="footBlocks"
            label=${SETUP_LABELS.footBlocks.label}
            .choices=${FOOT_BLOCKS_CHOICES}
            .value=${this.prep.setup.footBlocks}
          ></ptk-choice-group>
          <ptk-choice-group
            data-field="handoff"
            label=${SETUP_LABELS.handoff.label}
            .choices=${HANDOFF_CHOICES}
            .value=${this.prep.setup.handoff}
          ></ptk-choice-group>
        </div>
      </section>
    `;
  }

  #renderDeadlift(problems: readonly SetupProblem[]): TemplateResult {
    return html`
      <section>
        <h4>${SETUP_SECTION_HEADINGS.deadlift}</h4>
        ${this.#renderNote('deadliftNotes', problems)}
      </section>
    `;
  }

  #renderCommands(problems: readonly SetupProblem[]): TemplateResult {
    return html`
      <section>
        <h4>${SETUP_SECTION_HEADINGS.commands}</h4>
        ${this.#renderNote('commands', problems)}
      </section>
    `;
  }

  #renderWhere(problems: readonly SetupProblem[]): TemplateResult {
    return html`
      <section>
        <h4>${SETUP_SECTION_HEADINGS.where}</h4>
        <div class="fields">
          <div class="pair">
            ${this.#renderText('flight', problems)} ${this.#renderText('lot', problems)}
          </div>
          <div class="pair">
            ${this.#renderText('platform', problems)} ${this.#renderText('session', problems)}
          </div>
          <div class="pair">
            ${this.#renderText('weighInTime', problems)}
            ${this.#renderText('liftingStartTime', problems)}
          </div>
        </div>
      </section>
    `;
  }

  /**
   * One short answer.
   *
   * `capitalize="none"`, against the shared field's own default of `sentences`.
   * These eleven are labels read off somebody else's equipment and off a sheet
   * on a wall -- `a4`, `12.5`, `pm` -- and a phone that helpfully capitalises
   * the first letter changes what the lifter reads back to the crew. The two
   * times are in here for a weaker version of the same reason: `parseTimeOfDay`
   * takes either case, so capitalising is not wrong, it is just the tool editing
   * an answer nobody asked it to edit.
   */
  #renderText(field: TextField, problems: readonly SetupProblem[]): TemplateResult {
    const copy = SETUP_LABELS[field];
    return html`
      <ptk-text-field
        data-field=${field}
        label=${copy.label}
        hint=${hintOf(copy)}
        capitalize="none"
        .value=${this.prep.setup[field]}
        error=${messageOf(problems, field)}
      ></ptk-text-field>
    `;
  }

  /** One of the two prose answers. Sentences, so this one does capitalise. */
  #renderNote(field: NoteField, problems: readonly SetupProblem[]): TemplateResult {
    const copy = SETUP_LABELS[field];
    return html`
      <ptk-text-area
        data-field=${field}
        label=${copy.label}
        hint=${hintOf(copy)}
        .value=${this.prep.setup[field]}
        error=${messageOf(problems, field)}
      ></ptk-text-area>
    `;
  }

  /**
   * Lit settles when this element's template is committed, which is before the
   * children it just handed options to have rendered any (§5.8). A caller
   * awaiting `updateComplete` and then reading a control would otherwise read
   * the previous render's -- usually not, which is what makes it expensive.
   */
  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const children = [...(this.shadowRoot?.querySelectorAll('*') ?? [])].filter(
      (child): child is LitElement => child instanceof LitElement,
    );
    await Promise.all(children.map((child) => child.updateComplete));
    return complete;
  }
}

/**
 * The eleven keys drawn as a one-line box and the two drawn as a text area.
 *
 * Two unions rather than one `keyof LifterSetup`, because the difference is not
 * cosmetic: a note is capped at ten times a label's length and is where the
 * commands go. Spelled out here rather than derived from `LABEL_FIELDS` in
 * `prep.ts`, which is not exported and should not be -- that list decides which
 * cap a refusal quotes, and a template importing it to decide a control's shape
 * would make one edit answer two unrelated questions.
 */
type NoteField = 'deadliftNotes' | 'commands';

type TextField = Exclude<keyof LifterSetup, NoteField | 'squatStart' | 'handoff' | 'footBlocks'>;

/**
 * The hint, or the empty string.
 *
 * Exactly three of the sixteen answers carry one -- the squat rack height, and
 * both prose answers -- so ten of the eleven one-line boxes would otherwise bind
 * `undefined` into a property declared `string`.
 *
 * **Not because lit would print the word.** That is the obvious reading and it
 * is wrong; it was measured, by mutation, in both directions. Lit renders
 * `undefined` as an empty attribute value and as nothing at all in a child part,
 * so the word never reaches the screen and the attribute binding below is
 * behaviourally identical with or without this function. What `undefined` does
 * reach is `ptk-text-field`'s own guard, `this.hint === ''`: it slips past,
 * and the box renders an empty `<p id="hint">` with `aria-describedby` pointing
 * at it -- a description with no content, which axe does not catch because the
 * target exists. That costs nothing today and costs exactly that the day
 * somebody changes `hint=` to `.hint=`, which is the binding style §5.8 prefers
 * and which every other binding in this file already uses.
 */
function hintOf(copy: SetupFieldCopy): string {
  return copy.hint ?? '';
}

/**
 * The sentence under a field, or the empty string for none.
 *
 * Empty is never a problem here: every answer in §22.1 is optional, and the
 * whole premise of the section is that some of it is not known until the
 * morning.
 */
function messageOf(problems: readonly SetupProblem[], field: keyof LifterSetup): string {
  const problem = problemFor(problems, field);
  return problem === null ? '' : setupProblemText(problem);
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-meet-prep': PtkMeetPrep;
  }
}
