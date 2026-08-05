// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The second way in: find a lifter in a published results archive.
 *
 * The brief asks for "a date range and an openpowerlifting profile or URL", and this
 * is the profile half. What it produces is the same `AthleteEntry[]` the form above
 * it produces by hand, so everything downstream is untouched by which route a result
 * arrived through -- which is the point. An import that produced a privileged kind of
 * result would be an import a reader could not correct.
 *
 * IT ASSISTS AND IT DOES NOT LOCK ANYBODY IN
 *
 * Nothing this panel finds is final. The results land in the same editable log,
 * every registration answer they suggest is a proposal rather than a selection, and
 * a reader who never touches this panel loses no capability at all. That is the
 * project's first rule about this route and not a nicety: an archive is a mirror of
 * somebody else's transcription of a scoresheet, and the lifter reading the screen
 * is the better authority on their own results.
 *
 * IT NEVER PICKS BETWEEN TWO PEOPLE
 *
 * Folding a name to a lookup key is lossy, so two real people collide -- on the real
 * corpus, thousands of them. Every match is shown and the reader chooses. Section
 * 5.5's ambiguity rule, applied to a person: merging two histories would put
 * somebody else's total on the screen that tells a lifter whether they may enter a
 * meet, and there is no version of that mistake anybody could notice.
 *
 * WHAT IT KNOWS ABOUT PRIVACY
 *
 * Section 2.3 is sharper for this panel than for anything else in the collection,
 * because the subject of the lookup need not be the person operating it. The brief's
 * second audience is a meet director checking a registration, and that person has
 * consented to nothing beyond their results being public. So: nothing is persisted,
 * nothing is logged, no name or address goes into an error, and none of it crosses
 * the frame boundary to an embedding parent. A pasted link is read locally by
 * `readProfileQuery` and never fetched. The panel says all of this on screen rather
 * than in a policy, because the reader has no other way to find out.
 *
 * THE TRANSPORT IS NOT HERE EITHER
 *
 * The archive is a property and the search is an event. This element holds no
 * `DataSource`, computes no shard, and issues no request; a consumer wires those,
 * exactly the way it wires the classification standards. See
 * {@link ATHLETE_SEARCH_EVENT}.
 */
import type { AthleteHistory, AthleteMirrorInfo } from '@platform-toolkit/data-contracts';
import {
  CHOICE_CHANGE_EVENT,
  TEXT_FIELD_CHANGE_EVENT,
  type Choice,
  type ChoiceChangeDetail,
  type TextFieldChangeDetail,
} from '@platform-toolkit/ui';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import { readProfileQuery, type ProfileQueryProblem } from '../core/profile.js';

import { IMPORT_NOTES, PROFILE_QUERY_PROBLEMS, athleteMatchLabel } from './copy.js';
import { PICKER_ATHLETE, PICKER_DATASET_KEY, datasetOn } from './pickers.js';

/**
 * What a lookup came back with, or that one is still running.
 *
 * A union of two properties rather than one, because `matches` and "we are still
 * asking" are answers to different questions and a consumer sets them at different
 * moments. See {@link PtkProfileImport.lookup} for the shape of the answer itself,
 * which is the seam's and not this element's.
 */
export type LookupStatus =
  /** No search has been asked for, or the last one has settled. */
  | 'idle'
  /** A search is in flight. */
  | 'searching'
  /** The archive could not be read. Not the same as finding nobody. */
  | 'failed';

/**
 * What came back from a lookup by name.
 *
 * Structurally the seam's `AthleteLookup`, restated here because this package does
 * not depend on `data-access` and must not start: the element takes a shape, not a
 * transport. A consumer with its own archive satisfies this with two fields.
 */
export type AthleteMatches =
  /** Nothing in the input can be indexed: punctuation, or a script the fold drops. */
  | { readonly outcome: 'unusable' }
  /** The archive was read. Empty means nobody by that name; more than one is normal. */
  | { readonly outcome: 'found'; readonly matches: readonly AthleteHistory[] };

