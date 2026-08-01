/**
 * Runs in a real browser. See the note in vitest.config.ts.
 *
 * The first two tests exist because of a specific, silent failure mode. Lit's
 * `@property` decorator installs accessors on the prototype; with
 * `useDefineForClassFields: true` -- the TypeScript default at an ES2022 target
 * -- class fields are emitted as `defineProperty` calls that overwrite those
 * accessors on the instance. Everything still compiles, the element still
 * renders once, and nothing ever updates again. `tsconfig.base.json` sets the
 * flag to false with a comment saying so, but a comment is not a check: these
 * tests fail if the setting is changed, and that is their whole purpose.
 */
import { afterEach, describe, expect, it } from 'vitest';

import './ptk-theme-control.js';
import type { PtkThemeControl, ThemeModeChangeDetail } from './ptk-theme-control.js';

function mount(): PtkThemeControl {
  const element = document.createElement('ptk-theme-control');
  document.body.append(element);
  return element;
}

/** The radio inputs, in rendered order. Shadow DOM, so not reachable from the document. */
function radios(element: PtkThemeControl): HTMLInputElement[] {
  return [...(element.shadowRoot?.querySelectorAll('input[type="radio"]') ?? [])].filter(
    (node): node is HTMLInputElement => node instanceof HTMLInputElement,
  );
}

function checkedLabel(element: PtkThemeControl): string | undefined {
  const checked = radios(element).find((radio) => radio.checked);
  return checked?.closest('label')?.textContent.trim();
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('ptk-theme-control reactivity', () => {
  it('re-renders when the mode property is set', async () => {
    const element = mount();
    await element.updateComplete;
    expect(checkedLabel(element)).toBe('System');

    element.mode = 'dark';
    await element.updateComplete;

    // Reading the rendered radio rather than the property: the property would
    // report the new value even with reactivity broken, which is exactly the bug
    // that must not be able to pass.
    expect(checkedLabel(element)).toBe('Dark');
  });

  it('reflects the locked property to an attribute and disables the control', async () => {
    const element = mount();
    await element.updateComplete;
    expect(element.hasAttribute('locked')).toBe(false);
    expect(radios(element).every((radio) => !radio.disabled)).toBe(true);

    element.locked = true;
    await element.updateComplete;

    // `reflect: true` is a separate mechanism from re-rendering, and it can break
    // on its own, so both are asserted.
    expect(element.hasAttribute('locked')).toBe(true);
    expect(radios(element).every((radio) => radio.disabled)).toBe(true);
  });

  it('takes the initial mode from an attribute', async () => {
    document.body.innerHTML = '<ptk-theme-control mode="light"></ptk-theme-control>';
    const element = document.querySelector('ptk-theme-control');
    expect(element).not.toBeNull();

    await element?.updateComplete;
    expect(element && checkedLabel(element)).toBe('Light');
  });
});

describe('ptk-theme-control behaviour', () => {
  it('announces a change with the chosen mode', async () => {
    const element = mount();
    await element.updateComplete;

    const seen: ThemeModeChangeDetail[] = [];
    element.addEventListener('ptk-theme-mode-change', (event) => {
      seen.push(event.detail);
    });

    radios(element)[2]?.click();
    await element.updateComplete;

    expect(seen).toEqual([{ mode: 'dark' }]);
    expect(element.mode).toBe('dark');
  });

  it('crosses the shadow boundary so a host page can listen on the element', async () => {
    const element = mount();
    await element.updateComplete;

    const seen: ThemeModeChangeDetail[] = [];
    document.body.addEventListener('ptk-theme-mode-change', (event) => {
      seen.push(event.detail);
    });

    radios(element)[1]?.click();
    await element.updateComplete;

    // `composed: true` is what makes the event escape the shadow root. Without
    // it the component works in isolation and is silent in every real page.
    expect(seen).toEqual([{ mode: 'light' }]);
  });

  it('does not announce a change when the chosen mode is already current', async () => {
    const element = mount();
    await element.updateComplete;

    let announced = 0;
    element.addEventListener('ptk-theme-mode-change', () => {
      announced += 1;
    });

    radios(element)[0]?.click(); // 'system', already selected
    await element.updateComplete;

    expect(announced).toBe(0);
  });

  it('stays silent while locked, however the input is reached', async () => {
    const element = mount();
    element.locked = true;
    await element.updateComplete;

    let announced = 0;
    element.addEventListener('ptk-theme-mode-change', () => {
      announced += 1;
    });

    // A disabled input cannot be clicked, so the guard inside the handler would
    // never be reached through the interface. Dispatching the event directly is
    // what tests the guard rather than the disabled attribute -- they are two
    // independent defences and only one of them survives a template edit.
    radios(element)[1]?.dispatchEvent(new Event('change'));
    await element.updateComplete;

    expect(announced).toBe(0);
    expect(element.mode).toBe('system');
  });

  it('explains why it is disabled rather than disappearing', async () => {
    const element = mount();
    element.locked = true;
    await element.updateComplete;

    // A control that vanishes reads as a bug; a disabled one that says why reads
    // as a decision. The radios must still be present.
    expect(radios(element)).toHaveLength(3);
    expect(element.shadowRoot?.querySelector('.lock-note')?.textContent).toContain(
      'Set by the page hosting this view',
    );
  });
});

describe('ptk-theme-control accessibility', () => {
  it('groups the options as a labelled radiogroup', async () => {
    const element = mount();
    await element.updateComplete;

    const group = element.shadowRoot?.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('Theme');
    expect(element.shadowRoot?.querySelector('legend')?.textContent).toBe('Theme');
  });

  it('gives every radio an accessible name and one shared group name', async () => {
    const element = mount();
    await element.updateComplete;

    const inputs = radios(element);
    expect(inputs.map((input) => input.closest('label')?.textContent.trim())).toEqual([
      'System',
      'Light',
      'Dark',
    ]);
    // A single `name` is what makes them one radio group rather than three
    // independent toggles, for both the browser and a screen reader.
    expect(new Set(inputs.map((input) => input.name))).toEqual(new Set(['theme-mode']));
  });
});
