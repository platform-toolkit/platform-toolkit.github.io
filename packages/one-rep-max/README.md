# @platform-toolkit/one-rep-max

An estimated one-rep max from a set that was actually performed, with every published equation shown
behind the figure.

A lifter enters a weight, a repetition count, and as much or as little else as they want to say
about the set — how many repetitions were left in reserve, which movement standard it was done to,
whether they were fresh, whether the form held. Twenty-two published equations are evaluated, the
ones that do not apply to that set are excluded by name, and the survivors are combined into a
conservative figure, a middle figure and an optimistic one.

**The estimate carries a stated grade, and the grade is driven by what the lifter told the tool.** A
set described in one line gets a weaker grade than the same set described fully, and the causes are
listed on screen next to the figure rather than folded away. Answering every optional question can
cancel at most one downgrade and can never beat the cap, so the questions are worth answering
honestly.

Two things it will not do. **The spread between equations is never presented as a confidence
interval** — it is disagreement between published models, which is a different thing, and dressing
it up in the language of probability would be a claim the arithmetic does not support. And **nothing
here says a lifter can complete the number**. No figure is labelled an opener, a safe attempt or a
guaranteed max. It is an estimate of a maximum, not advice about a lift.

There are three ways to use it. Pick the first one that fits; they get more work and more control in
the order they are listed.

---

## 1. Embed the hosted view in an iframe

Nothing to install, and the fastest way to put the tool on a page you own.

```html
<iframe
  src="https://example.invalid/one-rep-max/embed/"
  title="One-rep max estimator"
  style="width: 100%; border: 0"
  height="900"
></iframe>
```

Add `?theme=` to override the visitor's system setting when your page's design requires it —
`system` (the default), `light`, or `dark`. That is the only parameter the route takes. The
repository README's **Theming** section is the full account and applies unchanged here.

The framed view posts its rendered height to the parent so you can size the frame without a
scrollbar:

```js
const frame = document.querySelector('iframe[title="One-rep max estimator"]');

window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow) return;
  const message = event.data;
  if (message?.source !== 'platform-toolkit' || message.type !== 'height') return;
  if (message.tool !== 'one-rep-max') return;
  frame.height = String(message.height);
});
```

A height is the only thing the frame ever sends. It is worth listening for here: the page grows a
long way when the equation comparison is unfolded.

The framed copy remembers the lifter's settings in storage the browser partitions per embedding
site, and may refuse it outright. Nothing here is lost if it does: the tool starts on its defaults
and works exactly as well. The set itself is never written to storage that outlives the tab — see
**Driving the root element** below, which is the same decision seen from the other side.

---

## 2. Install the package

```sh
pnpm add @platform-toolkit/one-rep-max
```

> **Not on a public registry yet.** The package builds and packs — a check in this repository
> installs the tarball into a scratch consumer, type-checks against its shipped declarations and
> runs its core in Node on every run — but nothing has been published. Today you would install it
> from a tarball or a git dependency.

### Entry points

| Import                                  | What is in it                                                           |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `@platform-toolkit/one-rep-max`         | The pure rules and the vocabulary, re-exported. Start here.             |
| `@platform-toolkit/one-rep-max/core`    | The pure rules alone. No Lit, no DOM, no storage, no network, no clock. |
| `@platform-toolkit/one-rep-max/element` | The five custom elements and `defineOneRepMax()`.                       |
| `@platform-toolkit/one-rep-max/types`   | The vocabulary as types only.                                           |

The equations are in none of them. `estimateOneRepMax`, the twenty-two formulas, the evidence
weights and the versioned result object are `@platform-toolkit/domain`, so a consumer that wants the
figure and not the interface can stop one package short of this one.

### Peer expectations

The package depends on `lit` and on `@platform-toolkit/domain`, `@platform-toolkit/preferences` and
`@platform-toolkit/ui` from this collection. It brings no state-management library, no CSS framework
and no HTTP client, it makes no network request of any kind, and it reads no clock.

