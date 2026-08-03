// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The tool. It owns the session; the four elements below it own none of it.
 *
 * Tools 2, 3 and 4 all landed on this shape and it is what makes a planner this
 * large testable at all: every state -- a half-typed maximum, a federation whose
 * published profile is illegal, a plan nobody has agreed to, a unit changed with
 * three hundred kilograms already on screen -- is reachable from a story and a
 * browser test by handing in a session, with no network and no storage behind it.
 *
 * WHAT THIS ROOT KNOWS THAT THE OTHERS DID NOT
 *
 * Two of its inputs are published data, and they arrive at different times and
 * for different reasons. The rule profiles are read once (`getMeetRuleProfiles`)
 * and decide what a legal weight is. The conversion chart is read *per
 * federation*, because §16 gives the pound column to the federation's own
 * printing -- and the federation here is a question the lifter answers rather
 * than something the page declares, so the chart has to be reloaded when the
 * answer changes. That is what `FEDERATION_CHANGE_EVENT` is for: this element
 * says which federation is now chosen, and `view.ts` -- the only file in the tool
 * that knows a transport exists (§5.8) -- decides what to do about it.
 *
 * EVERY ANSWER GOES THROUGH ONE PATH, AND MOST OF THEM CARRY TWO KEYS
 *
 * Controls report through the shared components' own composed events and are
 * identified by `data-field` read off `event.composedPath()` -- never
 * `event.target`, which is retargeted to this host for anything fired inside a
 * child's shadow tree and would leave every answer silently dropped (§5.8).
 * Almost every field in this tool exists once per contested lift, so the path is
 * read for `data-lift` as well, and an answer that names a lift the format does
 * not contest is dropped rather than written to a figure no control can show
 * back.
 *
 * THE PLAN IS RECOMPUTED, NEVER CACHED
 *
 * `buildPlan` is pure arithmetic over answers already in hand, and a cache would
 * introduce the one bug this shape cannot otherwise have: attempts on screen
 * belonging to a session the lifter has since changed. The one thing that *is*
 * cached is `MeetRules.from`, keyed on the profile object -- not to save the
 * work, but because a refused profile logs, and logging it on every keystroke
 * would bury the read that failed under a thousand copies of itself.
 */
import type { MeetRuleProfile, PlatformLift } from '@platform-toolkit/data-contracts';
import type { ConversionChart, WeightUnit } from '@platform-toolkit/domain';
import { MeetRules } from '@platform-toolkit/domain';
import { createPreferenceStore, type PreferenceStore } from '@platform-toolkit/preferences';
import {
  CHOICE_CHANGE_EVENT,
  NUMBER_FIELD_CHANGE_EVENT,
  TOGGLE_GROUP_CHANGE_EVENT,
  type ChoiceChangeDetail,
  type NumberFieldChangeDetail,
  type ToggleGroupChangeDetail,
} from '@platform-toolkit/ui';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import './ptk-plan-extras.js';
import './ptk-plan-method.js';
import './ptk-plan-screen.js';
import './ptk-planner-setup.js';

