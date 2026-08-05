// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §23.1: one lifter's whole day on a sheet of paper.
 *
 * `pack.ts` decided everything on it. This file lays it out and computes
 * nothing -- no weight, no subtotal, no branch, no count. It is the first
 * element in the collection whose primary medium is paper, and that changes
 * three habits the rest of the directory has:
 *
 * WHY NOTHING HERE IS BEHIND A FOLD
 *
 * Every other screen in this tool puts detail behind a `ptk-disclosure`, because
 * a phone is a small window onto a long document and a fold is how a reader
 * chooses what to look at. A printed sheet has no reader to ask: a shut fold
 * prints shut, or prints open, depending on the engine, and either way the
 * choice was made by whoever last tapped it rather than by whoever is reading
 * it in a warm-up room. So this element is flat, top to bottom, and the section
 * headings do the job the summaries were doing.
 *
 * WHY THE PRINT RULES ARE SPLIT ACROSS THREE FILES
 *
 * Document CSS cannot reach inside a shadow root and a component's `static
 * styles` cannot reach outside its own. So the page chrome (`apps/web/src/
 * styles.css`) hides the site header and drops the gutters, the planner's own
 * styles hide the planner's other children, and this file styles the sheet. Each
 * of the three is the only place that can see what it hides. A single stylesheet
 * would be tidier and would not work.
 *
 * WHY THERE IS NO PRINT BUTTON
 *
 * `PACK_PRINT_NOTE` says why in the copy: `window.print()` opens a native dialog
 * a component cannot test around, and it would be the only control in the
 * collection that takes over the browser. The planner's `@media print` block
 * makes the browser's own Print command produce this sheet from anywhere on the
 * planning screen, which is a stronger guarantee than a button -- there is no
 * state in which Print yields a blank page.
 *
 * WHY THE RAMP IS THE ONE SECTION WITH A TIME ON IT
 *
 * §23.1's warm-up block prints a lead ("start 12-14 minutes before you are
 * called") and nothing else about when. Every other figure a `MeetWarmupSchedule`
 * carries counts from the instant it was built, so it is wrong by the time the
 * paper is folded in a gym bag; a lead is a duration relative to the call and
 * survives being written down. `pack.ts`'s header says which figures were dropped
 * on the way here and why. Nothing in this file computes either kind.
 *
 * WHY IT IS WHITE-ON-BLACK NOWHERE
 *
 * The screen half honours the theme like everything else. The print half forces
 * black on white unconditionally, in this file and in `styles.css`: a dark theme
 * printed as authored is light text on white paper, which is a blank sheet with
 * the toner spent on the borders.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  PACK_ATTEMPTS_HEADING,
  PACK_CHECKLIST_HEADING,
  PACK_CONTINGENCY_ASSUMPTION,
  PACK_HIGHLIGHTED_NOTE,
  PACK_NOTES_HEADING,
  PACK_NO_PLAN,
  PACK_NO_WEIGHT,
  PACK_OMISSIONS_HEADING,
  PACK_SCHEDULE_HEADING,
  PACK_SETUP_BLANK_NOTE,
  PACK_SETUP_HEADING,
  PACK_TARGETS_HEADING,
  PACK_WARMUP_HEADING,
  SETUP_LABELS,
  attemptKilogramsText,
  attemptLabel,
  attemptPoundsText,
  checklistItemLabel,
  checklistProgressText,
  liftLabel,
  packContingencyHeading,
  packOmissionSentence,
  packPlannedTotalText,
  packReasonPhrase,
  packRulesLine,
  packSetupValue,
  packSlotHeading,
  packSubtotalText,
  packTitle,
  packWarmupAdvisorySentence,
  packWarmupLeadText,
  packWarmupLiftHeading,
  packWarmupRoomText,
  packWarmupSetLabel,
  packWarmupSetText,
  triggerSentence,
} from './copy.js';
import {
  EMPTY_PACK,
  type MeetPack,
  type PackBranch,
  type PackContingency,
  type PackLift,
  type PackSetupFact,
  type PackTarget,
  type PackWarmup,
} from './pack.js';
import type { ChecklistRow } from './prep.js';

@customElement('ptk-meet-pack')
export class PtkMeetPack extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .sheet {
      display: grid;
      gap: var(--ptk-space-lg);
    }

    section {
      display: grid;
      gap: var(--ptk-space-sm);
    }

    h3 {
      margin: 0;
      font-size: var(--ptk-font-size-lg);
    }

    h4 {
      margin: 0;
      font-size: var(--ptk-font-size-md);
    }

    h5 {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
    }

    p {
      margin: 0;
    }

    .muted {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    ul,
    ol {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: var(--ptk-space-xs);
    }

    /*
     * A label and its value, one above the other rather than side by side. Two
     * columns is the obvious reading of a setup list and it fails at 320px on
     * the longest label in the set ("Deadlift bar or platform notes"), which
     * then wraps to four lines beside a two-character rack height.
     */
    .facts {
      display: grid;
      gap: var(--ptk-space-sm);
    }

    .fact {
      display: grid;
      gap: 0.1rem;
    }

    .fact .name {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    /*
     * An unanswered rack height is a line to write on, so it is drawn as one.
     * A blank with no rule under it reads as a value the tool failed to print.
     */
    .fact .blank {
      border-bottom: 1px solid var(--ptk-color-border);
      min-height: 1.4rem;
    }

    .attempt,
    .branch,
    .row,
    .rung {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-xs) var(--ptk-space-sm);
      align-items: baseline;
    }

    .weight {
      font-weight: 600;
    }

    /*
     * A rung carries "25 kg, 5 reps" rather than a bare figure, so it is not a
     * weight -- both because bolding a whole phrase emphasises nothing, and
     * because a §16 assertion selecting .weight would start reading a warm-up
     * weight instead of an attempt. That class has now collided in four places
     * in this directory; the note in this tool's CLAUDE.md says to assume a bare
     * class is taken.
     */
    .rung .load {
      font-weight: 600;
    }

    /*
     * Wide enough that six rungs' weights line up under one another, and no
     * wider. The span carries the muted class rather than a colour of its own,
     * so that the print block's existing muted rule reaches it -- a second muted
     * colour declared here would print grey on paper and nothing would catch it,
     * because getComputedStyle in a test is always reading the screen half.
     */
    .rung .name {
      min-width: 6.5em;
    }

    .contingency {
      display: grid;
      gap: var(--ptk-space-sm);
      padding-top: var(--ptk-space-sm);
    }

    .trigger {
      display: grid;
      gap: 0.1rem;
      padding-left: var(--ptk-space-sm);
      border-left: 2px solid var(--ptk-color-border);
    }

    /*
     * The suggestion is a word, never only a weight in bold. §5.8's rule that
     * colour is never the sole carrier applies to weight and to a marker glyph
     * for the same reason, and it applies hardest here: this sheet is read in a
     * warm-up room, photocopied, and sometimes read aloud.
     */
    .suggested {
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
    }

    .done::before {
      content: '[x] ';
    }

    .todo::before {
      content: '[ ] ';
    }

    .notes {
      white-space: pre-wrap;
    }

    /*
     * The printed half. Black on white whatever the theme, no borders spending
     * toner, and nothing allowed to break across a page in the middle of a
     * decision -- a contingency block split over a fold is exactly the lost page
     * §23's copy block is written against.
     */
    @media print {
      :host {
        color: #000;
        background: #fff;
      }

      .muted,
      .fact .name {
        color: #000;
      }

      .sheet {
        gap: 0.6rem;
      }

      section,
      .contingency,
      .trigger {
        break-inside: avoid;
      }

      h3 {
        font-size: 1.2rem;
      }

      h4 {
        font-size: 1rem;
      }

      .fact .blank {
        border-bottom: 1px solid #000;
      }

      .trigger {
        border-left: 1px solid #000;
      }
    }
  `;

  @property({ attribute: false }) pack: MeetPack = EMPTY_PACK;

  override render(): TemplateResult {
    const { heading } = this.pack;
    return html`
      <article class="sheet">
        <header>
          <h3>${packTitle(heading.lifterName)}</h3>
          <p class="muted rules">
            ${packRulesLine(
              heading.rulesLabel,
              heading.rulebookLabel,
              heading.rulebookRevision,
              heading.rulesVerifiedOn,
            )}
          </p>
        </header>
        ${this.#renderSetup()} ${this.#renderSchedule()} ${this.#renderAttempts()}
        ${this.#renderWarmup()} ${this.#renderTargets()} ${this.#renderChecklist()}
        ${this.#renderNotes()} ${this.#renderOmissions()}
      </article>
    `;
  }

  #renderSetup(): TemplateResult {
    return html`
      <section class="setup">
        <h4>${PACK_SETUP_HEADING}</h4>
        <p class="muted">${PACK_SETUP_BLANK_NOTE}</p>
        <div class="facts">${this.pack.platformSetup.map((fact) => renderFact(fact))}</div>
      </section>
    `;
  }

  /*
   * Dropped entirely when nothing was answered, which is the one place this
   * element leaves a gap rather than a sentence -- and it is not a gap, because
   * `pack.ts` only omits an answer the lifter did not give. A heading over three
   * blank lines would be a section about nothing; the setup section above it
   * already carries the write-on story for what the day tells you.
   */
  #renderSchedule(): TemplateResult | typeof nothing {
    if (this.pack.otherSetup.length === 0) return nothing;
    return html`
      <section class="schedule">
        <h4>${PACK_SCHEDULE_HEADING}</h4>
        <div class="facts">${this.pack.otherSetup.map((fact) => renderFact(fact))}</div>
      </section>
    `;
  }

  #renderAttempts(): TemplateResult {
    const { plannedTotalKilograms, heading } = this.pack;
    return html`
      <section class="attempts">
        <h4>${PACK_ATTEMPTS_HEADING}</h4>
        ${this.pack.lifts.map((lift) => this.#renderLift(lift))}
        ${
          plannedTotalKilograms === null
            ? nothing
            : html`<p class="total">
                ${packPlannedTotalText(plannedTotalKilograms, heading.unit)}
              </p>`
        }
      </section>
    `;
  }

  #renderLift(lift: PackLift): TemplateResult {
    if (lift.attempts.length === 0) {
      return html`
        <section class="lift">
          <h5>${liftLabel(lift.lift)}</h5>
          <p class="muted">${PACK_NO_PLAN}</p>
        </section>
      `;
    }
    return html`
      <section class="lift">
        <h5>${liftLabel(lift.lift)}</h5>
        <ol>
          ${lift.attempts.map(
            (attempt) => html`
              <li class="attempt">
                <span class="name">${attemptLabel(attempt.attemptNumber)}</span>
                <span class="weight">${attemptKilogramsText(attempt.weight)}</span>
                ${renderPounds(attemptPoundsText(attempt.weight))}
              </li>
            `,
          )}
        </ol>
        ${
          lift.subtotalKilograms === null
            ? nothing
            : html`<p class="muted subtotal">
                ${packSubtotalText(lift.subtotalKilograms, this.pack.heading.unit)}
              </p>`
        }
        ${lift.contingencies.length === 0 ? nothing : this.#renderContingencies(lift)}
      </section>
    `;
  }

  /*
   * Grouped by which attempt is being decided, not by trigger. A lifter reads
   * this sheet at one moment -- the opener is over and the second is owed -- and
   * grouping the other way would have them scanning six blocks for the two rows
   * that apply to them.
   */
  #renderContingencies(lift: PackLift): TemplateResult {
    const numbers = [...new Set(lift.contingencies.map((row) => row.attemptNumber))];
    return html`
      ${numbers.map((attemptNumber) => {
        const rows = lift.contingencies.filter((row) => row.attemptNumber === attemptNumber);
        return html`
          <div class="contingency">
            <h5>${packContingencyHeading(attemptNumber)}</h5>
            ${
              rows.some((row) => row.assumesEarlierAttemptsMade)
                ? html`<p class="muted assumption">${PACK_CONTINGENCY_ASSUMPTION}</p>`
                : nothing
            }
            ${rows.map((row) => this.#renderTrigger(row))}
          </div>
        `;
      })}
    `;
  }

  #renderTrigger(row: PackContingency): TemplateResult {
    return html`
      <div class="trigger">
        <p class="reading">${triggerSentence(row.trigger)}</p>
        <ul>
          ${row.branches.map((branch) => html`<li class="branch">${renderBranch(branch)}</li>`)}
        </ul>
      </div>
    `;
  }

  /*
   * Below the attempts and above the targets, which is the order the day
   * happens in rather than the order §23 lists its sections. A ramp is counted
   * back from an opener, so it is unreadable before the opener it belongs to has
   * been seen -- and it is over before the first target on the sheet is in
   * reach. Dropped entirely when `pack.ts` produced none, in which case the
   * omissions section at the foot says so in a sentence.
   */
  #renderWarmup(): TemplateResult | typeof nothing {
    if (this.pack.warmups.length === 0) return nothing;
    return html`
      <section class="ramp">
        <h4>${PACK_WARMUP_HEADING}</h4>
        ${this.pack.warmups.map((warmup) => this.#renderLiftWarmup(warmup))}
      </section>
    `;
  }

  /*
   * The lead is printed above the rungs and not below them, against the reading
   * order of the ramp itself. It is the only thing on the block that is about
   * *when*, and a lifter checking this section between flights is checking
   * whether it is time yet -- putting it under six rungs is putting it under the
   * part they already know.
   */
  #renderLiftWarmup(warmup: PackWarmup): TemplateResult {
    return html`
      <section class="lift-ramp">
        <h5>${packWarmupLiftHeading(warmup.lift)}</h5>
        <p class="lead">
          ${packWarmupLeadText(warmup.lead.minimumSeconds, warmup.lead.maximumSeconds)}
        </p>
        <ol>
          ${warmup.sets.map(
            (set) => html`
              <li class="rung">
                <span class="name muted">${packWarmupSetLabel(set.ordinal)}</span>
                <span class="load">${packWarmupSetText(set)}</span>
              </li>
            `,
          )}
        </ol>
        <p class="muted room">${packWarmupRoomText(warmup.room)}</p>
        ${
          warmup.advisories.length === 0
            ? nothing
            : html`<ul class="advisories">
                ${warmup.advisories.map(
                  (code) => html`<li class="muted">${packWarmupAdvisorySentence(code)}</li>`,
                )}
              </ul>`
        }
      </section>
    `;
  }

  #renderTargets(): TemplateResult | typeof nothing {
    if (this.pack.targets.length === 0) return nothing;
    return html`
      <section class="targets">
        <h4>${PACK_TARGETS_HEADING}</h4>
        <ul>
          ${this.pack.targets.map((target) => html`<li class="row">${renderTarget(target)}</li>`)}
        </ul>
      </section>
    `;
  }

  #renderChecklist(): TemplateResult | typeof nothing {
    const { checklist, checklistProgress: progress } = this.pack;
    if (checklist.length === 0) return nothing;
    return html`
      <section class="checklist">
        <h4>${PACK_CHECKLIST_HEADING}</h4>
        <p class="muted progress">${checklistProgressText(progress.done, progress.total)}</p>
        <ul>
          ${checklist.map(
            (row) => html`<li class=${row.done ? 'done' : 'todo'}>${checklistText(row)}</li>`,
          )}
        </ul>
      </section>
    `;
  }

  #renderNotes(): TemplateResult | typeof nothing {
    if (this.pack.notes === '') return nothing;
    return html`
      <section class="own-notes">
        <h4>${PACK_NOTES_HEADING}</h4>
        <p class="notes">${this.pack.notes}</p>
      </section>
    `;
  }

  /*
   * Last on the sheet and never dropped when the list is empty -- an empty list
   * simply renders no section, which is honest, because `pack.ts` declares the
   * same three omissions on every pack it builds. The section is at the bottom
   * because it is the part a reader checks once and then stops looking for.
   */
  #renderOmissions(): TemplateResult | typeof nothing {
    if (this.pack.omissions.length === 0) return nothing;
    return html`
      <section class="omissions">
        <h4>${PACK_OMISSIONS_HEADING}</h4>
        <ul>
          ${this.pack.omissions.map((code) => html`<li>${packOmissionSentence(code)}</li>`)}
        </ul>
      </section>
    `;
  }
}

