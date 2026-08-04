// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §24.2 and §24.3: the shelf of saved meets, and the truth about where they are.
 *
 * Presentational, like every other element in this directory. It holds one piece
 * of state -- which meet's name is being edited -- and every other press leaves
 * as an event for `ptk-meet-day-planner`, which owns the library and the store.
 * The element cannot save anything and does not know how.
 *
 * WHY THE WARNING IS NOT BEHIND A FOLD
 *
 * §24.3 asks for it to be shown clearly, and a fold labelled "About saving" is
 * the standard way to satisfy that sentence while making sure nobody reads it.
 * The one thing a lifter has to know before they trust this shelf with a meet is
 * that a cleared cache takes it, so the warning sits above the list, unfolded,
 * every time. It costs three lines on a phone. Losing the plan on the morning of
 * a meet costs the meet.
 *
 * WHY THERE IS NO SAVE BUTTON
 *
 * Saving is automatic (§24.1 lists ten actions to save after, which is every
 * material action there is). A Save button beside an autosave is worse than
 * either alone: it implies the tool has *not* been saving, so the lifter who
 * does not press it worries, and the lifter who does press it learns nothing.
 * What is on screen instead is the warning, and a delete control -- the two
 * things a person genuinely cannot work out for themselves.
 *
 * WHY DELETE ASKS TWICE AND NOTHING ELSE DOES
 *
 * Archive, rename and duplicate are all reversible in one press. Deleting a
 * meet is not, and deleting the whole shelf is not reversible at all -- so both
 * of those arm first and act second, and the armed control says what it will
 * destroy. Nothing here uses `confirm()`: it is blocked inside a cross-origin
 * frame, which is exactly where this tool runs.
 *
 * WHY THE NAME FIELD CARRIES NO LENGTH CAP
 *
 * The cap is `MEET_NAME_MAX` and `readMeetName` is what applies it, reporting
 * `name-too-long` for the shelf to render. A `maxlength` on the field would be a
 * second copy of the same rule in a layer that cannot explain itself: the box
 * simply stops accepting characters, a pasted name is silently truncated, and
 * the lifter is left to work out that the tool has an opinion about length. One
 * refusal in words beats a control that goes quiet.
 */
import '@platform-toolkit/ui';
import { type NoticeTone, type TextFieldChangeDetail } from '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import {
  MEET_ARCHIVE_LABEL,
  MEET_DELETE_ALL_LABEL,
  MEET_DELETE_ALL_WARNING,
  MEET_DELETE_LABEL,
  MEET_DUPLICATE_LABEL,
  MEET_EXPORT_LABEL,
  MEET_IMPORT_LABEL,
  MEET_LIBRARY_ARCHIVED_HEADING,
  MEET_LIBRARY_EMPTY,
  MEET_LIBRARY_HEADING,
  MEET_RENAME_LABEL,
  MEET_RESUME_LABEL,
  STORAGE_EXPORT_ADVICE,
  STORAGE_WARNING,
  STORAGE_WARNING_NOT_DURABLE,
  duplicateMeetName,
  unreadableMeetsSentence,
} from './copy.js';
import {
  EMPTY_LIBRARY,
  archivedMeets,
  resumableMeets,
  type MeetLibrary,
  type SavedMeet,
} from './saved-meet.js';

/** What the shelf asks the planner to do to one meet. */
export type MeetCommandKind = 'resume' | 'rename' | 'duplicate' | 'archive' | 'delete';

export interface MeetCommandDetail {
  readonly kind: MeetCommandKind;
  readonly meetId: string;
  /** The new name, on a rename; the copy's name, on a duplicate. Absent otherwise. */
  readonly name?: string;
  /** What an archive press asks the flag to become, for the reason the board gives. */
  readonly archived?: boolean;
}

export const MEET_COMMAND_EVENT = 'ptk-meet-day-meet-command';
export const MEET_EXPORT_EVENT = 'ptk-meet-day-meet-export';
export const MEET_IMPORT_EVENT = 'ptk-meet-day-meet-import';
export const MEET_DELETE_ALL_EVENT = 'ptk-meet-day-meet-delete-all';

export interface MeetImportDetail {
  /** The file the visitor chose. Read by the planner, never by this element. */
  readonly file: File;
}

