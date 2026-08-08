// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The optional questions: everything that changes what the answer is *worth*
 * rather than what it is.
 *
 * WHY THESE ARE FOLDED AND THE FIRST FOUR ARE NOT
 *
 * §4 requires a result from a weight and a repetition count alone, and §9.2
 * requires the refinements to be discoverable without being in the way. Seven
 * more questions in front of a lifter between sets is how a calculator becomes a
 * form nobody finishes. Folded, they are one tap away and the summary says what
 * is currently true, which is the rule `ptk-disclosure` carries (§5.8): a fold
 * that hides an answer the numbers depend on is how somebody reads an estimate
 * built on assumptions they never saw.
 *
 * The one exception folded in here with the rest is the spotter question. It
 * withholds the estimate entirely rather than adjusting it -- but it is also the
 * rarest answer on the screen, and a checkbox that stops the tool working sits
 * badly beside the weight field. It is stated in the summary whenever it is set,
 * so it can never be true and invisible at once.
 *
 * This element is presentation. It reads an `EstimateEntry` and reports changes
 * as the shared components' own composed events, tagged with `data-field`; the
 * root owns every piece of state (§10.2).
 */
import { findTechnique } from '@platform-toolkit/domain';
import '@platform-toolkit/ui/ptk-choice-group';
import '@platform-toolkit/ui/ptk-disclosure';
import '@platform-toolkit/ui/ptk-toggle-group';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  ASSISTED_CHOICES,
  EXPERIENCE_CHOICES,
  FORM_QUALITY_CHOICES,
  FRESHNESS_CHOICES,
  SEX_CHOICES,
  SEX_EXPLANATION,
  roundingChoices,
  techniqueChoices,
} from './copy.js';
import {
  ASSISTED_FIELD,
  EXPERIENCE_FIELD,
  FORM_QUALITY_FIELD,
  FRESHNESS_FIELD,
  ROUND_TO_FIELD,
  SEX_FIELD,
  TECHNIQUE_FIELD,
} from './fields.js';
import { EMPTY_ENTRY, experienceValueOf, sexValueOf, type EstimateEntry } from './session.js';

@customElement('ptk-set-refinements')
export class PtkSetRefinements extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .questions {
      display: grid;
      gap: var(--ptk-space-lg);
    }

    .note,
    .explanation {
      margin: var(--ptk-space-xs) 0 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }
  `;

  @property({ attribute: false }) entry: EstimateEntry = EMPTY_ENTRY;

  override render(): TemplateResult {
    const entry = this.entry;
    const technique = findTechnique(entry.lift, entry.techniqueId);
    return html`
      <ptk-disclosure label="Improve this estimate" summary=${this.#summary()}>
        <div class="questions">
          <div>
            <ptk-choice-group
              data-field=${TECHNIQUE_FIELD}
              label="Movement standard"
              .choices=${techniqueChoices(entry.lift)}
              .value=${entry.techniqueId}
            ></ptk-choice-group>
            ${technique === null ? nothing : html`<p class="note">${technique.note}</p>`}
          </div>

          <ptk-choice-group
            data-field=${FRESHNESS_FIELD}
            label="How fresh was the set?"
            .choices=${FRESHNESS_CHOICES}
            .value=${entry.freshness}
          ></ptk-choice-group>

          <ptk-choice-group
            data-field=${FORM_QUALITY_FIELD}
            label="Did form hold up?"
            .choices=${FORM_QUALITY_CHOICES}
            .value=${entry.formQuality}
          ></ptk-choice-group>

          <ptk-choice-group
            data-field=${EXPERIENCE_FIELD}
            label="Experience with maximal work"
            .choices=${EXPERIENCE_CHOICES}
            .value=${experienceValueOf(entry.experience)}
          ></ptk-choice-group>

          <div>
            <ptk-choice-group
              data-field=${SEX_FIELD}
              label="Reported sex"
              .choices=${SEX_CHOICES}
              .value=${sexValueOf(entry.sex)}
            ></ptk-choice-group>
            <p class="explanation">${SEX_EXPLANATION}</p>
          </div>

          <ptk-toggle-group
            data-field=${ASSISTED_FIELD}
            label="Assistance"
            .choices=${ASSISTED_CHOICES}
            .values=${entry.assisted ? ['assisted'] : []}
          ></ptk-toggle-group>

          <ptk-choice-group
            data-field=${ROUND_TO_FIELD}
            label="Round the estimate to"
            .choices=${roundingChoices(entry.unit)}
            .value=${String(entry.roundTo)}
          ></ptk-choice-group>
        </div>
      </ptk-disclosure>
    `;
  }

  /**
   * What is true while this is folded.
   *
   * Only the answers that move something are listed. Naming the ones still on
   * their opening value would make the summary longest exactly when the least
   * has been said, and the sentence exists to be read at a glance.
   */
  #summary(): string {
    const entry = this.entry;
    const said: string[] = [];
    const technique = findTechnique(entry.lift, entry.techniqueId);
    if (technique !== null && technique.match !== 'unsure')
      said.push(technique.label.toLowerCase());
    if (entry.freshness !== 'unstated') said.push(entry.freshness);
    if (entry.formQuality === 'degraded') said.push('form broke down');
    if (entry.formQuality === 'consistent') said.push('form held');
    if (entry.experience !== null) said.push(`${entry.experience} lifter`);
    if (entry.sex !== null) said.push(entry.sex);
    // Always last and always said: this one stops the estimate rather than
    // adjusting it, so it may never be true and unmentioned.
    if (entry.assisted) said.push('spotter assisted');
    // Reported sex is named here for the same reason the other three are, and it
    // was the one left out: the tool notes in the result panel that sex-specific
    // weighting is off, and a lifter who reads that and then reads a folded
    // section claiming only three things are unstated has been told the question
    // does not exist. Named in the opening sentence rather than appended to
    // every "Added:" line, so the fold is signposted where it is emptiest and
    // stays a glanceable sentence once it is not.
    return said.length === 0
      ? 'Nothing added. Movement standard, fatigue, experience and reported sex are all unstated.'
      : `Added: ${said.join(', ')}.`;
  }

  /**
   * Lit settles when this element's template is committed, which is before the
   * choice groups it just handed options to have rendered any (§5.8). A caller
   * awaiting `updateComplete` and then reading an option would otherwise read
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

declare global {
  interface HTMLElementTagNameMap {
    'ptk-set-refinements': PtkSetRefinements;
  }
}
