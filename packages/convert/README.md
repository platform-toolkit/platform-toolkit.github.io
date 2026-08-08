# @platform-toolkit/convert

Pounds to kilograms and back, against the chart the federation actually published.

Those are two different numbers. 315 lb is 142.8815… kg by arithmetic, and what a meet will let a
lifter load is whatever their federation prints in its own conversion chart — rounded the
federation's way, on the federation's increments. A converter that shows only the arithmetic is
giving an answer nobody can put on an attempt card.

So the published figure leads, in the largest type on the panel, labelled with the federation's own
name. The exact mathematical equivalent follows, labelled as arithmetic and never offered as an
attempt. **A row is never manufactured**: a weight between two published rows gets both rows and
which is nearer, an exact midpoint is reported as a tie and resolves nothing, and a federation that
publishes no chart is a state of its own rather than an error.

Beside the answer are the barbell landmarks — three plates a side, and what that is on a kilogram
platform — listed in the unit being converted _to_, because that is the platform the lifter is
walking onto. The whole chart is underneath, folded, searchable, and copyable row by row.

Reversing the direction converts what is in the field rather than rereading it. The field is backed
by the weight as it was originally typed, so fifty reversals return the number they started with,
exactly.

There are three ways to use it. Pick the first one that fits; they get more work and more control in
the order they are listed.

---

## 1. Embed the hosted view in an iframe

Nothing to install, and the fastest way to put the tool on a page you own.

```html
<iframe
  src="https://example.invalid/convert/embed/uspa/"
  title="Pounds and kilograms converter"
  style="width: 100%; border: 0"
  height="900"
></iframe>
```

The `uspa` segment names whose chart is being quoted, and it is not optional. A conversion chart
belongs to a governing body and the day a second one is published a default would be silently wrong
for half its visitors.

Add `?theme=` to override the visitor's system setting when your page's design requires it —
`system` (the default), `light`, or `dark`. That is the only parameter the route takes. The
repository README's **Theming** section is the full account and applies unchanged here.

The framed view posts its rendered height to the parent so you can size the frame without a
scrollbar:

```js
const frame = document.querySelector('iframe[title="Pounds and kilograms converter"]');

window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow) return;
  const message = event.data;
  if (message?.source !== 'platform-toolkit' || message.type !== 'height') return;
  if (message.tool !== 'convert') return;
  frame.height = String(message.height);
});
```

A height is the only thing the frame ever sends.

The framed copy remembers the direction, the last value and the chart controls in storage the
browser partitions per embedding site, and may refuse it outright. Nothing here is lost if it does:
the tool starts on its defaults and works exactly as well.

---

## 2. Install the package

```sh
pnpm add @platform-toolkit/convert
```

> **Not on a public registry yet.** The package builds and packs — a check in this repository
> installs the tarball into a scratch consumer, type-checks against its shipped declarations and
> runs its core in Node on every run — but nothing has been published. Today you would install it
> from a tarball or a git dependency.

### Entry points

| Import                              | What is in it                                                           |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `@platform-toolkit/convert`         | The pure rules and the vocabulary, re-exported. Start here.             |
| `@platform-toolkit/convert/core`    | The pure rules alone. No Lit, no DOM, no storage, no network, no clock. |
| `@platform-toolkit/convert/element` | The four custom elements and `defineConvert()`.                         |
| `@platform-toolkit/convert/types`   | The vocabulary as types only.                                           |

Fetching the chart is not in any of them. The element takes the chart **and the state of the read**
as properties, which is what makes "still loading", "this federation publishes none" and "the read
failed" three different sentences on screen and three states you can render deliberately.

### Peer expectations

The package depends on `lit` and on `@platform-toolkit/domain`, `@platform-toolkit/data-contracts`,
`@platform-toolkit/preferences` and `@platform-toolkit/ui` from this collection. It brings no
state-management library, no CSS framework and no HTTP client, it makes no network request of any
kind, and it reads no clock.

The conversion arithmetic itself is in `@platform-toolkit/domain` rather than here, because every
tool in the collection converts weights and there is exactly one implementation of it.

### Registering the elements

```js
import { defineConvert } from '@platform-toolkit/convert/element';
import '@platform-toolkit/ui/tokens.css';

defineConvert();
```

The call is explicit rather than a side effect of the import, and it is safe to make any number of
times from any number of modules. The custom element registry is a global that throws on a second
write, so a package that registered its tags on import would hand you a `NotSupportedError` from a
file you did not write, before a line of your own code ran, the first time a bundler failed to
dedupe it. All four tags go in together, and three of them render inside the fourth, so registering
only the root would give you a blank tool with a clean console.

`tokens.css` is a stylesheet, not a framework — the design tokens the elements read for colour,
spacing, type scale and tap-target size. Without it the elements render with the browser's defaults,
including tap targets below the 44 px floor.

### Driving the root element

```html
<ptk-converter></ptk-converter>
```

| Property      | Type                      | What it is                                            |
| ------------- | ------------------------- | ----------------------------------------------------- |
| `chart`       | `ConversionChart \| null` | The federation's published chart, or `null` for none. |
| `chartStatus` | `ChartStatus`             | `loading`, `ready`, `unavailable` or `failed`.        |
| `settings`    | `PreferenceStore`         | Where the direction and controls are remembered.      |

`chartStatus` is four states and not two on purpose. `unavailable` is not an error and does not get
the error tone: the read succeeded and the federation publishes no chart, so a reload changes
nothing. Collapsing it into `failed` is how somebody reloads a page that will never load.

`settings` defaults to a store with no backing, so the element works standing on its own and an
embed whose host blocked storage needs no branch anywhere. Hand it a real one to remember anything:

```js
import { browserPreferenceStorage, createPreferenceStore } from '@platform-toolkit/preferences';

element.settings = createPreferenceStore(browserPreferenceStorage());
```

Direction, the last value, the result precision, the chart step and the column order are what
survive a refresh. The stored value keeps both the unit it was typed in and the unit it is currently
shown in, which is what makes a reload land exactly where the visitor left off instead of restarting
the rounding.

---

## 3. Consume the rules

The third reuse route is neither the frame nor the elements: it is `./core`, which is a total
function of its arguments all the way down and needs no browser.

```js
import { EMPTY_ENTRY, reverse, typeInto, weightProblem } from '@platform-toolkit/convert/core';

const entered = typeInto(EMPTY_ENTRY, '315');
const flipped = reverse(entered); // 142.88 kg, from the origin, not from the rounded figure
```

- `typeInto` accepts a keystroke. A unit suffix is honoured and can change the direction: somebody
  who types `100 kg` while converting kilograms to pounds has said which unit their number is in.
- `reverse` and `setDirection` convert the field rather than reinterpreting it.
- `weightProblem` is the one judgement about whether a typed weight is acceptable, shared by every
  field that takes one — two fields that read the same input and disagree is a bug nobody looks for,
  because each one is right on its own.
- `CONVERTER_PREFERENCES` are the preference definitions, bounded and typed, for use with any
  `PreferenceStore`.

The chart lookup is not here either. `convertAgainstChart`, `nearestRowIndex` and `filterRowsByStep`
are in `@platform-toolkit/domain`, and `ConversionChart.from` is what validates a published chart
before anything reads it.

---

## Licence

Apache-2.0. See the repository `LICENSE`.
