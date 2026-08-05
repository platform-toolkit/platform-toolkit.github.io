# @platform-toolkit/qualification-check

Read a lifter's competition history against a meet's published entry criteria.

The tool puts two published things side by side — what a federation says a meet requires, and what a
lifter has actually totalled — and lets a person read one against the other. It reports
classification per lift and on the total, drug-tested status, the qualifying window a result falls
inside, and, where a meet has been transcribed, each of that meet's routes in turn.

**It never rules on whether anybody may enter a meet.** There is no `eligible` field anywhere in
this package and there must never be one; a federation decides who may enter its meets, and this
package hands a reader the pieces they would otherwise correlate by hand. Where the answer is not
knowable from published figures — a category the federation does not publish, a result outside the
window, a spelling the archive and the federation disagree about — the reading says so in those
words rather than guessing.

There are three ways to use it. Pick the first one that fits; they get more work and more control in
the order they are listed.

---

## 1. Embed the hosted view in an iframe

Nothing to install, and the fastest way to put the tool on a page you own.

```html
<iframe
  src="https://example.invalid/qualify/embed/uspa/"
  title="Qualification Check"
  style="width: 100%; border: 0"
  height="900"
></iframe>
```

The trailing path segment names the federation whose published figures the view reads. Add `?theme=`
to override the visitor's system setting when your page's design requires it — `system` (the
default), `light`, or `dark`. The repository README's **Theming** section is the full account, and
it applies unchanged here.

The framed view posts its rendered height to the parent so you can size the frame without a
scrollbar:

```js
window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.source !== 'platform-toolkit' || message.type !== 'height') return;
  if (message.tool !== 'qualify') return;
  frame.height = String(message.height);
});
```

**A height is the only thing the frame ever sends.** This screen holds somebody's competition
results, their bodyweight, their age and the categories they enter in, and none of that crosses the
frame boundary in either direction. Embedding grants the parent page no access to the data in the
view and no control over it. Nothing is installed on your visitors either: a framed document
registers no service worker and links no web app manifest.

The frame is the whole tool, including the result form and the profile-import path. If you want a
piece of it, or your own layout around it, use the package.

---

## 2. Install the package

```sh
pnpm add @platform-toolkit/qualification-check
```

> **Not on a public registry yet.** The package builds and packs — a check in this repository
> installs the tarball into a scratch consumer and builds against it on every run — but nothing has
> been published. Today you would install it from a tarball or a git dependency.

### Entry points

| Import                                          | What is in it                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `@platform-toolkit/qualification-check`         | The pure rules and the vocabulary, re-exported. Start here.             |
| `@platform-toolkit/qualification-check/core`    | The pure rules alone. No Lit, no DOM, no storage, no network, no clock. |
| `@platform-toolkit/qualification-check/element` | The custom elements and `defineQualificationCheck()`.                   |
| `@platform-toolkit/qualification-check/types`   | The vocabulary as types only.                                           |

`./core` is a total function of its arguments all the way down, so a consumer that renders nothing —
a script, a server, another tool's rules — can still ask the question.

### Peer expectations

The package depends on `lit`, and on `@platform-toolkit/data-contracts`, `@platform-toolkit/domain`
and `@platform-toolkit/ui` from this collection. It brings no state-management library, no CSS
framework, and no HTTP client. It reads no clock: the day is a property you set.

### Registering the elements

```js
import { defineQualificationCheck } from '@platform-toolkit/qualification-check/element';
import '@platform-toolkit/ui/tokens.css';

defineQualificationCheck();
```

The call is explicit rather than a side effect of the import, and it is safe to make any number of
times from any number of modules. The custom element registry is a global that throws on a second
write, so a package that registered its tags on import would hand you a `NotSupportedError` from a
file you did not write, before a line of your own code ran, the first time a bundler failed to
dedupe it. Six tags are registered together; five of them live inside the sixth's shadow root, and
registering only the root would render a blank tool with a clean console.

