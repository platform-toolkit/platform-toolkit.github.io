// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The five questions that decide which table a lifter's results are read against.
 *
 * Everything else in this tool grades a figure. This screen decides *what it is
 * graded as*, and it is the screen with the most power to be quietly wrong: a
 * lifter placed on the wrong equipment ladder sees a plausible number, on the right
 * card, under the right heading, and has no way to tell. So the form's job is not
 * to collect five answers as quickly as possible. It is to make every one of them
 * checkable.
 *
 * WHAT IS FILLED IN, AND WHAT DELIBERATELY IS NOT
 *
 * `category-match.ts` draws the line and this element renders it. A **measured**
 * proposal -- 108.4 kg makes the 110 kg class, 47 makes a 45-to-49 band -- crossed
 * no vocabulary to reach, so it arrives pre-selected. A **spelled** one -- the
 * archive says Raw and so does this federation -- is left blank however obvious it
 * looks, because those two Raws differ over knee wraps and that is the single most
 * common entry in the corpus. Both carry a sentence saying which they are. A form
 * that pre-filled the second would be right most of the time, which is what makes
 * it dangerous.
 *
 * WHY THE DIVISION IS NEVER CHOSEN FOR ANYBODY
 *
 * A Junior may enter Junior and/or Open; a Master may enter Master and/or Open
 * (USPA Item 8.1.19). So for most lifters over 40 the eligible set has two members,
 * and picking one is a strategic decision about which standards to be read against.
 * Section 29: the tool does not make it. What this screen does instead is show
 * every division each recorded age admits, and -- where the archive gave a birth
 * year rather than a birth date -- which reading of that age reaches which
 * division, without resolving the ambiguity in either direction.
 *
 * IT REPORTS ANSWERS, NEVER A REGISTRATION
 *
 * The event carries the whole `answers` object rather than the resolved
 * registration or a delta. A resolution is derived and the consumer re-derives it;
 * storing this element's copy would make the drop of an answer the catalogue no
 * longer offers permanent, which is the "keep the request separate from the
 * resolved answer" rule (section 5.8). A delta would make every consumer keep its
 * own copy of the set in order to apply one.
 */
import type { AgeDivision, EquipmentCategory, WeightClass } from '@platform-toolkit/data-contracts';
import '@platform-toolkit/ui/ptk-choice-group';
import '@platform-toolkit/ui/ptk-notice';
import '@platform-toolkit/ui/ptk-select';
import {
  CHOICE_CHANGE_EVENT,
  type Choice,
  type ChoiceChangeDetail,
} from '@platform-toolkit/ui/ptk-choice-group';
import {
  SELECT_CHANGE_EVENT,
  type SelectChangeDetail,
  type SelectOption,
} from '@platform-toolkit/ui/ptk-select';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';

import type {
  AgeDivisionCandidates,
  RegistrationAxis,
  RegistrationProposal,
  TestedProposal,
} from '../core/registration.js';
import { weightClassesFor } from '../core/category-match.js';
import { resolveRegistration } from '../core/registration.js';
import type { CatalogVocabulary, CategoryProposal, ResolvedRegistration } from '../types.js';

import {
  AGE_READING_SUPPORT,
  ANSWER_NOTES,
  AXIS_QUESTIONS,
  ageLabel,
  proposalNote,
  testedNote,
} from './copy.js';
import { TESTED_NO, TESTED_YES, axisOf } from './fields.js';
import { SEX_LABELS, isSexCategory } from './labels.js';

/** Fired whenever the reader changes an answer. Never for a programmatic set. */
export interface RegistrationAnswersDetail {
  /** Every answer the reader has given, not the one that just changed. */
  readonly answers: Partial<ResolvedRegistration>;
}

/** Event name, exported so a listener cannot misspell it. */
export const REGISTRATION_ANSWERS_EVENT = 'ptk-registration-answers';

/**
 * A registration being edited.
 *
 * `ResolvedRegistration` is deeply readonly and `exactOptionalPropertyTypes` is on,
 * so clearing an answer cannot be an assignment of `undefined` -- the compiler
 * refuses it, and correctly: a key present and holding `undefined` is a different
 * object from a key that is absent, and `resolveRegistration` spreads the answers
 * over the defaults, where the first would blank a default the reader never touched.
 * It has to be a `delete` on a mutable draft, which is why this type exists.
 * Deliberately the same shape as `registration.ts`'s own private draft.
 */