import {
  CONVERSION_CONFIRMATION_NOTE,
  CONVERT_ANSWER,
  conversionChoices,
  conversionQuestion,
} from './copy.js';
import {
  AGE_FIELD,
  ATTEMPT_FIELDS,
  BODYWEIGHT_FIELD,
  CEILING_FIELD,
  COMPARISON_FIELD,
  CONFIRM_FIELD,
  CONVERT_FIELD,
  EQUIPMENT_FIELD,
  EVIDENCE_AGE_FIELD,
  EXPECTED_MAXIMUM_FIELD,
  FEDERATION_FIELD,
  FIRST_MEET_FIELD,
  FORMAT_FIELD,
  GOAL_FIELD,
  GUIDED_AGE_FIELD,
  GUIDED_EQUIPMENT_FIELD,
  GUIDED_REPS_FIELD,
  GUIDED_RESERVE_FIELD,
  GUIDED_STANDARD_FIELD,
  GUIDED_WEIGHT_FIELD,
  HARD_CUT_FIELD,
  MAXIMUM_JUMP_FIELD,
  MAXIMUM_SOURCE_FIELD,
  METHOD_FIELD,
  MINIMUM_JUMP_FIELD,
  MINIMUM_TOTAL_FIELD,
  OPENER_FIELD,
  OPENER_TESTED_FIELD,
  PERSONAL_RECORD_FIELD,
  PERSONAL_RECORD_TOTAL_FIELD,
  PRIOR_MEETS_FIELD,
  QUALIFYING_TOTAL_FIELD,
  READINESS_FIELD,
  STRETCH_TOTAL_FIELD,
  TARGET_TOTAL_FIELD,
  UNIT_FIELD,
} from './fields.js';
import { CONFIRM_VALUE } from './ptk-plan-method.js';
import type { ProfilesStatus } from './ptk-planner-setup.js';
import { EMPTY_VIEW, buildPlan, type PlanContext, type PlannerView } from './plan.js';
import {
  EMPTY_SESSION,
  answerFromValue,
  comparisonFromValue,
  confirmMaximum,
  convertFigures,
  equipmentFromValue,
  evidenceAgeFromValue,
  firstMeetFromValue,
  formatFromValue,
  goalFromValue,
  hasTypedWeights,
  loadSession,
  maximumSourceFromValue,
  methodFromValue,
  readinessFromValue,
  reserveFromValue,
  saveSession,
  sessionLifts,
  unitFromValue,
  withExtras,
  withFigures,
  withSetup,
  withTargetTotal,
  withTargets,
  withUnit,
  type PlannerSession,
} from './session.js';

/** Fired when the lifter picks a federation, so the transport can follow it. */
export const FEDERATION_CHANGE_EVENT = 'ptk-meet-day-federation-change';

export interface FederationChangeDetail {
  /** The chosen profile's identifier. Never the empty string. */
  readonly federationId: string;
}