function renderFact(fact: PackSetupFact): TemplateResult {
  const value = packSetupValue(fact.field, fact.value);
  return html`
    <div class="fact">
      <span class="name">${SETUP_LABELS[fact.field].label}</span>
      ${
        fact.answered && value !== ''
          ? html`<span class="value">${value}</span>`
          : html`<span class="blank"></span>`
      }
    </div>
  `;
}

/**
 * The published pound figure, or nothing at all.
 *
 * Deliberately not `approximatePoundsText` as a fallback. §16 makes the chart
 * the only authority for a pound figure, and a hedged conversion printed on
 * paper loses its hedge the moment somebody reads the number aloud at a table.
 */
function renderPounds(pounds: string | null): TemplateResult | typeof nothing {
  return pounds === null ? nothing : html`<span class="pounds muted">${pounds}</span>`;
}

function renderBranch(branch: PackBranch): TemplateResult {
  return html`
    <span class="slot">${packSlotHeading(branch.slot)}</span>
    <span class="weight"
      >${branch.weight === null ? PACK_NO_WEIGHT : attemptKilogramsText(branch.weight)}</span
    >
    ${branch.weight === null ? nothing : renderPounds(attemptPoundsText(branch.weight))}
    <span class="why muted">${packReasonPhrase(branch.reason)}</span>
    ${branch.highlighted ? html`<span class="suggested">${PACK_HIGHLIGHTED_NOTE}</span>` : nothing}
  `;
}

function renderTarget(target: PackTarget): TemplateResult {
  return html`
    <span class="name">${target.label}</span>
    <span class="weight">${attemptKilogramsText(target.weight)}</span>
    ${renderPounds(attemptPoundsText(target.weight))}
  `;
}

function checklistText(row: ChecklistRow): string {
  return row.kind === 'custom' ? row.text : checklistItemLabel(row.itemId);
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-meet-pack': PtkMeetPack;
  }
}
