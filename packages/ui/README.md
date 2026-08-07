# @platform-toolkit/ui

Shared custom elements, design tokens, and theme wiring used by every tool.

The only package in the collection that touches the DOM. Tools own their own domain logic and their
own presentation; what they share is the chrome — the theme, the tokens it is expressed in, and the
elements that must look and behave identically wherever they appear.

An element earns a place here by having a second consumer that would otherwise fork it, not by being
free of domain vocabulary. `ptk-plate-stack` and `ptk-equipment-setup` both know what a plate
weighs; they take that vocabulary from `@platform-toolkit/domain` rather than inventing it.

## Lit is required

`lit` is a peer dependency (`^3.3.3`), not a bundled one. A second copy of Lit in a page means two
reactive-element base classes and elements that do not upgrade, so the consumer owns the version and
there is exactly one.

## Importing

```js
import '@platform-toolkit/ui/tokens.css';
import { NUMBER_FIELD_CHANGE_EVENT } from '@platform-toolkit/ui';
```

```html
<ptk-number-field label="Bar weight" unit="lb"></ptk-number-field>
```

**Importing the package registers all fourteen tags as a side effect.** There is no `define…()` call
to make. That is the opposite of how `@platform-toolkit/qualification-check` and
`@platform-toolkit/training-logbook` work — they register explicitly — so do not go looking for a
registration function here, and do not import this package twice from two bundles.

`tokens.css` is a separate import because it is CSS, not JavaScript, and it is not optional: the
elements read colour, spacing, type scale and tap-target size from it and fall back to browser
defaults without it. It defines its variables on `:root`, under
`@media (prefers-color-scheme: dark)`, and under `[data-theme="dark"]`, which is what makes the two
theme paths one stylesheet.

`@platform-toolkit/ui/field-reading` is a third entry point, for `parseWeight` and `parseCount` and
the shared error sentences they produce. It pulls in no elements.

## Elements

`ptk-button`, `ptk-choice-group`, `ptk-copy-button`, `ptk-date-field`, `ptk-disclosure`,
`ptk-equipment-setup`, `ptk-notice`, `ptk-number-field`, `ptk-plate-stack`, `ptk-segmented`,
`ptk-select`, `ptk-text-area`, `ptk-text-field`, `ptk-toggle-group`.

Each class is exported alongside its event name and its detail type, so a listener cannot misspell
either.

```js
import { SELECT_CHANGE_EVENT } from '@platform-toolkit/ui';

const select = document.querySelector('ptk-select');
select.options = [
  { value: 'raw', label: 'Raw' },
  { value: 'equipped', label: 'Equipped', group: 'Supportive' },
];

select.addEventListener(SELECT_CHANGE_EVENT, (event) => {
  event.detail.value; // string, or null when the visitor chose the placeholder
});
```

Two things to expect from the events. They are `composed`, so a change from a control nested in your
own shadow tree reaches your root handler looking like the root's own — distinguish them by a
`data-` attribute on the control and not by its label. And a field's detail carries the raw string
the visitor typed, untrimmed and unparsed, because deciding what `12.5.` means is the consumer's
job.

## Theme

```js
import { initializeTheme } from '@platform-toolkit/ui';

const stop = initializeTheme();
```

One call per page. It applies the mode from the `theme` query parameter and then listens for
`set-theme` messages from the embedding page, and it returns a function that stops listening.
`applyThemeMode`, `currentThemeMode`, `effectiveTheme` and `listenForHostTheme` are the pieces, if
you need them separately.

The rules themselves — what a mode means, what a message may say — live in
`@platform-toolkit/configuration`. This package is only the part that touches the document.

There is no theme flash to work around: `system` is handled entirely by `prefers-color-scheme` in
the tokens, so the default case runs no JavaScript.

## Embed height

An embeddable page tells its host how tall it is, and nothing else.

```js
import { publishEmbedHeightOnResize } from '@platform-toolkit/ui';

const stop = publishEmbedHeightOnResize({ tool: 'qualify' });
```

`tool` is required and is held to lowercase kebab case, so a page framing two tools can tell the two
heights apart. `publishEmbedHeight` sends one measurement; `measureEmbedHeight` just measures. Both
are no-ops when the page is not framed.

## Licence

Apache-2.0. See the repository `LICENSE`.
