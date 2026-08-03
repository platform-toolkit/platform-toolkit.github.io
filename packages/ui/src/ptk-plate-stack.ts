// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * The plates on one end of a barbell, drawn.
 *
 * Shared chrome rather than a tool component, because a plate is a physical
 * object and not a domain concept: this element is handed a list of numbers and
 * a unit, and knows nothing about warm-ups, working sets, or conversions. The
 * warm-up calculator draws a ramp with it and the converter's milestone chart
 * wants the same picture, so it lives here and neither of them owns it.
 *
 * WHY THE NUMBER IS ALWAYS PRINTED
 *
 * Colour is a convenience for somebody who already knows the code and useless to
 * everybody else: it is discarded under forced colours, unavailable to a reader
 * who cannot separate the hues, and wrong in every gym whose plates are all
 * black iron. The number on the face is the identification; the colour is
 * decoration on top of it. Do not add a mode that hides the numbers.
 *
 * WHY SIZE IS A CLASS AND NEVER AN INLINE STYLE
 *
 * The production Content Security Policy is delivered by meta tag and does not
 * include 'unsafe-inline' in style-src, so a `style` attribute -- whether hand
 * written or produced by `styleMap` -- is dropped by the browser in the built
 * site and nowhere else. The symptom is a diagram that is correct in every test
 * and in development, and a row of identically sized plates in production. Every
 * size here is therefore a class chosen from a fixed table.
 */

/** How a plate is drawn: which diameter step, and which face colour. */
interface PlateAppearance {
  readonly size: string;
  readonly colour: string;
}

/**
 * Kilogram plates as the competition colour code has them, with the sizes below
 * competition diameter stepped down.
 *
 * The colours are the international ones a lifter reads without thinking. The
 * sizes are relative, not to scale: a 25 and a 20 are the same diameter on a
 * real platform, and drawing them identically would make the diagram unreadable
 * at the exact moment it matters, which is telling them apart at arm's length.
 */
const KILOGRAM_PLATES: Readonly<Record<string, PlateAppearance>> = {
  '25': { size: 'd7', colour: 'red' },
  '20': { size: 'd6', colour: 'blue' },
  '15': { size: 'd5', colour: 'yellow' },
  '10': { size: 'd4', colour: 'green' },
  '5': { size: 'd3', colour: 'plain' },
  '2.5': { size: 'd2', colour: 'red' },
  '1.25': { size: 'd1', colour: 'silver' },
  '1': { size: 'd1', colour: 'green' },
  '0.5': { size: 'd0', colour: 'plain' },
  '0.25': { size: 'd0', colour: 'silver' },
};

/**
 * Pound plates by relative diameter.
 *
 * No colour code: pound plates in the gyms these tools are used in are iron, and
 * inventing a palette for them would teach a lifter a convention that matches
 * nothing on the rack in front of them.
 */
const POUND_PLATES: Readonly<Record<string, PlateAppearance>> = {
  '45': { size: 'd7', colour: 'plain' },
  '35': { size: 'd6', colour: 'plain' },
  '25': { size: 'd5', colour: 'plain' },
  '20': { size: 'd4', colour: 'plain' },
  '15': { size: 'd4', colour: 'plain' },
  '10': { size: 'd3', colour: 'plain' },
  '5': { size: 'd2', colour: 'plain' },
  '2.5': { size: 'd1', colour: 'plain' },
  '1.25': { size: 'd0', colour: 'plain' },
};

/**
 * A plate the tables above do not have -- an odd denomination somebody selected.
 *
 * Drawn at a middle diameter rather than dropped. A plate missing from the
 * picture is the one error this element could make that a lifter would not
 * notice, because a diagram nobody can check against is exactly what they are
 * looking at it for.
 */
const UNKNOWN_PLATE: PlateAppearance = { size: 'd3', colour: 'plain' };

function appearance(weight: number, unit: string): PlateAppearance {
  const table = unit === 'lb' ? POUND_PLATES : KILOGRAM_PLATES;
  return table[String(weight)] ?? UNKNOWN_PLATE;
}

