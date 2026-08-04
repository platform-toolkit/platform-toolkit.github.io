// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §23.2: the whole flight on a sheet, for the person running it.
 *
 * A separate element from `ptk-meet-pack` rather than a second template inside
 * it, because the two sheets answer different questions and share almost no
 * layout. §23.1 is one lifter in depth -- six contingency blocks per lift, a
 * checklist, their own notes. This is twelve lifters across: a name, the
 * identifier the board prints, who is handling them, three weights per lift, and
 * the clashes. One element with a `kind` property would be two templates behind
 * one class, and the print rules for the two are different too -- a roster wants
 * rows that survive a page break and a pack wants blocks that do not.
 *
 * WHY THE LAST COLUMNS ARE EMPTY ON PURPOSE
 *
 * Flight, platform, rack settings and results are not in this tool's hands.
 * §22.1 is filled in by each lifter on their own phone, and a handler running a
 * flight has a board and a meet document and no way to ask twelve people for a
 * rack height. `buildHandlerPack` declares them rather than dropping them, and
 * this element draws them as ruled lines with `HANDLER_PACK_WRITE_IN_NOTE`
 * saying why -- a column the tool silently omitted reads as one it forgot.
 *
 * Everything on the sheet was decided by `pack.ts` and `board.ts`. This file
 * ranks nobody, resolves no conflict and converts no weight.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  HANDLER_PACK_CONFLICTS_HEADING,
  HANDLER_PACK_LIFTERS_HEADING,
  HANDLER_PACK_NO_HANDLERS,
  HANDLER_PACK_WRITE_IN_NOTE,
  attemptKilogramsText,
  attemptPoundsText,
  handlerPackTitle,
  handlerWriteInLabel,
  liftLabel,
  listText,
  packConflictLabel,
} from './copy.js';
import {
  EMPTY_HANDLER_PACK,
  type HandlerPack,
  type HandlerPackLift,
  type HandlerPackLifter,
} from './pack.js';

