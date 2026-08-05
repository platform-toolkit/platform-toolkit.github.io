// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The whole tool, on one page, in the order somebody actually works.
 *
 * Results, then which of them to read, then how this federation would register the
 * lifter, then what that comes to -- with a meet's own criteria folded in on top
 * when one is picked. Four elements below this one each answer a piece of that, and
 * this element owns the only thing none of them can: the state that connects them.
 *
 * WHY THE SEQUENCE IS DOWN THE PAGE AND NOT BEHIND STEPS
 *
 * A wizard would be the obvious shape and it would be wrong for the question this
 * tool asks. The point of the screen is that a grade is a consequence of five
 * answers, and a lifter has to be able to change one of those answers and watch the
 * figure move. Behind steps that is three taps and a rebuild of the reader's mental
 * model; down one page it is a tap and a glance. It also means nothing is ever
 * hidden at the moment somebody is deciding whether to trust it, which is section
 * 29's requirement expressed as layout.
 *
 * THE TRANSPORT IS NOT HERE
 *
 * Every artifact this needs arrives as a property: the catalogue, the classification
 * tables, the meet book, the imported history, and the day. Nothing below the page
 * entry reads the network or the clock (section 15), which is what lets the whole
 * tool be driven from a fixture in a test and embedded by a consumer with its own
 * data source.
 *
 * AND NEITHER IS A CLOCK
 *
 * `today` is a property for the same reason. A meet's timing badge is the one thing
 * on the screen that changes without anybody touching it, and an element that read
 * `new Date()` would be a component whose test passes until the day the meet closes.
 */
import type {
  AthleteEntry,
  ClassificationTable,
  QualifyingMeetBook,
  SexCategory,
} from '@platform-toolkit/data-contracts';
import {
  CHOICE_CHANGE_EVENT,
  DATE_FIELD_CHANGE_EVENT,
  SELECT_CHANGE_EVENT,
  type Choice,
  type ChoiceChangeDetail,
  type DateFieldChangeDetail,
  type SelectChangeDetail,
  type SelectOption,
} from '@platform-toolkit/ui';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import { findQualifyingMeet, meetTiming, readMeetCriteria } from '../core/criteria.js';
import { collectStandings } from '../core/history.js';
import { proposeRegistration, resolveRegistration } from '../core/registration.js';
import { gradeStanding } from '../core/standing.js';
import { performanceWindow, type PerformanceWindowResult } from '../core/window.js';
import type {
  CalendarDay,
  CatalogVocabulary,
  ObservedStanding,
  ResolvedRegistration,
  StandingReport,
} from '../types.js';

import { CHECK_NOTES, WINDOW_PROBLEMS, observedRegistrationLabel } from './copy.js';
import {
  REGISTRATION_ANSWERS_EVENT,
  type RegistrationAnswersDetail,
} from './ptk-registration-answers.js';
import { RESULT_ENTERED_EVENT, type ResultEnteredDetail } from './ptk-result-form.js';
import { RESULT_REMOVED_EVENT, type ResultRemovedDetail } from './ptk-result-log.js';
import type { StandardsStatus } from './ptk-standing-report.js';

/** The `data-` key naming which of the two date fields reported. */
const BOUND_DATASET_KEY = 'bound';
const BOUND_FROM = 'from';
const BOUND_TO = 'to';

/**
 * The `data-` key naming the two pickers this element owns.
 *
 * Both handlers below check it, and neither is optional. Every control on this
 * screen is inside this element's shadow tree, and a `ptk-choice-group` or
 * `ptk-select` change is composed -- so the registration answers' five controls
 * report to their own element *and* arrive here. Without the key a sex tile reads
 * as a standing tile, and a weight-class selection reads as a meet identifier:
 * `findQualifyingMeet` then finds nothing, and the screen answers a question about
 * a lifter's weight class with "that meet is not in the published list".
 */
const PICKER_DATASET_KEY = 'picker';
const PICKER_STANDING = 'standing';
const PICKER_MEET = 'meet';

/** What the meet select reports when the reader picks nothing. */
const NO_MEET = '';

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
export const QUALIFICATION_CHECK_TAG = 'ptk-qualification-check';