@customElement('ptk-meet-day-planner')
export class PtkMeetDayPlanner extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      gap: var(--ptk-space-xl);
      container-type: inline-size;
    }

    /*
     * The question a unit change asks, marked out from the setup above it. It
     * appears between two controls the lifter is already using, so without a
     * border it reads as a third setup question rather than as something waiting
     * on an answer.
     */
    .convert {
      display: grid;
      gap: var(--ptk-space-sm);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    .convert p {
      margin: 0;
    }

    .note {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }
  `;

  /**
   * Where the remembered answers live.
   *
   * Defaulted to a store with no backing so the element stands up in a story or
   * a test with no branch anywhere -- and so the configuration these tools
   * actually ship into, an iframe whose embedder blocked storage, is the
   * supported path rather than the exceptional one (§5.12).
   */
  @property({ attribute: false }) settings: PreferenceStore = createPreferenceStore(null);

  /** The published rule profiles, or an empty list while there are none. */
  @property({ attribute: false }) profiles: readonly MeetRuleProfile[] = [];

  @property({ type: String }) status: ProfilesStatus = 'loading';

  /**
   * The chosen federation's published conversion chart, or `null` for none.
   *
   * `null` is the state the site opens in and is not a fault: §16 gives the
   * pound column to the federation's own printing, and a federation this project
   * has not transcribed a chart for gets a stated absence rather than a computed
   * figure.
   */
  @property({ attribute: false }) chart: ConversionChart | null = null;

  @state() private session: PlannerSession = EMPTY_SESSION;

  /**
   * The unit the figures on screen were typed in, while that differs from the
   * unit they are being read in.
   *
   * Holds the *original* unit rather than the previous one, so a lifter who
   * flicks kg to lb and back finds the question gone rather than reversed -- the
   * digits never moved, and by then they are being read in the unit they were
   * typed in again.
   */
  @state() private typedIn: WeightUnit | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    this.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    this.removeEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
    super.disconnectedCallback();
  }

  /**
   * Restores from the store whenever it is handed in or swapped out.
   *
   * Not `connectedCallback`: Lit records the class-field default as changed on
   * the first update, so this runs once before the first render either way, and
   * it *also* runs when `view.ts` or a story replaces the store afterwards.
   * Restoring only on connect shows defaults over a device that remembers
   * something else, on some visits and not others.
   */
  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('settings')) {
      this.session = loadSession(this.settings);
    }
  }

  /**
   * The four children, over one session.
   *
   * `ptk-plan-method` is handed `EMPTY_VIEW` rather than the null, and the
   * fallback is load-bearing rather than defensive: a property binding *assigns*
   * null over a child's class-field default rather than leaving it alone, so the
   * child's own `view: PlannerView = EMPTY_VIEW` protects a case that never
   * arises and not this one. §7's questions have to be on screen before there is
   * a plan -- there is nothing to type a maximum into otherwise -- so the method
   * element takes the view of an unanswered session and the plan slot below
   * keeps the null, which is the only place the difference means anything.
   *
   * Getting this wrong threw on the first paint of every visit, and TypeScript
   * cannot see it: nothing type-checks a lit-html property binding.
   */
  override render(): TemplateResult {
    const view = this.#view();
    return html`
      <ptk-planner-setup
        .session=${this.session}
        .profiles=${this.profiles}
        status=${this.status}
      ></ptk-planner-setup>

      ${this.#renderConversion()}

      <ptk-plan-method .session=${this.session} .view=${view ?? EMPTY_VIEW}></ptk-plan-method>

      <ptk-plan-extras .session=${this.session}></ptk-plan-extras>

      ${this.#renderPlan(view)}
    `;
  }

  /**
   * The plan, or the one sentence that says why there is not one yet.
   *
   * Five states and only one of them is a fault, so only one of them is an error
   * tone. A rule book still loading, a corpus with nothing published in it, and a
   * federation nobody has picked are all ordinary, and a screen that greeted the
   * first of them with a warning would open by reporting a problem that resolves
   * itself in a hundred milliseconds.
   */
  #renderPlan(view: PlannerView | null): TemplateResult {
    if (view !== null) {
      return html`<ptk-plan-screen .session=${this.session} .view=${view}></ptk-plan-screen>`;
    }
    if (this.status === 'loading') {
      return html`<p class="note">The plan appears here once the rule books have loaded.</p>`;
    }
    if (this.status === 'failed') {
      return html`<p class="note">
        Without a rule book there is nothing to check an attempt against, so no plan is drawn.
      </p>`;
    }
    if (this.profiles.length === 0) {
      return html`<p class="note">
        No federation rule books have been published yet, so no plan can be drawn.
      </p>`;
    }
    if (this.#profile() === null) {
      return html`<p class="note">Choose a federation above and the plan appears here.</p>`;
    }
    // The remaining case: a profile was chosen and `MeetRules.from` refused it.
    // Named as an error because it is one, and pointed at the only action that
    // helps -- the feed is not something a lifter can fix, and another federation
    // is a working plan rather than a workaround.
    return html`<ptk-notice tone="error">
      This federation's published rule book could not be read, so attempts cannot be checked against
      it. Choosing another federation above will draw a plan.
    </ptk-notice>`;
  }

  /**
   * The unit question, which appears only when there is something to reinterpret.
   *
   * Unconditional, this would be a box on the first tap of every session --
   * tool 2's finding (§10.2), and the reason `hasTypedWeights` exists.
   */
  #renderConversion(): TemplateResult | typeof nothing {
    const typedIn = this.typedIn;
    if (typedIn === null) return nothing;
    return html`
      <div class="convert">
        <p>${conversionQuestion(typedIn)}</p>
        <ptk-choice-group
          data-field=${CONVERT_FIELD}
          label="Figures already entered"
          .choices=${conversionChoices(typedIn, this.session.setup.unit)}
          .value=${null}
        ></ptk-choice-group>
        <p class="note">${CONVERSION_CONFIRMATION_NOTE}</p>
      </div>
    `;
  }

  /** The plan for the current session, or `null` while there are no rules. */
  #view(): PlannerView | null {
    const context = this.#context();
    return context === null ? null : buildPlan(this.session, context);
  }

  #context(): PlanContext | null {
    const profile = this.#profile();
    if (profile === null) return null;
    const rules = this.#rulesFor(profile);
    return rules === null ? null : { rules, chart: this.chart };
  }

  #profile(): MeetRuleProfile | null {
    const id = this.session.setup.federationId;
    if (id === '') return null;
    return this.profiles.find((profile) => profile.id === id) ?? null;
  }

  /**
   * The chosen profile as rules, computed once per profile.
   *
   * Keyed on the object rather than on the identifier, because a fresh read of
   * the same federation is a fresh profile and may not say the same thing. The
   * cache is here for the logging rather than for the arithmetic: `render` runs
   * on every keystroke, and a refusal reported a thousand times is a refusal
   * nobody can find.
   *
   * Problem *codes* only reach the console. The messages name the federation's
   * published content, and a browser console is not where this project explains
   * somebody else's rule book to a lifter who cannot act on it.
   */
  #rulesFor(profile: MeetRuleProfile): MeetRules | null {
    const cached = this.#rulesCache;
    if (cached !== null && cached.profile === profile) return cached.rules;

    const result = MeetRules.from(profile);
    if (!result.ok) {
      console.error(
        'meet-day: a published rule profile was refused',
        result.problems.map((problem) => problem.code),
      );
    }
    const rules = result.ok ? result.rules : null;
    this.#rulesCache = { profile, rules };
    return rules;
  }

  #rulesCache: { readonly profile: MeetRuleProfile; readonly rules: MeetRules | null } | null =
    null;

  #setSession(session: PlannerSession): void {
    this.session = session;
    saveSession(this.settings, session);
  }

  readonly #onChoice = (event: CustomEvent<ChoiceChangeDetail>): void => {
    const field = fieldOf(event);
    if (field === null) return;
    const lift = this.#liftOf(event);
    this.#applyChoice(field, event.detail.value, lift);
  };

  readonly #onNumber = (event: CustomEvent<NumberFieldChangeDetail>): void => {
    const field = fieldOf(event);
    if (field === null) return;
    this.#applyNumber(field, event.detail.value, this.#liftOf(event));
  };

  /**
   * §7's confirmation, which is the only toggle group in the tool.
   *
   * Read as "is the one choice among the values" rather than as "did the values
   * change", because a toggle group reports its whole set and an untick is an
   * event carrying an empty one -- the state that withdraws an agreement.
   */
  readonly #onToggle = (event: CustomEvent<ToggleGroupChangeDetail>): void => {
    if (fieldOf(event) !== CONFIRM_FIELD) return;
    const lift = this.#liftOf(event);
    if (lift === null) return;
    this.#setSession(
      confirmMaximum(this.session, lift, event.detail.values.includes(CONFIRM_VALUE)),
    );
  };

  /**
   * Which lift a control belongs to, checked against the lifts on screen.
   *
   * A `data-lift` naming a lift this format does not contest cannot have come
   * from a control this tool rendered, and writing it would put a figure into a
   * lift with nothing to show it back -- visible only later, if the lifter
   * corrects the format and finds a number they never typed.
   */
  #liftOf(event: Event): PlatformLift | null {
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      const value = node.dataset['lift'];
      if (value === undefined) continue;
      return sessionLifts(this.session).find((lift) => lift === value) ?? null;
    }
    return null;
  }

  /**
   * Applies one chosen option.
   *
   * `dataset` and a choice value are both strings out of the DOM, and every
   * mapper below is total: an unrecognised value lands on the answer that claims
   * nothing rather than on a state no control can show back.
   */
  #applyChoice(field: string, value: string, lift: PlatformLift | null): void {
    const session = this.session;
    switch (field) {
      case FEDERATION_FIELD:
        this.#chooseFederation(value);
        return;
      case FORMAT_FIELD:
        this.#setSession(withSetup(session, { format: formatFromValue(value) }));
        return;
      case UNIT_FIELD:
        this.#chooseUnit(unitFromValue(value));
        return;
      case FIRST_MEET_FIELD:
        this.#setSession(withSetup(session, { firstMeet: firstMeetFromValue(value) }));
        return;
      case GOAL_FIELD:
        this.#setSession(withSetup(session, { goal: goalFromValue(value) }));
        return;
      case METHOD_FIELD:
        this.#setSession(withSetup(session, { method: methodFromValue(value) }));
        return;
      case CONVERT_FIELD:
        this.#answerConversion(value);
        return;
      case EQUIPMENT_FIELD:
        this.#setSession(withExtras(session, { equipment: equipmentFromValue(value) }));
        return;
      case READINESS_FIELD:
        this.#setSession(withExtras(session, { readiness: readinessFromValue(value) }));
        return;
      case HARD_CUT_FIELD:
        this.#setSession(withExtras(session, { hardCut: answerFromValue(value) }));
        return;
      case COMPARISON_FIELD:
        this.#setSession(withExtras(session, { comparison: comparisonFromValue(value) }));
        return;
      case MAXIMUM_SOURCE_FIELD:
        this.#setSession(withExtras(session, { maximumSource: maximumSourceFromValue(value) }));
        return;
      case EVIDENCE_AGE_FIELD:
        this.#setSession(withExtras(session, { evidenceAge: evidenceAgeFromValue(value) }));
        return;
      default:
        this.#applyLiftChoice(field, value, lift);
        return;
    }
  }

  /** The per-lift half of the same switch, split so neither half is unreadable. */
  #applyLiftChoice(field: string, value: string, lift: PlatformLift | null): void {
    if (lift === null) return;
    const guided = this.session.figures[lift].guided;
    switch (field) {
      case GUIDED_RESERVE_FIELD:
        this.#patchFigures(lift, { guided: { ...guided, repsInReserve: reserveFromValue(value) } });
        return;
      case GUIDED_STANDARD_FIELD:
        this.#patchFigures(lift, {
          guided: { ...guided, competitionStandard: answerFromValue(value) },
        });
        return;
      case GUIDED_AGE_FIELD:
        this.#patchFigures(lift, { guided: { ...guided, age: evidenceAgeFromValue(value) } });
        return;
      case GUIDED_EQUIPMENT_FIELD:
        this.#patchFigures(lift, { guided: { ...guided, sameEquipment: answerFromValue(value) } });
        return;
      case OPENER_TESTED_FIELD:
        this.#patchFigures(lift, { openerTested: answerFromValue(value) });
        return;
      default:
        return;
    }
  }

  /** Applies one typed figure. Every field here holds exactly what was typed. */
  #applyNumber(field: string, value: string, lift: PlatformLift | null): void {
    const session = this.session;
    switch (field) {
      case TARGET_TOTAL_FIELD:
        this.#setSession(withTargetTotal(session, value));
        return;
      case BODYWEIGHT_FIELD:
        this.#setSession(withExtras(session, { bodyweight: value }));
        return;
      case AGE_FIELD:
        this.#setSession(withExtras(session, { age: value }));
        return;
      case PRIOR_MEETS_FIELD:
        this.#setSession(withExtras(session, { priorMeets: value }));
        return;
      case MINIMUM_JUMP_FIELD:
        this.#setSession(withExtras(session, { minimumJump: value }));
        return;
      case MAXIMUM_JUMP_FIELD:
        this.#setSession(withExtras(session, { maximumJump: value }));
        return;
      case PERSONAL_RECORD_TOTAL_FIELD:
        this.#setSession(withTargets(session, { personalRecordTotal: value }));
        return;
      case QUALIFYING_TOTAL_FIELD:
        this.#setSession(withTargets(session, { qualifyingTotal: value }));
        return;
      case MINIMUM_TOTAL_FIELD:
        this.#setSession(withTargets(session, { minimumAcceptableTotal: value }));
        return;
      case STRETCH_TOTAL_FIELD:
        this.#setSession(withTargets(session, { stretchTotal: value }));
        return;
      default:
        this.#applyLiftNumber(field, value, lift);
        return;
    }
  }

  #applyLiftNumber(field: string, value: string, lift: PlatformLift | null): void {
    if (lift === null) return;
    const figures = this.session.figures[lift];

    const attemptIndex = ATTEMPT_FIELDS.indexOf(field as (typeof ATTEMPT_FIELDS)[number]);
    if (attemptIndex !== -1) {
      const attempts: [string, string, string] = [
        figures.attempts[0],
        figures.attempts[1],
        figures.attempts[2],
      ];
      attempts[attemptIndex] = value;
      this.#patchFigures(lift, { attempts });
      return;
    }

    switch (field) {
      case EXPECTED_MAXIMUM_FIELD:
        this.#patchFigures(lift, { expectedMaximum: value });
        return;
      case GUIDED_WEIGHT_FIELD:
        this.#patchFigures(lift, { guided: { ...figures.guided, weight: value } });
        return;
      case GUIDED_REPS_FIELD:
        this.#patchFigures(lift, { guided: { ...figures.guided, reps: value } });
        return;
      case OPENER_FIELD:
        this.#patchFigures(lift, { opener: value });
        return;
      case CEILING_FIELD:
        this.#patchFigures(lift, { ceiling: value });
        return;
      case PERSONAL_RECORD_FIELD:
        this.#patchFigures(lift, { personalRecord: value });
        return;
      default:
        return;
    }
  }

  #patchFigures(lift: PlatformLift, patch: Parameters<typeof withFigures>[2]): void {
    this.#setSession(withFigures(this.session, lift, patch));
  }

  /**
   * Records the federation and tells the transport, in that order.
   *
   * The event carries the identifier rather than leaving the listener to read it
   * back off this element: a listener that read the property would be reading it
   * after a Lit update it has no way to await, and the chart it fetched would
   * belong to whichever federation happened to be current by then.
   */
  #chooseFederation(federationId: string): void {
    if (federationId === '') return;
    if (!this.profiles.some((profile) => profile.id === federationId)) return;
    this.#setSession(withSetup(this.session, { federationId }));
    this.dispatchEvent(
      new CustomEvent<FederationChangeDetail>(FEDERATION_CHANGE_EVENT, {
        detail: { federationId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Moves the display unit and raises the question about the digits.
   *
   * `withUnit` withdraws the confirmations; see its note for why that is not
   * optional. What it does *not* do is touch a digit -- that is the lifter's
   * answer to the question this raises, and until they give one the digits stand
   * unchanged, which is the "keep" reading.
   */
  #chooseUnit(unit: WeightUnit): void {
    const session = this.session;
    const typedIn = this.typedIn ?? session.setup.unit;
    this.#setSession(withUnit(session, unit));
    this.typedIn = unit === typedIn || !hasTypedWeights(session) ? null : typedIn;
  }

  #answerConversion(value: string): void {
    const typedIn = this.typedIn;
    if (typedIn === null) return;
    if (value === CONVERT_ANSWER) {
      this.#setSession(convertFigures(this.session, typedIn, this.session.setup.unit));
    }
    this.typedIn = null;
  }

  /**
   * Lit settles when this element's template is committed, which is before the
   * four elements it just handed a session to have rendered anything (§5.8). A
   * caller awaiting `updateComplete` and then reading text out of one would
   * otherwise read the previous render's -- usually not, which is what makes it
   * expensive.
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
 * Which control fired, read from the composed path.
 *
 * `event.target` is retargeted to this host for anything fired inside a child's
 * own shadow tree, so its `dataset` is empty and every answer is dropped -- with
 * the controls still visibly responding, which reads as a rendering fault
 * (§5.8). The path is the only place the real element is still visible.
 */
function fieldOf(event: Event): string | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    const field = node.dataset['field'];
    if (field !== undefined) return field;
  }
  return null;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-meet-day-planner': PtkMeetDayPlanner;
  }

  interface HTMLElementEventMap {
    [FEDERATION_CHANGE_EVENT]: CustomEvent<FederationChangeDetail>;
  }
}