@customElement('ptk-handler-pack')
export class PtkHandlerPack extends LitElement {
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

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: var(--ptk-space-md);
    }

    /*
     * A card per lifter, not a table element. A roster is genuinely tabular and a
     * table is the honest markup for it -- but §27 forbids horizontal scrolling
     * in an urgent workflow, and eight columns of weights cannot be made to fit
     * 320px without one. So each lifter is a block that stacks, and the print
     * rules below give the paper version the density a table would have.
     */
    .lifter {
      display: grid;
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-sm) 0;
      border-top: 1px solid var(--ptk-color-border);
    }

    .who {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-xs) var(--ptk-space-sm);
      align-items: baseline;
    }

    .name {
      font-weight: 600;
    }

    /*
     * The identifier is text and never a colour alone (§21). The swatch is not
     * drawn here at all: it is a value off somebody else's device, board.ts
     * records at length why that needs a CSS.supports check before it reaches a
     * style attribute, and a colour is worth nothing on a monochrome printer.
     */
    .identifier {
      font-variant-numeric: tabular-nums;
    }

    .lifts {
      display: grid;
      gap: var(--ptk-space-xs);
    }

    .lift {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-xs) var(--ptk-space-sm);
      align-items: baseline;
    }

    .lift .label {
      min-width: 5rem;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .weight {
      font-variant-numeric: tabular-nums;
    }

    /* An attempt with no weight declared yet, which is a blank to write in. */
    .unset {
      display: inline-block;
      min-width: 3rem;
      border-bottom: 1px solid var(--ptk-color-border);
    }

    .write-in {
      display: grid;
      gap: var(--ptk-space-xs);
    }

    .write-in .line {
      display: grid;
      grid-template-columns: minmax(4rem, auto) 1fr;
      gap: var(--ptk-space-sm);
      align-items: end;
    }

    .write-in .rule {
      border-bottom: 1px solid var(--ptk-color-border);
      min-height: 1.4rem;
    }

    @media print {
      :host {
        color: #000;
        background: #fff;
      }

      .muted,
      .lift .label {
        color: #000;
      }

      .sheet {
        gap: 0.6rem;
      }

      ul {
        gap: 0;
      }

      /*
       * A lifter is one unbroken block. Half a roster row at the foot of a page
       * is a handler reading a name with no weights under it, and the weights
       * are the reason the sheet exists.
       */
      .lifter {
        break-inside: avoid;
        border-top: 1px solid #000;
        padding: 0.25rem 0;
      }

      .unset,
      .write-in .rule {
        border-bottom: 1px solid #000;
      }

      h3 {
        font-size: 1.2rem;
      }

      h4 {
        font-size: 1rem;
      }
    }
  `;

  @property({ attribute: false }) pack: HandlerPack = EMPTY_HANDLER_PACK;

  override render(): TemplateResult {
    const { pack } = this;
    return html`
      <article class="sheet">
        <header>
          <h3>${handlerPackTitle(pack.format)}</h3>
          <p class="muted rules">${pack.rulesLabel} -- revision ${pack.rulebookRevision}</p>
        </header>
        <section class="lifters">
          <h4>${HANDLER_PACK_LIFTERS_HEADING}</h4>
          <ul>
            ${pack.lifters.map((lifter) => html`<li>${this.#renderLifter(lifter)}</li>`)}
          </ul>
        </section>
        ${this.#renderWriteIn()}
      </article>
    `;
  }

  #renderLifter(lifter: HandlerPackLifter): TemplateResult {
    return html`
      <div class="lifter">
        <div class="who">
          <span class="name">${lifter.name}</span>
          <span class="identifier">${lifter.identifier}</span>
          <span class="handlers muted"
            >${
              lifter.handlers.length === 0 ? HANDLER_PACK_NO_HANDLERS : listText(lifter.handlers)
            }</span
          >
        </div>
        <div class="lifts">${lifter.lifts.map((lift) => renderLift(lift))}</div>
        ${lifter.conflicts.length === 0 ? nothing : renderConflicts(lifter)}
      </div>
    `;
  }

  #renderWriteIn(): TemplateResult | typeof nothing {
    if (this.pack.writeIn.length === 0) return nothing;
    return html`
      <section class="write-in">
        <p class="muted">${HANDLER_PACK_WRITE_IN_NOTE}</p>
        ${this.pack.writeIn.map(
          (code) => html`
            <div class="line">
              <span class="label">${handlerWriteInLabel(code)}</span>
              <span class="rule"></span>
            </div>
          `,
        )}
      </section>
    `;
  }
}

/*
 * Three cells whatever is on them, so every lifter's row is the same width and a
 * handler reads down a column. `pack.ts` says the same thing about the value; it
 * is repeated in the layout because a template that skipped the empty ones would
 * satisfy every assertion about the weights that *are* there.
 */
function renderLift(lift: HandlerPackLift): TemplateResult {
  return html`
    <div class="lift">
      <span class="label">${liftLabel(lift.lift)}</span>
      ${lift.attempts.map((weight) =>
        weight === null
          ? html`<span class="unset"></span>`
          : html`<span class="weight"
              >${attemptKilogramsText(weight)}${renderPounds(attemptPoundsText(weight))}</span
            >`,
      )}
    </div>
  `;
}

function renderPounds(pounds: string | null): TemplateResult | typeof nothing {
  return pounds === null ? nothing : html` <span class="pounds muted">${pounds}</span>`;
}

function renderConflicts(lifter: HandlerPackLifter): TemplateResult {
  return html`
    <div class="conflicts">
      <h5>${HANDLER_PACK_CONFLICTS_HEADING}</h5>
      <ul class="clashes">
        ${lifter.conflicts.map((code) => html`<li>${packConflictLabel(code)}</li>`)}
      </ul>
    </div>
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-handler-pack': PtkHandlerPack;
  }
}