/** Fired when the reading needs a set of published standards it has not been given. */
export const STANDARDS_NEEDED_EVENT = 'ptk-qualification-standards-needed';

/** Which partition of a federation's classification standards the reading wants. */
export interface StandardsNeededDetail {
  readonly sex: SexCategory;
  readonly equipmentId: string;
}

export class PtkQualificationCheck extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    section {
      margin-bottom: var(--ptk-space-xl);
    }

    h2 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-lg);
      line-height: 1.2;
    }

    .note {
      margin: 0 0 var(--ptk-space-md);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    .intro {
      margin: 0 0 var(--ptk-space-lg);
      font-size: var(--ptk-font-size-md);
      overflow-wrap: anywhere;
    }

    /*
     * Two dates side by side above about 26rem and stacked below it. The min()
     * wrapper is what keeps a track from outgrowing a 320px column, which is the one
     * thing that may never happen here (section 5.7).
     */
    .dates {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
      gap: var(--ptk-space-sm);
    }

    .log {
      margin-top: var(--ptk-space-lg);
    }

    .problems {
      margin-top: var(--ptk-space-sm);
    }
  `;

  /**
   * A history that arrived from the archive, if one did.
   *
   * Read once, into the list below, rather than merged on every render. The list is
   * editable -- a reader may take a result out of the reckoning, and may type one in
   * beside the imported ones -- and a merge would either lose those edits on the next
   * render or need a second structure recording which imported results had been
   * withdrawn. One list has one index space, which is what the log's remove control
   * addresses (section 2.3 also has a hand in this: nothing here is persisted, so the
   * list is gone with the tab either way).
   *
   * Setting this again replaces the whole list, typed results included. That is the
   * honest reading of a second import -- a different lifter's history is a different
   * question -- but it does mean a consumer must set it when a profile is imported and
   * not rebuild the array on every render.
   */
  @property({ attribute: false }) importedEntries: readonly AthleteEntry[] = [];

  /** This federation's equipment, weight classes and divisions. */
  @property({ attribute: false }) vocabulary: CatalogVocabulary | null = null;

  /**
   * The classification tables to grade against.
   *
   * Every table the consumer has, not every table that exists. A federation's
   * standards are published one partition per sex and equipment category, and a
   * consumer reading them over a network will hold one partition at a time -- which
   * is why {@link STANDARDS_NEEDED_EVENT} exists to say which one. A consumer that
   * has them all may set them all and ignore the event; nothing here filters, so a
   * table for another category simply never matches a query.
   */
  @property({ attribute: false }) tables: readonly ClassificationTable[] = [];

  /**
   * Whether {@link tables} is the answer yet.
   *
   * Passed straight down to the report, which is the only screen that reads a table.
   * See `StandardsStatus` for why an empty list needs a status beside it and why
   * there are three of them rather than four.
   */
  @property({ attribute: false }) standardsStatus: StandardsStatus = 'ready';

  /** The transcribed meets, or `null` where none have been published. */
  @property({ attribute: false }) book: QualifyingMeetBook | null = null;

  /** The day the page is being read on, `YYYY-MM-DD`. Supplied, never read. */
  @property({ attribute: false }) today: CalendarDay | null = null;

  /** Every result the reading is built from, imported and typed alike. */
  @state() private entries: readonly AthleteEntry[] = [];

  /** The dates the reader narrowed to, or empty for "everything". */
  @state() private from = '';
  @state() private to = '';

  /**
   * Which registration is being read, by its own key.
   *
   * By key and not by index, because the standings are rebuilt from scratch whenever
   * a result is added or removed and their order can change under a stored index --
   * which would silently move the reader onto somebody else's weight class.
   */
  @state() private standingKey: string | null = null;

  /** What the reader answered on the five axes. */
  @state() private answers: Partial<ResolvedRegistration> = {};

  /** The meet whose criteria are being read as well, or `null`. */
  @state() private meetId: string | null = null;

  /**
   * The partition already asked for, so it is asked for once.
   *
   * A plain field and not `@state`: it records what has been announced, and a change
   * to it must never itself cause a render -- which, since it is written from
   * `updated`, would be a loop.
   */
  #asked: string | null = null;

  readonly #onEntered = (event: CustomEvent<ResultEnteredDetail>): void => {
    this.entries = [...this.entries, event.detail.entry];
  };

  readonly #onRemoved = (event: CustomEvent<ResultRemovedDetail>): void => {
    const { index } = event.detail;
    this.entries = this.entries.filter((_, position) => position !== index);
  };

  readonly #onAnswers = (event: CustomEvent<RegistrationAnswersDetail>): void => {
    this.answers = event.detail.answers;
  };

  readonly #onDate = (event: CustomEvent<DateFieldChangeDetail>): void => {
    const bound = datasetOn(event, BOUND_DATASET_KEY);
    if (bound === BOUND_FROM) this.from = event.detail.value;
    if (bound === BOUND_TO) this.to = event.detail.value;
  };

  readonly #onChoice = (event: CustomEvent<ChoiceChangeDetail>): void => {
    if (datasetOn(event, PICKER_DATASET_KEY) !== PICKER_STANDING) return;
    const standing = this.#standings()[Number(event.detail.value)];
    if (standing === undefined) return;
    this.#selectStanding(standing.key);
  };

  readonly #onSelect = (event: CustomEvent<SelectChangeDetail>): void => {
    if (datasetOn(event, PICKER_DATASET_KEY) !== PICKER_MEET) return;
    const { value } = event.detail;
    this.meetId = value === null || value === NO_MEET ? null : value;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(RESULT_ENTERED_EVENT, this.#onEntered);
    this.addEventListener(RESULT_REMOVED_EVENT, this.#onRemoved);
    this.addEventListener(REGISTRATION_ANSWERS_EVENT, this.#onAnswers);
    this.addEventListener(DATE_FIELD_CHANGE_EVENT, this.#onDate);
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.addEventListener(SELECT_CHANGE_EVENT, this.#onSelect);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('importedEntries')) {
      this.entries = this.importedEntries;
      this.#selectStanding(null);
    }
  }

  /**
   * Says which standards the screen now needs, when that changes.
   *
   * The partition turns on a merge -- the proposal's defaults under the reader's
   * answers -- and the proposal is built from the chosen standing and the date window,
   * both of which are private state in here. A consumer watching
   * {@link REGISTRATION_ANSWERS_EVENT} could read the two axes off the answers today,
   * because `mayPreselect` admits only measured proposals and both a sex letter and an
   * equipment name are spelled ones. That is not a seam worth building on. It puts a
   * copy of the merge in every consumer, which is the duplication section 5.3 forbids
   * for artifact names and for the same reason: the day either axis becomes measurable
   * the copy keeps compiling, the consumer stops refetching, and the report grades the
   * lifter against the last category's ladder without a word about it. It also misses
   * a switch between standings, which resets the answers from in here and fires
   * nothing.
   *
   * Fired from `updated` rather than from a handler because the property the
   * consumer sets in response is `tables`, and setting a property inside a change
   * handler that a render then reads is the reentrancy Lit's update cycle exists to
   * order. It is deliberately *not* suppressed for a programmatic property set --
   * that rule (section 5.8) is about change events reporting a value the consumer
   * just wrote, and this reports a need the consumer has not met yet. Setting
   * `importedEntries` is exactly when it must fire.
   *
   * Guarded on the pair itself and not on which properties changed: nearly every
   * keystroke on this screen changes something, and only a few of them change the
   * category. Without the guard a consumer would refetch a megabyte per date typed.
   */
  protected override updated(): void {
    const needed = this.#neededStandards();
    // A unit separator between the two, the way `history.ts` joins the parts of a
    // standing key. An equipment identifier comes from a published catalogue, and
    // joining on any character a catalogue could itself contain lets two different
    // pairs share one key -- so the second of them is never asked for, and the report
    // grades a lifter against another category's ladder without saying so. Written as
    // an escape because a literal control character in source turns the file binary to
    // git and its diffs stop being printed (section 2.4).
    const key = needed === null ? null : `${needed.sex}\u001F${needed.equipmentId}`;
    if (key === this.#asked) return;
    this.#asked = key;
    if (needed === null) return;

    this.dispatchEvent(
      new CustomEvent<StandardsNeededDetail>(STANDARDS_NEEDED_EVENT, {
        detail: needed,
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected override async getUpdateComplete(): Promise<boolean> {
    const done = await super.getUpdateComplete();
    const children =
      this.shadowRoot?.querySelectorAll(
        'ptk-date-field, ptk-choice-group, ptk-select, ptk-result-form, ptk-result-log,' +
          ' ptk-registration-answers, ptk-standing-report, ptk-meet-reading',
      ) ?? [];
    await Promise.all(
      [...children]
        .filter((child): child is LitElement => child instanceof LitElement)
        .map((child) => child.updateComplete),
    );
    return done;
  }

  override render(): TemplateResult {
    const { vocabulary } = this;
    if (vocabulary === null) {
      return html`<ptk-notice tone="info">${CHECK_NOTES.noVocabulary}</ptk-notice>`;
    }

    const standings = this.#standings();
    const standing = this.#standing(standings);

    return html`
      <p class="intro">${CHECK_NOTES.intro}</p>
      ${this.#renderResults()} ${this.#renderWindow()} ${this.#renderStandings(standings, standing)}
      ${standing === null ? nothing : this.#renderReading(standing, vocabulary)}
    `;
  }

  #renderResults(): TemplateResult {
    return html`<section>
      <h2>${CHECK_NOTES.resultsHeading}</h2>
      <ptk-result-form></ptk-result-form>
      <div class="log"><ptk-result-log .entries=${this.entries}></ptk-result-log></div>
    </section>`;
  }

  #renderWindow(): TemplateResult {
    const read = this.#readWindow();
    const problems = read.ok ? [] : read.problems;
    // `inverted` belongs to the pair and not to either field, and it is shown on the
    // first because that is the one a reader corrects: a range typed the wrong way
    // round is almost always a first date that should have been the second.
    const onFrom = problems.includes('inverted')
      ? WINDOW_PROBLEMS.inverted
      : problems.includes('from-unreadable')
        ? WINDOW_PROBLEMS['from-unreadable']
        : '';
    const onTo = problems.includes('to-unreadable') ? WINDOW_PROBLEMS['to-unreadable'] : '';

    return html`<section>
      <h2>${CHECK_NOTES.windowHeading}</h2>
      <p class="note">${CHECK_NOTES.windowNote}</p>
      <div class="dates">
        <div data-bound=${BOUND_FROM}>
          <ptk-date-field
            label=${CHECK_NOTES.windowFrom}
            .value=${this.from}
            error=${onFrom}
          ></ptk-date-field>
        </div>
        <div data-bound=${BOUND_TO}>
          <ptk-date-field
            label=${CHECK_NOTES.windowTo}
            .value=${this.to}
            error=${onTo}
          ></ptk-date-field>
        </div>
      </div>
    </section>`;
  }

  /**
   * The registrations the results support, as tiles rather than as a dropdown.
   *
   * Each one is five facts long and they differ from each other in one of the five.
   * A native select collapses to the chosen line and hides the others, so telling
   * two apart means opening it and reading two similar strings against each other --
   * on a phone, in a list that is scrolling. Tiles keep every option on screen while
   * the choice is being made, which is what makes the difference visible.
   *
   * The tile's value is the position in this list, not the standing's key: a key
   * carries a control character as its separator (`history.ts`), and there is no
   * reason to put one into the DOM when the element is holding the key anyway.
   */
  #renderStandings(
    standings: readonly ObservedStanding[],
    selected: ObservedStanding | null,
  ): TemplateResult {
    const [first] = standings;
    if (first === undefined) {
      return html`<section>
        <h2>${CHECK_NOTES.standingHeading}</h2>
        <ptk-notice tone="info">${CHECK_NOTES.standingEmpty}</ptk-notice>
      </section>`;
    }

    const choices: readonly Choice[] = standings.map((standing, index) => ({
      value: String(index),
      label: observedRegistrationLabel(standing.registration),
    }));
    const value = selected === null ? null : String(standings.indexOf(selected));

    return html`<section>
      <h2>${CHECK_NOTES.standingHeading}</h2>
      <p class="note">${CHECK_NOTES.standingNote}</p>
      <div data-picker=${PICKER_STANDING}>
        <ptk-choice-group
          label=${CHECK_NOTES.standingHeading}
          .choices=${choices}
          .value=${value}
        ></ptk-choice-group>
      </div>
    </section>`;
  }

  #renderReading(standing: ObservedStanding, vocabulary: CatalogVocabulary): TemplateResult {
    // The answers go in as well as over. `resolveRegistration` layers them on the
    // result, which is enough for four axes; the weight-class ladder is published per
    // sex, so that axis has to know the sex answer before it can propose anything at
    // all. See `proposeRegistration`.
    const proposal = proposeRegistration(standing, vocabulary, this.answers);
    const resolution = resolveRegistration(proposal, this.answers);

    return html`
      <section>
        <h2>${CHECK_NOTES.answersHeading}</h2>
        <ptk-registration-answers
          .proposal=${proposal}
          .vocabulary=${vocabulary}
          .answers=${this.answers}
        ></ptk-registration-answers>
      </section>
      ${
        resolution.ok
          ? html`${this.#renderMeet(standing, resolution.registration, vocabulary)}
              <section>
                <ptk-standing-report
                  .standing=${standing}
                  .report=${this.#report(standing, resolution.registration)}
                  .vocabulary=${vocabulary}
                  .standardsStatus=${this.standardsStatus}
                ></ptk-standing-report>
              </section>`
          : nothing
      }
    `;
  }

  /**
   * The meet picker, and the meet's own criteria under it.
   *
   * Rendered only once the five answers are settled, because every route below reads
   * a table selected by those answers -- a criteria screen drawn against four of them
   * would print figures from whichever table happened to match, which is the one
   * failure this tool cannot afford to make quietly.
   */
  #renderMeet(
    standing: ObservedStanding,
    registration: ResolvedRegistration,
    vocabulary: CatalogVocabulary,
  ): TemplateResult {
    const { book } = this;
    const [firstMeet] = book?.meets ?? [];
    if (book === null || firstMeet === undefined) {
      return html`<section>
        <h2>${CHECK_NOTES.meetHeading}</h2>
        <ptk-notice tone="info">${CHECK_NOTES.meetEmpty}</ptk-notice>
      </section>`;
    }

    const options: readonly SelectOption[] = book.meets.map((meet) => ({
      value: meet.id,
      label: meet.label,
    }));
    const found = this.meetId === null ? null : findQualifyingMeet(book, this.meetId);
    const reading =
      found === null
        ? null
        : readMeetCriteria(found.meet, standing, registration, {
            tables: this.tables,
            vocabulary,
            rules: found.rules,
          });

    return html`<section>
      <h2>${CHECK_NOTES.meetHeading}</h2>
      <p class="note">${CHECK_NOTES.meetNote}</p>
      <div data-picker=${PICKER_MEET}>
        <ptk-select
          label=${CHECK_NOTES.meetLabel}
          placeholder=${CHECK_NOTES.meetNone}
          .options=${options}
          .value=${this.meetId}
        ></ptk-select>
      </div>
      ${
        this.meetId !== null && found === null
          ? html`<div class="problems">
              <ptk-notice tone="error">${CHECK_NOTES.meetNotFound}</ptk-notice>
            </div>`
          : nothing
      }
      ${
        reading === null
          ? nothing
          : html`<ptk-meet-reading
              .reading=${reading}
              .timing=${this.today === null ? null : meetTiming(reading.meet, this.today)}
              .vocabulary=${vocabulary}
            ></ptk-meet-reading>`
      }
    </section>`;
  }

  #report(standing: ObservedStanding, registration: ResolvedRegistration): StandingReport {
    return gradeStanding(standing, registration, this.tables);
  }

  /**
   * Every registration inside the window, or none when the dates do not read.
   *
   * An unreadable pair of dates yields no standings rather than falling back to the
   * widest window, because the fallback would answer a question nobody asked with a
   * screen full of figures and a small error message above it. Nothing below is a
   * safe thing to show against dates that were refused.
   */
  #standings(): readonly ObservedStanding[] {
    const read = this.#readWindow();
    if (!read.ok) return [];
    return collectStandings(this.entries, read.window);
  }

  /**
   * The dates to read, with a blank field meaning "no bound on this side".
   *
   * One method rather than one for the window and another for the error messages,
   * because two would parse the same pair of strings twice and could disagree -- a
   * screen showing figures under a window it had also marked invalid is the shape
   * that bug takes, and it looks like a rendering glitch rather than a fault.
   *
   * The substitute for a blank bound is taken from the results themselves rather than
   * from a wide constant like `0001-01-01`. A constant would work, and it would also
   * print as the window on any screen that showed one; bounds drawn from the data are
   * true whether or not anybody looks at them.
   */
  #readWindow(): PerformanceWindowResult {
    const dates = [...this.entries].map((entry) => entry.date).sort();
    const [earliest] = dates;
    const latest = dates[dates.length - 1];
    if (earliest === undefined || latest === undefined) {
      // Nothing to bound and nothing to read. Reported as an empty window rather than
      // as a problem: the reader has typed no results yet, which is a state the page
      // opens in and not a mistake to mark two date fields red over.
      return { ok: false, problems: [] };
    }

    return performanceWindow(
      this.from === '' ? earliest : this.from,
      this.to === '' ? latest : this.to,
    );
  }

  /** The chosen standing, or the only one, or `null`. */
  #standing(standings: readonly ObservedStanding[]): ObservedStanding | null {
    const { standingKey } = this;
    if (standingKey !== null) {
      return standings.find((candidate) => candidate.key === standingKey) ?? null;
    }
    // Chosen for the reader only where there is nothing to choose. One standing is
    // the common case -- most lifters register the same way every time -- and making
    // them tick the single tile before anything appears is a step with no question in
    // it. Two or more is a real question and stays unanswered until they answer it.
    const [only, ...rest] = standings;
    if (only === undefined || rest.length > 0) return null;
    return only;
  }

  /**
   * The partition of this federation's standards the screen is about to read from.
   *
   * Taken from the same merge `resolveRegistration` performs rather than from its
   * result, because the result is all-or-nothing: a registration missing its division
   * does not resolve, and the reader who has answered sex and equipment but not
   * division is precisely the reader whose tables should already be arriving. Waiting
   * for a complete resolution would put the fetch after the last answer instead of
   * before it, and the lifter would watch a spinner where the grades go.
   *
   * `null` for every state in which the pair is not yet knowable -- no catalogue, no
   * chosen standing, or a proposal that settled neither axis. A consumer that gets
   * nothing keeps whatever it last loaded, which is right: the previous answer is
   * still the best one available, and `standardsStatus` is how a stale one is owned.
   */
  #neededStandards(): StandardsNeededDetail | null {
    const { vocabulary } = this;
    if (vocabulary === null) return null;
    const standing = this.#standing(this.#standings());
    if (standing === null) return null;

    const { sex, equipmentId } = {
      // Answers passed in for uniformity with `#renderReading` rather than out of
      // need: they only steer the weight-class ladder, and neither axis read here is
      // on it. One calling convention in this file beats two and a note saying why.
      ...proposeRegistration(standing, vocabulary, this.answers).defaults,
      ...this.answers,
    };
    if (sex === undefined || equipmentId === undefined) return null;
    return { sex, equipmentId };
  }

  /**
   * Moves to another registration, dropping the answers given for the last one.
   *
   * The answers are five identifiers chosen for a *particular* standing -- the
   * division somebody entered at 43 is not the division they entered at 39, and the
   * weight class follows the bodyweight recorded on the day. Carried across they
   * would look like defaults the tool had proposed, and `mayPreselect` exists
   * precisely so that nothing is proposed on that little evidence.
   */
  #selectStanding(key: string | null): void {
    this.standingKey = key;
    this.answers = {};
  }
}

/** The innermost `data-` value of one key on an event's path, or `null`. */
function datasetOn(event: Event, key: string): string | null {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    const value = target.dataset[key];
    if (value !== undefined) return value;
  }
  return null;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-qualification-check': PtkQualificationCheck;
  }

  interface HTMLElementEventMap {
    [STANDARDS_NEEDED_EVENT]: CustomEvent<StandardsNeededDetail>;
  }
}