`tokens.css` is a stylesheet, not a framework — the design tokens the elements read for colour,
spacing, type scale and tap-target size. Without it the elements render with the browser's defaults.

### Driving the root element

```html
<ptk-qualification-check></ptk-qualification-check>
```

Everything the element needs is a property; it fetches nothing and stores nothing.

| Property          | Type                               | What it is                                                             |
| ----------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `vocabulary`      | `CatalogVocabulary \| null`        | The federation's equipment, weight-class ladders and age divisions.    |
| `importedEntries` | `readonly AthleteEntry[]`          | Competition history. Setting it again replaces the list.               |
| `tables`          | `readonly ClassificationTable[]`   | Classification standards to grade against.                             |
| `standardsStatus` | `'loading' \| 'ready' \| 'failed'` | Whether `tables` is the answer yet, so an empty list can be explained. |
| `book`            | `QualifyingMeetBook \| null`       | Transcribed meets and their criteria, or `null` where none exist.      |
| `today`           | `CalendarDay \| null`              | The day the page is being read on, `YYYY-MM-DD`. Supplied, never read. |

`today` is a string and not a `Date` on purpose: `new Date('1990-05-15')` is midnight UTC, which is
the fourteenth of May anywhere west of Greenwich, and a qualifying window that ends today is exactly
where that costs somebody an answer.

### The event you must handle

```js
element.addEventListener('ptk-qualification-standards-needed', async (event) => {
  const { sex, equipmentId } = event.detail;
  element.standardsStatus = 'loading';
  const book = await source.getClassifications({ federationId, sex, equipmentId }, { signal });
  element.tables = book?.tables ?? [];
  element.standardsStatus = 'ready';
});
```

Classification standards are published one partition per sex and equipment category, so the element
asks for the partition it needs rather than expecting you to hold them all. A consumer that does
hold them all may set `tables` once and ignore the event — nothing here filters, so a table for
another category simply never matches.

Abort the read you started for the previous event when a new one arrives. The reader changes their
answers faster than a network responds, and a late reply for a category they have left is a set of
standards for the wrong person.

### Storage

There is none. The package holds no `localStorage`, no IndexedDB and no cookie, and it writes
nothing about a lifter anywhere. If your host wants to remember something, it owns that decision and
the storage that implements it.

---

## 3. Consume the data contracts

The third reuse route is neither the frame nor the element: it is the shapes. Every type this
package reads is defined in `@platform-toolkit/data-contracts` and validated there at the boundary,
which is what lets one tool's output become another tool's input without either of them knowing the
other exists.

```js
import {
  collectStandings,
  findQualifyingMeet,
  readMeetCriteria,
} from '@platform-toolkit/qualification-check/core';
```

- `AthleteEntry` is a competition result. It is what an archive import produces, what this tool's
  own result form produces, and what any other tool producing results should produce.
- `ClassificationTable` and `ClassificationStandard` are a federation's published standards. The
  same tables drive the classification readouts in the other tools in this collection.
- `QualifyingMeet`, `QualifyingRoute` and `QualifyingCondition` are a transcribed meet's criteria.
- `CategoryCatalog` is one federation's equipment, weight-class ladders and age divisions.

Federation figures live in published data artifacts and never in this source. That is the rule that
makes a rule change a data refresh rather than a release, and it is why nothing in this package
names a federation, a weight class or a qualifying total.

**Crossing between an archive's vocabulary and a federation's is a claim, and this package will not
make it silently.** An archive keeps its own spellings; a federation keeps its own identifiers.
`proposeSex`, `proposeEquipment`, `proposeWeightClassFromEntry` and the rest return a
`CategoryProposal` carrying what was observed, every candidate that matched, and the basis for the
match — and `mayPreselect(basis)` is true only for a measured one. A proposal read from a spelling
is shown to the reader and never chosen for them. The case that rule exists for is a 115 kg woman
being placed in a men's 125 kg class by a tool that was sure it had understood the archive.

---

## Licence

Apache-2.0. See the repository `LICENSE`.
