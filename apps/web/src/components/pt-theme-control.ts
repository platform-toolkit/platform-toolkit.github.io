import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ThemeMode } from '@platform-targets/configuration';

/** Detail carried by `pt-theme-mode-change`. */
export interface ThemeModeChangeDetail {
  readonly mode: ThemeMode;
}

declare global {
  interface HTMLElementTagNameMap {
    'pt-theme-control': PtThemeControl;
  }
  interface HTMLElementEventMap {
    'pt-theme-mode-change': CustomEvent<ThemeModeChangeDetail>;
  }
}

const OPTIONS: readonly { readonly mode: ThemeMode; readonly label: string }[] = [
  { mode: 'system', label: 'System' },
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
];

/**
 * Lets a user choose between following the system theme and forcing one.
 *
 * When an embedding host has locked the theme the control renders as disabled
 * with a visible explanation, rather than disappearing. A control that vanishes
 * reads as a bug; a disabled one that says why reads as a decision.
 */
@customElement('pt-theme-control')
export class PtThemeControl extends LitElement {
  public static override styles = css`
    :host {
      display: block;
    }

    fieldset {
      display: flex;
      align-items: center;
      gap: var(--pt-space-sm);
      margin: 0;
      padding: var(--pt-space-sm) var(--pt-space-md);
      border: 1px solid var(--pt-color-border);
      border-radius: var(--pt-radius-md);
      background-color: var(--pt-color-surface-raised);
    }

    legend {
      padding: 0 var(--pt-space-xs);
      color: var(--pt-color-text-muted);
      font-size: var(--pt-font-size-sm);
    }

    .options {
      display: flex;
      gap: var(--pt-space-xs);
    }

    label {
      display: inline-flex;
      align-items: center;
      gap: var(--pt-space-xs);
      padding: var(--pt-space-xs) var(--pt-space-sm);
      border: 1px solid transparent;
      border-radius: var(--pt-radius-sm);
      font-size: var(--pt-font-size-sm);
      cursor: pointer;
    }

    label:has(input:checked) {
      border-color: var(--pt-color-accent);
      background-color: var(--pt-color-surface);
      font-weight: 600;
    }

    input:focus-visible {
      outline: var(--pt-focus-ring-width) solid var(--pt-color-focus-ring);
      outline-offset: var(--pt-focus-ring-offset);
    }

    fieldset:disabled label {
      color: var(--pt-color-text-muted);
      cursor: not-allowed;
    }

    .lock-note {
      margin: 0;
      color: var(--pt-color-text-muted);
      font-size: var(--pt-font-size-sm);
    }
  `;

  // Declared as plain fields, not `accessor` fields. `accessor` is the standard
  // decorators form; this project uses TypeScript's experimentalDecorators,
  // because Oxc -- Vite 8's transformer -- cannot lower native decorators.
  // Mixing the two forms produces properties that silently lose reactivity.

  /** The currently configured mode. Not the effective theme. */
  @property({ type: String, attribute: 'mode' })
  public mode: ThemeMode = 'system';

  /** Set when the embedding host has fixed the theme. */
  @property({ type: Boolean, attribute: 'locked', reflect: true })
  public locked = false;

  public override render(): TemplateResult {
    return html`
      <fieldset ?disabled=${this.locked}>
        <legend>Theme</legend>
        <div class="options" role="radiogroup" aria-label="Theme">
          ${OPTIONS.map(
            (option) => html`
              <label>
                <input
                  type="radio"
                  name="theme-mode"
                  .value=${option.mode}
                  .checked=${this.mode === option.mode}
                  ?disabled=${this.locked}
                  @change=${() => {
                    this.#select(option.mode);
                  }}
                />
                <span>${option.label}</span>
              </label>
            `,
          )}
        </div>
        ${this.locked ? html`<p class="lock-note">Set by the page hosting this view.</p>` : nothing}
      </fieldset>
    `;
  }

  #select(mode: ThemeMode): void {
    if (this.locked || mode === this.mode) {
      return;
    }
    this.mode = mode;
    this.dispatchEvent(
      new CustomEvent<ThemeModeChangeDetail>('pt-theme-mode-change', {
        detail: { mode },
        bubbles: true,
        composed: true,
      }),
    );
  }
}