/** What the reader wants looked up. */
export interface AthleteSearchDetail {
  /**
   * The term, as the reader wrote it or as it was read out of a pasted link.
   *
   * Deliberately not folded. Which characters survive a fold is a property of how
   * the archive is indexed, and a caller that folded first would break silently the
   * day the indexing changed -- the two sides would stop meeting and the symptom
   * would be a lookup that finds nobody, which is a real answer for most names and
   * so would never be investigated.
   */
  readonly term: string;
}

/** Event name, exported so a listener cannot misspell it. */
export const ATHLETE_SEARCH_EVENT = 'ptk-athlete-search';

/** Which lifter, of the ones the archive offered, the reader meant. */
export interface AthleteChosenDetail {
  readonly athlete: AthleteHistory;
}

/** Event name, exported so a listener cannot misspell it. */
export const ATHLETE_CHOSEN_EVENT = 'ptk-athlete-chosen';

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
export const PROFILE_IMPORT_TAG = 'ptk-profile-import';

export class PtkProfileImport extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .note {
      margin: 0 0 var(--ptk-space-md);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
      overflow-wrap: anywhere;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-sm);
      margin-top: var(--ptk-space-sm);
    }

    /*
     * A button in a flex row will not shrink below its content, and Chromium sizes a
     * button's min-content inline size as its max-content size -- so a label at 200%
     * text is wider than a 320px column and the page scrolls sideways. The cap turns
     * that into a wrapped label (section 5.8).
     */
    .actions ptk-button {
      max-width: 100%;
    }

    .answer {
      margin-top: var(--ptk-space-md);
    }

    .matches {
      margin-top: var(--ptk-space-md);
    }

    .chosen {
      margin-top: var(--ptk-space-md);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    .chosen-name {
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .chosen p {
      margin: var(--ptk-space-xs) 0 0;
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    /*
     * The credit, the coverage sentence and the two counts. Last on the panel and
     * quiet, because it is what the archive asks for rather than what the reader
     * came for -- but never behind a disclosure, because a licence credit that has
     * to be opened has not been given.
     */
    .archive {
      margin-top: var(--ptk-space-lg);
      padding-top: var(--ptk-space-md);
      border-top: 1px solid var(--ptk-color-border);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    .archive h3 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text);
    }

    .archive p {
      margin: 0 0 var(--ptk-space-xs);
      overflow-wrap: anywhere;
    }

    /* Two short figures across, stacking before either can outgrow the column. */
    .counts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
      gap: var(--ptk-space-xs);
      margin: var(--ptk-space-sm) 0 0;
    }

    .counts dt {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .counts dd {
      margin: 0;
      font-weight: 600;
      color: var(--ptk-color-text);
    }

    /*
     * On its own line and never in the sentence above it. A link set in running text
     * is exactly as tall as its line box, and vertical padding on an inline box grows
     * the hit area without growing the line -- so a 44px target ends up overlapping
     * the prose and a thumb aimed at a sentence opens a new tab. The same shape the
     * meet reading and the conversion chart both settled on -- in the meet reading's
     * case only after check:narrow reported nine failures across five passes, which
     * is to say nobody caught it by reading (section 5.7).
     *
     * The accent is set explicitly because tokens.css styles links at document level
     * and cannot reach into a shadow root. The underline stays: colour is never the
     * only signal that something is a link.
     */
    .source-link {
      display: inline-flex;
      align-items: center;
      min-height: var(--ptk-tap-target-min);
      color: var(--ptk-color-accent);
      overflow-wrap: anywhere;
    }
  `;

  /**
   * What archive this build published, or `null` if it published none.
   *
   * `null` renders nothing at all -- not an empty panel, not a disabled search box.
   * The archive is an optional part of a build, and a search control over an archive
   * that is not there is a control that can only disappoint. The manual route above
   * this is complete on its own, which is what makes rendering nothing the honest
   * answer rather than a degraded one.
   */
  @property({ attribute: false }) mirror: AthleteMirrorInfo | null = null;

  /** What the last search came back with, or `null` before the first one. */
  @property({ attribute: false }) lookup: AthleteMatches | null = null;

  /** Whether {@link lookup} is the answer yet. */
  @property({ attribute: false }) status: LookupStatus = 'idle';

  /**
   * Which of {@link lookup}'s matches the reader picked, by position.
   *
   * By position and not by the lifter's key, because a key is exactly what these
   * candidates share -- they are shown together because they fold to one. Held here
   * rather than fed back down from a consumer so that the selected tile and the "whose
   * results are these" banner cannot disagree; a consumer that sets `importedEntries`
   * itself is answering the same question a second way and owns the contradiction.
   */
  @state() private chosenIndex: number | null = null;

  /** What is in the field. */
  @state() private typed = '';

  /** Why the field could not be turned into a search, if it could not. */
  @state() private problem: ProfileQueryProblem | null = null;

  /**
   * The term the last search was dispatched with, when it came out of a link.
   *
   * Kept so the panel can print what it read. A link to the wrong page and a
   * misspelled name give the same empty answer, and only one of them is the reader's
   * mistake; without the term on screen there is no way to tell which happened.
   */
  @state() private readFromLink: string | null = null;

  /**
   * Who the reader last handed to the reading below, by name.
   *
   * Deliberately not derived from {@link chosenIndex}, and deliberately not cleared
   * when a new search arrives. The tile that is lit and the lifter the reading is
   * built from are two different facts, and they come apart the moment somebody
   * searches a second name: the index is meaningless against a new list and has to
   * go, but the results underneath are still the first lifter's until another tile is
   * pressed. Derived from the index, the banner saying whose results these are would
   * disappear while the results themselves stayed -- taking away the one line that
   * makes an imported reading attributable, at exactly the moment two people are in
   * play.
   */
  @state() private chosenName: string | null = null;

  /**
   * The two child events, wired here rather than in the template.
   *
   * Both are `composed`, so they reach this host from inside a child's shadow root
   * and a listener on the host catches every one. A template binding could not: Lit
   * needs a literal event name in the markup, and the names are constants precisely
   * so that neither side can misspell one.
   */
  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(TEXT_FIELD_CHANGE_EVENT, this.#onTyped);
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
  }

  /**
   * Forgets the last pick whenever the answer changes.
   *
   * Without this the tile index survives into a different list of matches and
   * selects whoever now happens to be in that position -- a different person, with
   * no interaction to blame it on. Cleared on `lookup` and not on `status`, because
   * a failed read leaves the previous answer on screen and the pick with it.
   */
  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('lookup')) this.chosenIndex = null;
  }

  protected override async getUpdateComplete(): Promise<boolean> {
    const done = await super.getUpdateComplete();
    const children =
      this.shadowRoot?.querySelectorAll(
        'ptk-text-field, ptk-button, ptk-choice-group, ptk-notice',
      ) ?? [];
    await Promise.all(
      [...children]
        .filter((child): child is LitElement => child instanceof LitElement)
        .map((child) => child.updateComplete),
    );
    return done;
  }

  override render(): TemplateResult | typeof nothing {
    const { mirror } = this;
    if (mirror === null) return nothing;

    return html`
      <p class="note">${IMPORT_NOTES.privacy}</p>
      ${this.#renderSearch()} ${this.#renderAnswer()} ${this.#renderChosen()}
      ${this.#renderArchive(mirror)}
    `;
  }

  /**
   * The field and the button.
   *
   * `Enter` is handled on the wrapper rather than left to a form. There is no form
   * element here -- one would submit and navigate the page away, taking the whole
   * reading with it -- but a phone's keyboard shows a Go key regardless, and a
   * search box that ignores it reads as broken. The listener is on the wrapper so
   * that a key pressed anywhere in the row reaches it: a `keydown` inside
   * `ptk-text-field`'s shadow root is retargeted to the host on the way out, so a
   * listener on the field element itself would work and a check of `event.target`
   * would not.
   */
  #renderSearch(): TemplateResult {
    const error = this.problem === null ? '' : PROFILE_QUERY_PROBLEMS[this.problem];

    return html`<div @keydown=${this.#onKeyDown}>
      <ptk-text-field
        label=${IMPORT_NOTES.label}
        hint=${IMPORT_NOTES.hint}
        .value=${this.typed}
        error=${error}
        capitalize="words"
      ></ptk-text-field>
      <div class="actions">
        <ptk-button variant="secondary" @click=${this.#search}>${IMPORT_NOTES.search}</ptk-button>
      </div>
    </div>`;
  }

  /** What the archive said, in the four shapes it can say it. */
  #renderAnswer(): TemplateResult | typeof nothing {
    if (this.status === 'searching') {
      return html`<div class="answer">
        <ptk-notice tone="info">${IMPORT_NOTES.searching}</ptk-notice>
      </div>`;
    }
    if (this.status === 'failed') {
      return html`<div class="answer">
        <ptk-notice tone="error">${IMPORT_NOTES.failed}</ptk-notice>
      </div>`;
    }

    const { lookup } = this;
    if (lookup === null) return nothing;
    if (lookup.outcome === 'unusable') {
      return html`<div class="answer">
        <ptk-notice tone="info">${IMPORT_NOTES.unusable}</ptk-notice>
      </div>`;
    }

    const [first] = lookup.matches;
    if (first === undefined) {
      return html`
        ${this.#renderReadFromLink()}
        <div class="answer"><ptk-notice tone="info">${IMPORT_NOTES.none}</ptk-notice></div>
      `;
    }

    return html` ${this.#renderReadFromLink()} ${this.#renderMatches(lookup.matches)} `;
  }

  /** What was read out of a pasted link, where the search came from one. */
  #renderReadFromLink(): TemplateResult | typeof nothing {
    const { readFromLink } = this;
    if (readFromLink === null) return nothing;
    return html`<p class="note">${IMPORT_NOTES.readFromLink} ${readFromLink}</p>`;
  }

  /**
   * The lifters the archive offered, as tiles rather than as a dropdown.
   *
   * Same reason the registration picker uses tiles: these are by construction the
   * names hardest to tell apart -- they are shown together precisely because they
   * fold to one key -- and a native select collapses to the chosen line, so telling
   * two apart means opening it and reading two nearly identical strings against each
   * other on a phone. Tiles keep every candidate on screen while the choice is being
   * made.
   *
   * One match still gets a tile and is never chosen automatically. The archive
   * having exactly one person under a spelling is not evidence that it is the right
   * person, and the tool has no way to acquire that evidence -- so it asks.
   *
   * The tile's value is the position in this list and not the lifter's key, because
   * a key is exactly what these candidates share.
   */
  #renderMatches(matches: readonly AthleteHistory[]): TemplateResult {
    const choices: readonly Choice[] = matches.map((match, index) => ({
      value: String(index),
      label: athleteMatchLabel(match),
    }));
    const note = matches.length === 1 ? IMPORT_NOTES.oneMatchNote : IMPORT_NOTES.matchesNote;

    return html`<div class="matches">
      <p class="note">${note}</p>
      <div data-picker=${PICKER_ATHLETE}>
        <ptk-choice-group
          label=${IMPORT_NOTES.matchesHeading}
          .choices=${choices}
          .value=${this.chosenIndex === null ? null : String(this.chosenIndex)}
        ></ptk-choice-group>
      </div>
    </div>`;
  }

  /** Whose results are in the reading below, once somebody has been picked. */
  #renderChosen(): TemplateResult | typeof nothing {
    const { chosenName } = this;
    if (chosenName === null) return nothing;
    return html`<div class="chosen">
      <span class="chosen-name">${IMPORT_NOTES.chosen} ${chosenName}</span>
      <p>${IMPORT_NOTES.chosenNote}</p>
    </div>`;
  }

  /**
   * The credit, the coverage and the size of the archive.
   *
   * All four come from the published artifact rather than from this file. The credit
   * is somebody else's sentence about their own work, and a build that changed the
   * data must not be able to leave the old credit on the page; the coverage sentence
   * is the only thing standing between "not found" and a reader concluding they have
   * never competed.
   */
  #renderArchive(mirror: AthleteMirrorInfo): TemplateResult {
    return html`<div class="archive">
      <h3>${IMPORT_NOTES.archiveHeading}</h3>
      <p>${mirror.label}</p>
      <p>${mirror.scopeNote}</p>
      <p>${mirror.attribution}</p>
      <dl class="counts">
        <div>
          <dt>${IMPORT_NOTES.athleteCountLabel}</dt>
          <dd>${formatCount(mirror.athleteCount)}</dd>
        </div>
        <div>
          <dt>${IMPORT_NOTES.entryCountLabel}</dt>
          <dd>${formatCount(mirror.entryCount)}</dd>
        </div>
      </dl>
      <a class="source-link" href=${mirror.sourceUrl} rel="noreferrer noopener" target="_blank"
        >${IMPORT_NOTES.sourceLink}</a
      >
    </div>`;
  }

  readonly #onTyped = (event: CustomEvent<TextFieldChangeDetail>): void => {
    this.typed = event.detail.value;
    // Cleared on the first keystroke rather than on the next press. An error that
    // survives the correction it asked for reads as a field that is refusing input.
    this.problem = null;
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return;
    // The default would be nothing here -- there is no form to submit -- but a host
    // page that wrapped the tool in one would navigate away, and the whole reading
    // is in this tab.
    event.preventDefault();
    this.#search();
  };

  /**
   * Turns what is in the field into a search, or says why it cannot.
   *
   * A bound method rather than a handler taking an event, because two things call
   * it: the button and the Enter key.
   */
  readonly #search = (): void => {
    const reading = readProfileQuery(this.typed);
    if (!reading.ok) {
      this.problem = reading.problem;
      return;
    }

    this.problem = null;
    this.readFromLink = reading.source === 'link' ? reading.term : null;
    this.dispatchEvent(
      new CustomEvent<AthleteSearchDetail>(ATHLETE_SEARCH_EVENT, {
        detail: { term: reading.term },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /**
   * Reports which lifter the reader picked.
   *
   * Guarded on the picker name even though this element owns the only choice group
   * in its own shadow root, because `composed` events travel *inward* to nothing and
   * outward to everything: the guard is what stops this handler from being wired, by
   * some later edit, to a control that is not this one. Every handler in this tool
   * checks it, and the one that did not is the bug the key exists for -- see
   * `pickers.ts`.
   */
  readonly #onChoice = (event: CustomEvent<ChoiceChangeDetail>): void => {
    if (datasetOn(event, PICKER_DATASET_KEY) !== PICKER_ATHLETE) return;
    const { lookup } = this;
    if (lookup?.outcome !== 'found') return;

    const index = Number(event.detail.value);
    const athlete = lookup.matches[index];
    if (athlete === undefined) return;

    this.chosenIndex = index;
    this.chosenName = athlete.name;
    this.dispatchEvent(
      new CustomEvent<AthleteChosenDetail>(ATHLETE_CHOSEN_EVENT, {
        detail: { athlete },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

/**
 * A count, grouped.
 *
 * Ninety-four thousand lifters printed as `94236` is a string a reader has to count
 * the digits of, and the figure is on screen to be judged at a glance -- it is what
 * turns "not found" from a verdict into a coverage question. The reader's own locale
 * decides the separator, which is the one part of this the tool has no opinion on.
 */
function formatCount(count: number): string {
  return count.toLocaleString();
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-profile-import': PtkProfileImport;
  }

  interface HTMLElementEventMap {
    [ATHLETE_SEARCH_EVENT]: CustomEvent<AthleteSearchDetail>;
    [ATHLETE_CHOSEN_EVENT]: CustomEvent<AthleteChosenDetail>;
  }
}