type AnswerDraft = {
  -readonly [K in keyof ResolvedRegistration]?: ResolvedRegistration[K];
};

/** The catalogue axes whose answer is a published identifier. */
type IdentifierAxis = 'equipmentId' | 'weightClassId' | 'divisionId';

/**
 * The tag this element is registered under by `defineQualificationCheck()`.
 *
 * Declared here and registered there, rather than by a `@customElement`
 * decorator, because the decorator writes to the registry the instant this module
 * is evaluated -- and the registry is a global that throws on a second write.
 * A consumer whose bundler failed to dedupe this package, or that imports it
 * alongside another copy, would get a `NotSupportedError` from a file it did not
 * write before a line of its own code ran (section 15).
 */
export const REGISTRATION_ANSWERS_TAG = 'ptk-registration-answers';

export class PtkRegistrationAnswers extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .intro {
      margin: 0 0 var(--ptk-space-md);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    /*
     * One column at any width. The five questions are answered in order and the
     * later ones depend on the earlier -- a weight class belongs to a sex ladder --
     * so a two-column arrangement would put the second question beside the first
     * and read as a pair of independent settings.
     */
    .axes {
      display: grid;
      gap: var(--ptk-space-md);
    }

    .axis {
      display: grid;
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-left: 3px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    /*
     * An axis still wanting an answer. The accent edge is never the only signal --
     * every one of these is also named in the list above the form, in words -- for
     * the reason a coach board may not identify a lifter by colour: a border is
     * discarded under forced colours and invisible to a reader who cannot separate
     * the hues, and an unanswered question is the whole reason the grades below are
     * missing.
     */
    .axis.needed {
      border-left-color: var(--ptk-color-accent);
    }

    .note,
    .observed,
    .support {
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    .note,
    .observed {
      margin: 0;
    }

    .observed strong {
      color: var(--ptk-color-text);
      /* A federation writes long division names and an archive writes stranger
         ones. Value anywhere, never break-word: only the first lowers the
         min-content size, and a grid track will not go under that. */
      overflow-wrap: anywhere;
    }

    .by-age {
      display: grid;
      gap: var(--ptk-space-sm);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .age {
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
    }

    .candidates {
      margin: var(--ptk-space-xs) 0 0;
      padding: 0 0 0 var(--ptk-space-md);
      font-size: var(--ptk-font-size-sm);
    }
  `;

  /** What the results propose, and which axes they could not settle. */
  @property({ attribute: false }) proposal: RegistrationProposal | null = null;

  /** This federation's published equipment, weight classes and divisions. */
  @property({ attribute: false }) vocabulary: CatalogVocabulary | null = null;

  /**
   * The reader's own answers, which outrank the proposal's defaults.
   *
   * Held here as well as reported, so the element is usable without a consumer
   * binding it back -- and bound back by consumers that keep the state, which is
   * the normal shape. A key absent means "no answer of mine"; the default shows
   * through, which is what makes the placeholder an undo rather than a blank.
   */
  @property({ attribute: false }) answers: Partial<ResolvedRegistration> = {};

  /**
   * One listener per event name, both reading the axis off the composed path.
   *
   * Arrow-function fields rather than bound methods, so the reference is stable and
   * a re-connect cannot register a second copy -- `addEventListener` de-duplicates
   * by reference, and a second copy would report every answer twice.
   */
  readonly #onChoice = (event: CustomEvent<ChoiceChangeDetail>): void => {
    this.#answer(axisOf(event), event.detail.value);
  };

  readonly #onSelect = (event: CustomEvent<SelectChangeDetail>): void => {
    this.#answer(axisOf(event), event.detail.value);
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.addEventListener(SELECT_CHANGE_EVENT, this.#onSelect);
  }

  /**
   * Waits for the controls, not just for this element's own template.
   *
   * Lit's own promise settles when the host's template is committed -- which sets
   * `.choices` and `.options` on five children and leaves all five renders queued.
   * Today they have usually caught up by the time anything looks, and that is
   * exactly the hazard: the guarantee is what every caller assumes, so the day the
   * timing shifts the failure is an assertion against the previous render in a test
   * that has passed for months.
   */
  protected override async getUpdateComplete(): Promise<boolean> {
    const done = await super.getUpdateComplete();
    const children = this.shadowRoot?.querySelectorAll('ptk-choice-group, ptk-select') ?? [];
    // Filtered on the class rather than trusted from the selector: a
    // comma-separated `querySelectorAll` types as `Element`, which has no
    // `updateComplete`.
    await Promise.all(
      [...children]
        .filter((child): child is LitElement => child instanceof LitElement)
        .map((child) => child.updateComplete),
    );
    return done;
  }

  override render(): TemplateResult {
    const { proposal, vocabulary } = this;
    if (proposal === null || vocabulary === null) {
      return html`<ptk-notice tone="info">
        Add a result. The questions that choose your standards appear here.
      </ptk-notice>`;
    }

    const current: Readonly<AnswerDraft> = { ...proposal.defaults, ...this.answers };
    const resolution = resolveRegistration(proposal, this.answers);
    const missing: readonly RegistrationAxis[] = resolution.ok ? [] : resolution.missing;

    return html`
      <p class="intro">${ANSWER_NOTES.intro}</p>
      ${this.#renderMissing(missing)}
      <div class="axes">
        ${this.#renderSex(proposal, current, missing)}
        ${this.#renderEquipment(proposal, vocabulary, current, missing)}
        ${this.#renderWeightClass(proposal, current, missing)}
        ${this.#renderDivision(proposal, vocabulary, current, missing)}
        ${this.#renderTested(proposal, current, missing)}
      </div>
    `;
  }

  /**
   * The blanks, named in words above the form.
   *
   * Above rather than below, because the reason somebody is on this screen is that
   * a grade is missing, and the list is the answer to "why". It is also what keeps
   * the accent edge on each block from being the only way to find them.
   */
  #renderMissing(missing: readonly RegistrationAxis[]): TemplateResult | typeof nothing {
    if (missing.length === 0) return nothing;
    return html`<ptk-notice tone="info">
      ${ANSWER_NOTES.stillToAnswer} ${missing.map((axis) => AXIS_QUESTIONS[axis]).join(', ')}
    </ptk-notice>`;
  }

  #renderSex(
    proposal: RegistrationProposal,
    current: Readonly<AnswerDraft>,
    missing: readonly RegistrationAxis[],
  ): TemplateResult {
    const choices: readonly Choice[] = Object.entries(SEX_LABELS).map(([value, label]) => ({
      value,
      label,
    }));
    return this.#axisBlock(
      'sex',
      missing,
      html`<ptk-choice-group
        label=${AXIS_QUESTIONS.sex}
        .choices=${choices}
        .value=${current.sex ?? null}
      ></ptk-choice-group>`,
      html`${observedLine(proposal.sex)}
        <p class="note">${proposalNote(proposal.sex)}</p>`,
    );
  }

  #renderEquipment(
    proposal: RegistrationProposal,
    vocabulary: CatalogVocabulary,
    current: Readonly<AnswerDraft>,
    missing: readonly RegistrationAxis[],
  ): TemplateResult {
    const choices: readonly Choice[] = vocabulary.equipment.map((category) => ({
      value: category.id,
      label: category.label,
    }));
    return this.#axisBlock(
      'equipment',
      missing,
      html`<ptk-choice-group
        label=${AXIS_QUESTIONS.equipment}
        .choices=${choices}
        .value=${current.equipmentId ?? null}
        empty-message="This federation publishes no equipment categories."
      ></ptk-choice-group>`,
      html`${observedLine(proposal.equipment)}
        <p class="note">${proposalNote(proposal.equipment)}</p>`,
    );
  }

  /**
   * The class entered, with the class the bodyweight makes beside it.
   *
   * Both, always, and the second is not a second control. A lifter may enter above
   * their weigh-in, which is allowed and common, so the two disagreeing is
   * information rather than a fault -- and a screen showing only the entered class
   * has hidden the reason its number looks wrong to somebody who remembers what
   * they weighed.
   */
  /*
   * The one axis renderer with no vocabulary parameter, which is the point. Its
   * options are a *sex's* ladder rather than the federation's whole list, and the
   * proposal is where that selection is made. Reaching past it to the catalogue is
   * the bug this shape makes impossible to write.
   */
  #renderWeightClass(
    proposal: RegistrationProposal,
    current: Readonly<AnswerDraft>,
    missing: readonly RegistrationAxis[],
  ): TemplateResult {
    const weighed = proposal.weighedWeightClass.proposed;
    return this.#axisBlock(
      'weight-class',
      missing,
      this.#picker(
        'weight-class',
        proposal.weightClassOptions,
        current.weightClassId ?? null,
        proposal.defaults.weightClassId !== undefined,
        // Two ways to have no classes, and they ask the reader for opposite things.
        // A ladder is published per sex, so before that question is answered there is
        // nothing to list -- and "this federation publishes none" would be a claim
        // about the federation when the gap is on this screen. One says come back,
        // the other says go up.
        current.sex === undefined
          ? ANSWER_NOTES.weightClassNeedsSex
          : 'This federation publishes no weight classes for this ladder.',
      ),
      html`${observedLine(proposal.enteredWeightClass)}
        <p class="note">${proposalNote(proposal.enteredWeightClass)}</p>
        ${
          weighed === null
            ? nothing
            : html`<p class="observed">
                ${ANSWER_NOTES.weightClassWeighed} <strong>${weighed.label}</strong>.
              </p>`
        }
        <p class="note">${ANSWER_NOTES.weightClassEntered}</p>`,
    );
  }

  /**
   * Every division the ages admit, offered rather than narrowed to one.
   *
   * The options are the divisions some reading of some recorded age reaches, and
   * they fall back to the federation's whole published list when there is no age to
   * read -- a lifter whose results carry no age still has to pick a division, and an
   * empty picker would be this screen refusing to let them.
   */
  #renderDivision(
    proposal: RegistrationProposal,
    vocabulary: CatalogVocabulary,
    current: Readonly<AnswerDraft>,
    missing: readonly RegistrationAxis[],
  ): TemplateResult {
    const [first] = proposal.divisionOptions;
    const options: readonly AgeDivision[] =
      first === undefined ? vocabulary.divisions : proposal.divisionOptions;
    return this.#axisBlock(
      'division',
      missing,
      this.#picker(
        'division',
        options,
        current.divisionId ?? null,
        proposal.defaults.divisionId !== undefined,
        'This federation publishes no age divisions.',
      ),
      html`${observedLine(proposal.divisionFromBand)}
        <p class="note">${proposalNote(proposal.divisionFromBand)}</p>
        <p class="note">${ANSWER_NOTES.divisionChoice}</p>
        ${renderDivisionsByAge(proposal.divisionsByAge)}`,
    );
  }

  #renderTested(
    proposal: RegistrationProposal,
    current: Readonly<AnswerDraft>,
    missing: readonly RegistrationAxis[],
  ): TemplateResult {
    const choices: readonly Choice[] = [
      { value: TESTED_YES, label: 'Yes' },
      { value: TESTED_NO, label: 'No' },
    ];
    return this.#axisBlock(
      'tested',
      missing,
      html`<ptk-choice-group
        label=${AXIS_QUESTIONS.tested}
        .choices=${choices}
        .value=${testedValue(current.tested)}
      ></ptk-choice-group>`,
      html`${observedTested(proposal.tested)}
        <p class="note">${testedNote(proposal.tested)}</p>`,
    );
  }

  /**
   * A long-list control, with the placeholder saying what clearing it does.
   *
   * Two placeholders and not one, because the same gesture means two things. On an
   * axis with no proposal underneath it, clearing leaves the question unanswered.
   * On an axis with one, the proposal shows through and the control repaints with a
   * value in it -- so "Not answered" there would describe a control that refuses to
   * clear, rather than the undo it actually is.
   */
  #picker(
    axis: RegistrationAxis,
    published: readonly { readonly id: string; readonly label: string }[],
    value: string | null,
    hasDefault: boolean,
    emptyMessage: string,
  ): TemplateResult {
    const options: readonly SelectOption[] = published.map((item) => ({
      value: item.id,
      label: item.label,
    }));
    return html`<ptk-select
      label=${AXIS_QUESTIONS[axis]}
      .options=${options}
      .value=${value}
      placeholder=${
        hasDefault ? ANSWER_NOTES.placeholderRevert : ANSWER_NOTES.placeholderUnanswered
      }
      empty-message=${emptyMessage}
    ></ptk-select>`;
  }

  /**
   * One question, its control, and the evidence for whatever is in it.
   *
   * `data-axis` sits here rather than on the control, so that anything else this
   * block grows -- a second picker, a link to the federation's own list -- routes
   * without a second attribute to remember.
   *
   * Written out literally rather than composed from `AXIS_DATASET_KEY`, because
   * lit-html parses the template's HTML once and an interpolated *attribute name*
   * is not a binding it can make -- the expression would land in the markup as text
   * and the attribute would never exist. So this is the one place the contract is
   * spelled twice, and the compiler cannot hold the two in step. What does is the
   * browser test that answers a control and asserts the answer was recorded: a
   * rename on either side leaves five controls that visibly respond and change
   * nothing, which is precisely what that test fails on.
   */
  #axisBlock(
    axis: RegistrationAxis,
    missing: readonly RegistrationAxis[],
    control: TemplateResult,
    evidence: TemplateResult,
  ): TemplateResult {
    return html`<div class=${missing.includes(axis) ? 'axis needed' : 'axis'} data-axis=${axis}>
      ${control} ${evidence}
    </div>`;
  }

  #answer(axis: RegistrationAxis | null, raw: string | null): void {
    const { proposal, vocabulary } = this;
    if (axis === null || proposal === null || vocabulary === null) return;

    const next = applyAnswer(this.answers, axis, raw, vocabulary, proposal.weightClassOptions);
    // `null` is a value that is not one of the published answers -- a stray
    // `data-axis`, or a catalogue that changed under an open screen. Refused
    // silently and deliberately: there is no answer to record and nothing the
    // reader did wrong, and writing it would put an identifier no table is keyed on
    // into a registration the report is then read under.
    if (next === null) return;

    this.answers = next;
    this.dispatchEvent(
      new CustomEvent<RegistrationAnswersDetail>(REGISTRATION_ANSWERS_EVENT, {
        detail: { answers: next },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

/**
 * The next set of answers, or `null` where the reported value was not an answer.
 *
 * Every string here came off the DOM, so every one is checked against the list it
 * is supposed to have come from rather than written through. A `data-axis` typo, or
 * a value from a catalogue that has since been republished, would otherwise put an
 * identifier nothing is keyed on into the registration -- and the symptom is not an
 * error, it is a report that grades against no table and says the federation
 * publishes no standards for this lifter.
 */
function applyAnswer(
  current: Partial<ResolvedRegistration>,
  axis: RegistrationAxis,
  raw: string | null,
  vocabulary: CatalogVocabulary,
  weightClassOptions: readonly WeightClass[],
): Partial<ResolvedRegistration> | null {
  const draft: AnswerDraft = { ...current };
  switch (axis) {
    case 'sex': {
      // A tile group never reports a clear, so a `null` here is a fault rather than
      // a gesture, and there is no honest way to apply it.
      if (raw === null || !isSexCategory(raw)) return null;
      draft.sex = raw;

      // The one answer on this form that can invalidate another. Weight classes are
      // published per sex, so a class chosen under the old answer may not exist under
      // the new one -- and carrying it over is worse than it sounds. It does not error
      // and it does not show: `gradeStanding` finds no table keyed on a class the new
      // ladder has never heard of, and the report says this federation publishes no
      // standards for the combination. That sentence is about the federation, the
      // reader has no way to see it is about their own stale answer, and the fix is
      // one they would never find. Dropped instead, which puts the axis back in
      // `unsettled` and asks the question again.
      //
      // Only when it is genuinely absent. The two ladders overlap heavily in the
      // middle in real catalogues, and discarding an answer both ladders publish
      // would be this screen erasing something the reader typed for no reason.
      const { weightClassId } = draft;
      if (
        weightClassId !== undefined &&
        !weightClassesFor(vocabulary, raw).some((weightClass) => weightClass.id === weightClassId)
      ) {
        return clearIdentifier(draft, 'weightClassId');
      }
      return draft;
    }
    case 'equipment':
      return writeIdentifier(draft, 'equipmentId', vocabulary.equipment, raw);
    case 'weight-class':
      // The ladder in force, taken from the proposal rather than reselected here.
      // Reselecting would mean merging answers over defaults a second time, and the
      // copy that drifts is the one that decides whether an answer is accepted.
      return writeIdentifier(draft, 'weightClassId', weightClassOptions, raw);
    case 'division':
      return writeIdentifier(draft, 'divisionId', vocabulary.divisions, raw);
    case 'tested':
      if (raw === TESTED_YES) {
        draft.tested = true;
        return draft;
      }
      if (raw === TESTED_NO) {
        draft.tested = false;
        return draft;
      }
      return null;
  }
}

/** Writes a published identifier, or removes the answer when the picker cleared. */
function writeIdentifier(
  draft: AnswerDraft,
  key: IdentifierAxis,
  published: readonly (EquipmentCategory | WeightClass | AgeDivision)[],
  raw: string | null,
): Partial<ResolvedRegistration> | null {
  if (raw === null) return clearIdentifier(draft, key);
  if (!published.some((item) => item.id === raw)) return null;
  draft[key] = raw;
  return draft;
}

/**
 * Takes one identifier answer back off the draft.
 *
 * `delete` and not `= undefined`. `exactOptionalPropertyTypes` refuses the
 * assignment, and it is right to: a key holding `undefined` survives the spread in
 * `resolveRegistration` and blanks the default underneath, so an axis the reader
 * cleared would go from "back to what your results say" to unanswerable.
 *
 * Spelled out one key at a time rather than as `delete draft[key]`, and the switch is
 * worth its three lines twice over. A computed `delete` is deoptimising on every engine
 * that tracks object shapes, and -- the reason it is written this way here -- an
 * exhaustive switch stops compiling the day a fourth identifier axis is added, where
 * the dynamic form would silently keep clearing only the three it was written for.
 */
function clearIdentifier(draft: AnswerDraft, key: IdentifierAxis): AnswerDraft {
  switch (key) {
    case 'equipmentId':
      delete draft.equipmentId;
      return draft;
    case 'weightClassId':
      delete draft.weightClassId;
      return draft;
    case 'divisionId':
      delete draft.divisionId;
      return draft;
  }
}

/** What the archive printed, or nothing where it printed nothing. */
function observedLine(proposal: CategoryProposal<unknown>): TemplateResult | typeof nothing {
  if (proposal.observed === null) return nothing;
  return html`<p class="observed">
    ${ANSWER_NOTES.observedPrefix} <strong>${proposal.observed}</strong>.
  </p>`;
}

/** The same line for the one axis whose observation is a boolean. */
function observedTested(proposal: TestedProposal): TemplateResult | typeof nothing {
  if (proposal.observed === null) return nothing;
  return html`<p class="observed">
    ${ANSWER_NOTES.observedPrefix}
    <strong>${proposal.observed ? 'a drug-tested meet' : 'an untested meet'}</strong>.
  </p>`;
}

/** The chosen tile for a tri-state answer, where the third state is "unanswered". */
function testedValue(tested: boolean | undefined): string | null {
  if (tested === undefined) return null;
  return tested ? TESTED_YES : TESTED_NO;
}

/**
 * What each recorded age admits, one group per age, ambiguity intact.
 *
 * Grouped rather than merged because the sentence a reader needs is "at 39 -- or
 * 40, the archive does not say -- you were eligible for these", and a merged list
 * cannot say it. The reading qualifier is printed only against an approximate age:
 * every candidate of an exact age reaches it on either reading by construction, so
 * printing it there would put a hedge against a figure the source was sure of.
 */
function renderDivisionsByAge(
  byAge: readonly AgeDivisionCandidates[],
): TemplateResult | typeof nothing {
  const [first] = byAge;
  if (first === undefined) return html`<p class="note">${ANSWER_NOTES.divisionsUnknownAge}</p>`;

  return html`
    <p class="note">${ANSWER_NOTES.divisionsByAge}</p>
    <ul class="by-age">
      ${byAge.map(
        (group) =>
          html`<li>
            <span class="age">
              ${ageLabel(group.age.years, group.age.approximate)} on
              <time datetime=${group.age.on}>${group.age.on}</time>
            </span>
            <ul class="candidates">
              ${group.candidates.map(
                (candidate) =>
                  html`<li>
                    ${candidate.division.label}
                    ${
                      group.age.approximate
                        ? html`<span class="support"
                            >${AGE_READING_SUPPORT[candidate.support]}</span
                          >`
                        : nothing
                    }
                  </li>`,
              )}
            </ul>
          </li>`,
      )}
    </ul>
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-registration-answers': PtkRegistrationAnswers;
  }

  /**
   * So a consumer listening on a container gets the detail typed without a cast.
   *
   * The augmentation is what makes the alternative unnecessary: `as
   * CustomEvent<RegistrationAnswersDetail>` is an assertion that keeps compiling
   * after the detail changes shape, on the one event in this tool that carries the
   * answers every grade is read under.
   */
  interface HTMLElementEventMap {
    [REGISTRATION_ANSWERS_EVENT]: CustomEvent<RegistrationAnswersDetail>;
  }
}