There is nothing to fetch. Unlike the converter or the qualification check there is no federation
data behind this tool: a published equation's coefficients were fixed the day the paper printed and
cannot change without a release, so they live in code beside their citations.

### Registering the elements

```js
import { defineOneRepMax } from '@platform-toolkit/one-rep-max/element';
import '@platform-toolkit/ui/tokens.css';

defineOneRepMax();
```

The call is explicit rather than a side effect of the import, and it is safe to make any number of
times from any number of modules. The custom element registry is a global that throws on a second
write, so a package that registered its tags on import would hand you a `NotSupportedError` from a
file you did not write, before a line of your own code ran, the first time a bundler failed to
dedupe it. All five tags go in together, and four of them render inside the fifth, so registering
only the root would give you a blank tool with a clean console.

`tokens.css` is a stylesheet, not a framework — the design tokens the elements read for colour,
spacing, type scale and tap-target size. Without it the elements render with the browser's defaults,
including tap targets below the 44 px floor.

### Driving the root element

```html
<ptk-one-rep-max-calculator></ptk-one-rep-max-calculator>
```

| Property   | Type              | What it is                                                     |
| ---------- | ----------------- | -------------------------------------------------------------- |
| `settings` | `PreferenceStore` | Where the unit, lift and step sizes are remembered.            |
| `session`  | `PreferenceStore` | Where the set being described is remembered. Not the same one. |

Both default to a store with no backing, so the element works standing on its own and an embed whose
host blocked storage needs no branch anywhere. Hand it real ones to remember anything:

```js
import {
  browserPreferenceStorage,
  browserSessionStorage,
  createPreferenceStore,
} from '@platform-toolkit/preferences';

element.settings = createPreferenceStore(browserPreferenceStorage());
element.session = createPreferenceStore(browserSessionStorage());
```

**Two stores rather than one, and the split is the point.** The unit, the lift, the movement
standard and the two step sizes are settings: a lifter picks pounds once. The set is not. A weight,
a repetition count and how close to failure it was, reopened next week on a device that may not be
theirs, is a training record the lifter never chose to write — and one of the optional refinements
is a sex marker. Giving `session` a tab-scoped store is what makes the description survive a phone
locking and a reload at the rack, and be gone by Tuesday. Passing the same store twice would quietly
undo that.

---

## 3. Consume the rules

The third reuse route is neither the frame nor the elements: it is `./core`, which is a total
function of its arguments all the way down and needs no browser.

```js
import { EMPTY_ENTRY, requestFor, typeReps, typeWeight } from '@platform-toolkit/one-rep-max/core';
import { estimateOneRepMax } from '@platform-toolkit/domain';

const described = typeReps(typeWeight(EMPTY_ENTRY, '140'), '5');
const estimate = estimateOneRepMax(requestFor(described));
```

- `typeWeight` accepts a keystroke. A unit suffix is honoured and changes the unit: somebody who
  types `315 lb` into a kilogram field has said which unit their number is in.
- `setUnit` converts what was typed rather than rereading it. The entry keeps the weight as it was
  originally entered, so fifty flicks between kilograms and pounds return the number they started
  with, exactly.
- `weightProblem` and `repsProblem` are the judgements about whether a typed figure is acceptable,
  shared by every field that takes one — two fields that read the same input and disagree is a bug
  nobody looks for, because each one is right on its own.
- `requestFor` is the single crossing into the domain, and returns `null` for a set that is not yet
  describable. Build the request through it rather than by hand: the reserve answer is a string here
  (`'2'`) and a number there (`2`), and a hand-written request carrying the wrong one produces an
  answer, the wrong one, silently.
- `DISPLAY_PREFERENCES` and `SET_PREFERENCES` are the preference definitions, bounded and typed, for
  use with any `PreferenceStore`.

The estimate itself is not here. `estimateOneRepMax`, `FORMULAS`, `trainingPercentages` and the
`OneRepMaxEstimate` result object are in `@platform-toolkit/domain`, because a later meet-day plan
has to build on the same versioned object this tool renders rather than on a second copy of the
arithmetic.

---

## Licence

Apache-2.0. See the repository `LICENSE`.