@customElement('ptk-plate-stack')
export class PtkPlateStack extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    /*
     * Wrapping rather than scrolling. A loading of a dozen small plates is rare
     * and a sideways scrollbar on a phone is not -- see the narrow-layout rules.
     * A wrapped second row reads oddly; a diagram half off the screen reads as
     * a broken page.
     */
    .stack {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 2px;
      min-height: 3rem;
    }

    /* The sleeve the plates sit on, so the picture reads as a bar end and not as
       a row of tokens. Decoration only, and hidden from assistive technology
       along with the rest of the diagram. */
    .sleeve {
      width: var(--ptk-space-md);
      height: 0.55rem;
      border: 1px solid var(--ptk-color-border-strong);
      border-right: 0;
      border-radius: var(--ptk-radius-sm) 0 0 var(--ptk-radius-sm);
      background-color: var(--ptk-color-surface-sunken);
    }

    .plate {
      display: flex;
      align-items: center;
      justify-content: center;
      /* Wide enough for four characters at the face size below. Fixed, because
         a plate whose width followed its label would make 2.5 wider than 25. */
      width: 1.75rem;
      /* A border on every plate, not only the pale ones. Under forced colours
         the fills are replaced and the border is what keeps the plates
         distinguishable from each other and from the page. */
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-sm);
      font-size: 0.72rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .d0 {
      height: 1.4rem;
    }
    .d1 {
      height: 1.9rem;
    }
    .d2 {
      height: 2.4rem;
    }
    .d3 {
      height: 2.9rem;
    }
    .d4 {
      height: 3.4rem;
    }
    .d5 {
      height: 3.9rem;
    }
    .d6 {
      height: 4.4rem;
    }
    .d7 {
      height: 4.9rem;
    }

    /*
     * Faces. Each pairs a fill with a text colour that survives it, because the
     * number is the identification and an unreadable number is a plate with no
     * label at all.
     *
     * These are fixed colours rather than theme tokens on purpose: a blue 20 is
     * blue in a dark gym too, and re-theming the plates would break the one
     * thing a lifter can check the diagram against.
     */
    .plain {
      background-color: var(--ptk-color-surface);
      color: var(--ptk-color-text);
    }
    .silver {
      background-color: #b9bfc6;
      color: #16191d;
    }
    .red {
      background-color: #b3261e;
      color: #ffffff;
    }
    .blue {
      background-color: #1c4fa1;
      color: #ffffff;
    }
    .yellow {
      background-color: #e4b100;
      color: #16191d;
    }
    .green {
      background-color: #1c6b3c;
      color: #ffffff;
    }

    .bar-only {
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }
  `;

  /** The plates on one side, heaviest first. */
  @property({ attribute: false }) plates: readonly number[] = [];

  /** Which unit the numbers are in. Chooses the colour and diameter table. */
  @property({ type: String }) unit = 'kg';

  /** What to say when there are no plates. */
  @property({ type: String, attribute: 'empty-label' }) emptyLabel = 'Bar only';

  override render(): TemplateResult {
    if (this.plates.length === 0) {
      return html`<p class="bar-only">${this.emptyLabel}</p>`;
    }

    /*
     * One label for the whole picture, not one per plate.
     *
     * Left to itself a screen reader reads the faces as a bare run of numbers --
     * "25 10 2.5" -- with nothing to say what they are or that they are one end
     * of the bar. `role="img"` collapses the diagram into the sentence a lifter
     * actually needs.
     */
    const description = `Per side: ${this.plates
      .map((plate) => `${String(plate)} ${this.unit}`)
      .join(', ')}`;

    return html`
      <div class="stack" role="img" aria-label=${description}>
        <span class="sleeve"></span>
        ${this.plates.map((plate) => this.#renderPlate(plate))}
      </div>
    `;
  }

  #renderPlate(weight: number): TemplateResult {
    const { size, colour } = appearance(weight, this.unit);
    return html`<span class="plate ${size} ${colour}">${weight}</span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-plate-stack': PtkPlateStack;
  }
}