@customElement('ptk-meet-library')
export class PtkMeetLibrary extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      gap: var(--ptk-space-lg);
      container-type: inline-size;
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
      /*
       * The name is the one string on this screen a person typed, and a long
       * unbroken one is what widens a 320px column. The token layer sets
       * overflow-wrap to anywhere at the root and it inherits in here, but a
       * grid item still needs to be allowed to shrink -- hence the zero minimum
       * on the row below rather than a second wrap declaration.
       */
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
      gap: var(--ptk-space-sm);
    }

    .meet {
      display: grid;
      gap: var(--ptk-space-xs);
      min-width: 0;
      padding: var(--ptk-space-sm) 0;
      border-top: 1px solid var(--ptk-color-border);
    }

    .heading {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-xs) var(--ptk-space-sm);
      align-items: baseline;
      min-width: 0;
    }

    /*
     * An auto-fit grid over the element's own width, per §5.7: five controls sit in a
     * row on a tablet and stack on a phone with no media query, and the
     * min(100%, ...) is what makes the single-column collapse happen instead
     * of an overflow.
     */
    .controls {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
      gap: var(--ptk-space-xs);
    }

    .rename {
      display: grid;
      gap: var(--ptk-space-xs);
    }

    .armed {
      display: grid;
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-sm);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
    }

    /*
     * The native file input is replaced by a button that presses it. Clipped
     * rather than set to display: none, because a display-none input cannot be
     * opened by a script in Safari, and the whole point of the button is that it
     * opens the picker.
     */
    input[type='file'] {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }
  `;

  @property({ attribute: false }) library: MeetLibrary = EMPTY_LIBRARY;

  /** How many saved meets this build could not read. See `meet-store.ts`. */
  @property({ type: Number }) unreadable = 0;

  /** Whether a write survives the tab closing. Decides which warning is shown. */
  @property({ type: Boolean }) durable = false;

  /** A sentence from the planner about the last thing that was tried. */
  @property({ type: String }) message = '';

  /**
   * Whether that sentence is a refusal or a report, which only the planner knows.
   *
   * `importOutcomeSentence` says a meet arrived and `libraryRefusalSentence`
   * says one did not, and both land in `message` -- so a fixed tone here would
   * be wrong for half of what the planner says. It defaults to `error` rather
   * than `info` because that is the direction a forgotten tag should fail in: a
   * refusal shown as a quiet note is a lifter who thinks their meet was saved.
   */
  @property({ type: String }) messageTone: NoticeTone = 'error';

  @state() private renaming: string | null = null;
  @state() private draftName = '';
  @state() private armed: string | null = null;
  @state() private armedAll = false;

  /*
   * The two storage sentences carry two tones because they are two different
   * facts. Storage that works is a true statement about where the meets are and
   * nothing has gone wrong, which is what `info` is for; storage that keeps
   * nothing is the tool unable to do the thing this screen is about. `error` is
   * the only tone that carries a border as well as a colour, so it survives
   * forced colours and a reader who cannot separate the hues -- which is the
   * same reason the sentence is not behind a fold. A meet this build cannot open
   * is a read that failed, so it takes the error tone too.
   */
  override render(): TemplateResult {
    const resumable = resumableMeets(this.library);
    const finished = archivedMeets(this.library);
    return html`
      <section>
        <h3>${MEET_LIBRARY_HEADING}</h3>
        <ptk-notice tone=${this.durable ? 'info' : 'error'}>
          <p>${this.durable ? STORAGE_WARNING : STORAGE_WARNING_NOT_DURABLE}</p>
          ${this.durable ? html`<p>${STORAGE_EXPORT_ADVICE}</p>` : nothing}
        </ptk-notice>
        ${
          this.unreadable > 0
            ? html`<ptk-notice tone="error"
                ><p>${unreadableMeetsSentence(this.unreadable)}</p></ptk-notice
              >`
            : nothing
        }
        ${
          this.message === ''
            ? nothing
            : html`<ptk-notice tone=${this.messageTone} role="status"
                ><p>${this.message}</p></ptk-notice
              >`
        }
        ${
          resumable.length === 0 && finished.length === 0
            ? html`<p class="muted">${MEET_LIBRARY_EMPTY}</p>`
            : html`<ul>
                ${repeat(
                  resumable,
                  (meet) => meet.id,
                  (meet) => this.#renderMeet(meet),
                )}
              </ul>`
        }
      </section>
      ${
        finished.length === 0
          ? nothing
          : html`<section>
              <h3>${MEET_LIBRARY_ARCHIVED_HEADING}</h3>
              <ul>
                ${repeat(
                  finished,
                  (meet) => meet.id,
                  (meet) => this.#renderMeet(meet),
                )}
              </ul>
            </section>`
      }
      ${this.#renderShelfControls()}
    `;
  }

  #renderMeet(meet: SavedMeet): TemplateResult {
    const open = meet.id === this.library.activeMeetId;
    return html`
      <li class="meet">
        <div class="heading">
          <h4>${meet.name}</h4>
          ${open ? html`<span class="muted">Open</span>` : nothing}
        </div>
        ${this.renaming === meet.id ? this.#renderRename(meet) : nothing}
        ${this.armed === meet.id ? this.#renderArmedDelete(meet) : nothing}
        <div class="controls">
          <ptk-button
            variant="secondary"
            data-meet=${meet.id}
            data-command="resume"
            @click=${this.#onCommand}
            >${MEET_RESUME_LABEL}</ptk-button
          >
          <ptk-button
            variant="secondary"
            data-meet=${meet.id}
            data-command="start-rename"
            @click=${this.#onStartRename}
            >${MEET_RENAME_LABEL}</ptk-button
          >
          <ptk-button
            variant="secondary"
            data-meet=${meet.id}
            data-command="duplicate"
            @click=${this.#onCommand}
            >${MEET_DUPLICATE_LABEL}</ptk-button
          >
          <ptk-button
            variant="secondary"
            data-meet=${meet.id}
            data-command="archive"
            @click=${this.#onCommand}
            >${meet.archived ? 'Reopen' : MEET_ARCHIVE_LABEL}</ptk-button
          >
          <ptk-button
            variant="secondary"
            data-meet=${meet.id}
            data-command="arm-delete"
            @click=${this.#onArmDelete}
            >${MEET_DELETE_LABEL}</ptk-button
          >
        </div>
      </li>
    `;
  }

  #renderRename(meet: SavedMeet): TemplateResult {
    return html`
      <div class="rename">
        <ptk-text-field
          label="Meet name"
          .value=${this.draftName}
          data-meet=${meet.id}
          @ptk-text-field-change=${this.#onDraftName}
        ></ptk-text-field>
        <div class="controls">
          <ptk-button data-meet=${meet.id} data-command="rename" @click=${this.#onCommand}
            >Save name</ptk-button
          >
          <ptk-button
            variant="secondary"
            data-command="cancel-rename"
            @click=${this.#onCancelRename}
            >Cancel</ptk-button
          >
        </div>
      </div>
    `;
  }

  /*
   * The confirming press is `primary`, not a danger variant: `ButtonVariant` has
   * three members and none of them is one. Adding a fourth would put the whole
   * of what makes this press different into a colour, and §5.8 is explicit that
   * a variant is never the only signal of what an action does. The panel around
   * it names the meet and says the press cannot be undone, which is the part
   * that survives forced colours and being read aloud. The same goes for the
   * delete-everything confirmation below.
   */
  #renderArmedDelete(meet: SavedMeet): TemplateResult {
    return html`
      <div class="armed">
        <p>Delete "${meet.name}"? This cannot be undone.</p>
        <div class="controls">
          <ptk-button
            variant="primary"
            data-meet=${meet.id}
            data-command="delete"
            @click=${this.#onCommand}
            >Delete it</ptk-button
          >
          <ptk-button variant="secondary" data-command="keep" @click=${this.#onDisarm}
            >Keep it</ptk-button
          >
        </div>
      </div>
    `;
  }

  #renderShelfControls(): TemplateResult {
    return html`
      <section>
        <div class="controls">
          <ptk-button variant="secondary" data-command="export" @click=${this.#onExport}
            >${MEET_EXPORT_LABEL}</ptk-button
          >
          <ptk-button variant="secondary" data-command="import" @click=${this.#onPickFile}
            >${MEET_IMPORT_LABEL}</ptk-button
          >
        </div>
        <input
          type="file"
          accept="application/json,.json"
          aria-hidden="true"
          tabindex="-1"
          @change=${this.#onFileChosen}
        />
        ${
          this.armedAll
            ? html`<div class="armed">
                <p>${MEET_DELETE_ALL_WARNING}</p>
                <div class="controls">
                  <ptk-button
                    variant="primary"
                    data-command="delete-all"
                    @click=${this.#onDeleteAll}
                    >Delete everything</ptk-button
                  >
                  <ptk-button
                    variant="secondary"
                    data-command="cancel-all"
                    @click=${this.#onDisarmAll}
                    >Cancel</ptk-button
                  >
                </div>
              </div>`
            : html`<ptk-button variant="secondary" data-command="arm-all" @click=${this.#onArmAll}
                >${MEET_DELETE_ALL_LABEL}</ptk-button
              >`
        }
      </section>
    `;
  }

  /**
   * Which meet a press was about, checked against the library rather than read.
   *
   * `dataset` is a string out of the DOM and the listener sits on a `ptk-button`
   * host, so a press landing on the host's own box -- or any caller doing
   * `host.click()` -- reaches this whatever the inner button thinks. Same
   * reasoning as `ptk-coach-board`'s `#pressedLifter`.
   */
  #pressed(event: Event): SavedMeet | null {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return null;
    const id = target.dataset['meet'];
    if (id === undefined) return null;
    return this.library.meets.find((meet) => meet.id === id) ?? null;
  }

  readonly #onCommand = (event: Event): void => {
    const meet = this.#pressed(event);
    if (meet === null) return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const command = target.dataset['command'];

    let detail: MeetCommandDetail;
    switch (command) {
      case 'resume':
        detail = { kind: 'resume', meetId: meet.id };
        break;
      case 'rename': {
        // Read from the draft rather than from the field, so a press on the host
        // and a press on the button send the same name.
        detail = { kind: 'rename', meetId: meet.id, name: this.draftName };
        this.renaming = null;
        break;
      }
      case 'duplicate':
        detail = { kind: 'duplicate', meetId: meet.id, name: duplicateMeetName(meet.name) };
        break;
      case 'archive':
        detail = { kind: 'archive', meetId: meet.id, archived: !meet.archived };
        break;
      case 'delete':
        detail = { kind: 'delete', meetId: meet.id };
        this.armed = null;
        break;
      default:
        return;
    }

    this.dispatchEvent(
      new CustomEvent<MeetCommandDetail>(MEET_COMMAND_EVENT, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  };

  readonly #onStartRename = (event: Event): void => {
    const meet = this.#pressed(event);
    if (meet === null) return;
    this.renaming = meet.id;
    this.draftName = meet.name;
    this.armed = null;
  };

  readonly #onCancelRename = (): void => {
    this.renaming = null;
  };

  readonly #onDraftName = (event: CustomEvent<TextFieldChangeDetail>): void => {
    this.draftName = event.detail.value;
  };

  readonly #onArmDelete = (event: Event): void => {
    const meet = this.#pressed(event);
    if (meet === null) return;
    this.armed = meet.id;
    this.renaming = null;
  };

  readonly #onDisarm = (): void => {
    this.armed = null;
  };

  readonly #onArmAll = (): void => {
    this.armedAll = true;
  };

  readonly #onDisarmAll = (): void => {
    this.armedAll = false;
  };

  readonly #onDeleteAll = (): void => {
    this.armedAll = false;
    this.dispatchEvent(new CustomEvent(MEET_DELETE_ALL_EVENT, { bubbles: true, composed: true }));
  };

  readonly #onExport = (): void => {
    this.dispatchEvent(new CustomEvent(MEET_EXPORT_EVENT, { bubbles: true, composed: true }));
  };

  readonly #onPickFile = (): void => {
    this.renderRoot.querySelector('input[type=file]')?.dispatchEvent(new MouseEvent('click'));
  };

  readonly #onFileChosen = (event: Event): void => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    // Cleared whether or not a file arrived, so choosing the same file twice in
    // a row fires a second change event -- without it, an import that failed
    // cannot be retried without picking something else first.
    input.value = '';
    if (file === undefined) return;
    this.dispatchEvent(
      new CustomEvent<MeetImportDetail>(MEET_IMPORT_EVENT, {
        detail: { file },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-meet-library': PtkMeetLibrary;
  }

  interface HTMLElementEventMap {
    [MEET_COMMAND_EVENT]: CustomEvent<MeetCommandDetail>;
    [MEET_EXPORT_EVENT]: CustomEvent<undefined>;
    [MEET_IMPORT_EVENT]: CustomEvent<MeetImportDetail>;
    [MEET_DELETE_ALL_EVENT]: CustomEvent<undefined>;
  }
}
