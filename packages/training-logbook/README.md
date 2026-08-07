# @platform-toolkit/training-logbook

Plan a session, tick off each set as you finish it, and keep the record on the device that recorded
it.

There is no account, no server and no sync. A workout is written to the browser's own storage the
moment it changes, the screen says on every page whether that storage is really keeping it, and the
way training leaves the device is a JSON file the lifter downloads. That is the whole data model,
and it is the reason the tool is usable in a basement gym with one bar of signal.

Describe your rack once — the bar, the plates in the box, the collars — and save it under a name,
which is how anybody who trains in two rooms switches between them instead of retyping an inventory.
Everything else follows from knowing what is on the floor. Each set on the logging screen draws what
goes on each end of the bar and what to change since the set before it. A weight the plates cannot
build is named as one, with the nearest weights they can build either side of it, and the number the
lifter typed is left exactly as it was typed. A planned lift the catalogue knows a warm-up family
for can be ticked to have its ramp worked out when the session starts, by calling the warm-up
calculator's rules rather than keeping a second copy of them.

A session already set up in that calculator can be landed here whole. It travels through this
device's own storage rather than through a link: a URL carrying a session carries it into the
address bar, the history and the next site's `Referer`, which is the opposite of what this tool
promises.

The record reads back. A finished session opens for correction months later, the logging screen
shows what the same lift did last time, every lift has a history of its own with the heaviest days
marked, and any past session can be repeated as today's plan. Sets, exercises and sessions each take
a note, and the catalogue takes exercises the lifter adds to it. Between sets an optional timer
counts down the rest that lift was planned around — on screen only: no sound, no buzz, no
notification, which is said where it is switched on.

**It does not tell anybody what to lift.** A missed set is recorded and not scored, an effort rating
is stored and not interpreted, and nothing here derives a programme from a history. Prescribing is a
different tool with a different burden of proof; a logbook that quietly started coaching would be
giving advice nobody asked for and nobody can see the basis of.

There are three ways to use it. Pick the first one that fits; they get more work and more control in
the order they are listed.

---

## 1. Embed the hosted view in an iframe

Nothing to install, and the fastest way to put the tool on a page you own.

```html
<iframe
  src="https://example.invalid/logbook/embed/"
  title="Training Logbook"
  style="width: 100%; border: 0"
  height="900"
></iframe>
```

There is no federation segment in that path, and there is not one anywhere in this tool. Every other
tool in the collection reads a governing body's published figures and has to say whose; a set of
five at 140 kg is the same set of five whoever sanctions the meet.

Add `?theme=` to override the visitor's system setting when your page's design requires it —
`system` (the default), `light`, or `dark`. That is the only parameter the route takes. The
repository README's **Theming** section is the full account and applies unchanged here.

The framed view posts its rendered height to the parent so you can size the frame without a
scrollbar:

```js
window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.source !== 'platform-toolkit' || message.type !== 'height') return;
  if (message.tool !== 'logbook') return;
  frame.height = String(message.height);
});
```

**A height is the only thing the frame ever sends, and there is deliberately no message that could
carry a workout.** Embedding grants the parent page no access to the training in the view and no
control over it. Nothing is installed on your visitors either: a framed document registers no
service worker and links no web app manifest.

### One thing to know before you frame it

A browser may partition or refuse storage to a cross-origin frame — Safari does by default, and
Chrome and Firefox increasingly do — so a framed copy of a tool whose whole promise is "this stays
on your device" may be handed no device to stay on. Storage is also partitioned per embedding site,
so the same lifter using the same tool on two different pages has two separate logbooks and neither
knows about the other.

This is not a defect that a setting fixes. What the tool does about it is ask, report the answer on
screen in plain words, and offer the JSON backup either way: **Saved on this device** or **Not saved
on this device**, on every screen, before anything is typed. A lifter who is told the truth up front
can decide whether to use the framed copy or the standalone one; a lifter who is not finds out when
a training block disappears.

If your visitors will log real training rather than try the tool out, link to the standalone route
instead of framing it. That copy is a first-party document, gets ordinary storage, installs as an
application, and works with no network.

---

## 2. Install the package

```sh
pnpm add @platform-toolkit/training-logbook
```

> **Not on a public registry yet.** The package builds and packs — a check in this repository
> installs the tarball into a scratch consumer, type-checks against its shipped declarations and
> runs its core in Node on every run — but nothing has been published. Today you would install it
> from a tarball or a git dependency.

### Entry points

| Import                                       | What is in it                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `@platform-toolkit/training-logbook`         | The pure rules and the vocabulary, re-exported. Start here.             |
| `@platform-toolkit/training-logbook/core`    | The pure rules alone. No Lit, no DOM, no storage, no network, no clock. |
| `@platform-toolkit/training-logbook/element` | The custom elements and `defineTrainingLogbook()`.                      |
| `@platform-toolkit/training-logbook/handoff` | The calculator's record, the key it travels in, and the reader over it. |
| `@platform-toolkit/training-logbook/storage` | The storage port, two adapters, and the repository built over them.     |
| `@platform-toolkit/training-logbook/types`   | The persisted vocabulary as types only.                                 |

The root entry point re-exports `./core` and `./types` and stops there. Pulling `./storage` in as
well would put IndexedDB into the module graph of a consumer that only wanted to score a session in
a script, and the two entry points exist precisely so that does not happen.

`./core` is a total function of its arguments all the way down. Every operation is a function from
one workout value to the next, which is what makes "what happens if the phone dies here" a thing a
test can express rather than a thing a test can simulate.

### Peer expectations

The package depends on `lit`, on `valibot` for validating what comes back out of storage, and on
`@platform-toolkit/domain` and `@platform-toolkit/ui` from this collection. It brings no
state-management library, no CSS framework, and no HTTP client. It makes no network request of any
kind, and it reads no clock: the day and the instant are properties you set.

### Registering the elements

```js
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import '@platform-toolkit/ui/tokens.css';

defineTrainingLogbook();
```

The call is explicit rather than a side effect of the import, and it is safe to make any number of
times from any number of modules. The custom element registry is a global that throws on a second
write, so a package that registered its tags on import would hand you a `NotSupportedError` from a
file you did not write, before a line of your own code ran, the first time a bundler failed to
dedupe it. All the tags go in together, and every one but the root renders inside the root, so
registering only the root would give you a blank tool with a clean console.

`tokens.css` is a stylesheet, not a framework — the design tokens the elements read for colour,
spacing, type scale and tap-target size. Without it the elements render with the browser's defaults,
including tap targets below the 44 px floor the gym flow is built to.

### Driving the root element

```html
<ptk-training-logbook></ptk-training-logbook>
```

| Property             | Type                                | What it is                                                     |
| -------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `repository`         | `TrainingLogbookRepository \| null` | Where training is kept. Everything below is about this.        |
| `today`              | `CalendarDay`                       | The lifter's own calendar day, `YYYY-MM-DD`.                   |
| `now`                | `() => Instant`                     | The current instant as an ISO string. Called, never cached.    |
| `nextId`             | `() => LogbookId`                   | A fresh opaque identifier. Defaults to `crypto.randomUUID()`.  |
| `applicationVersion` | `string`                            | Stamped into a backup file, for a human reading it much later. |
| `handoff`            | `HandoffSource \| null`             | Where a session handed over by the warm-up calculator waits.   |

`today` is a string and not a `Date` on purpose: `new Date('2026-05-15')` is midnight UTC, which is
the fourteenth of May anywhere west of Greenwich — and a training log is a record of which day
somebody trained on. It is a separate property from `now` for the same reason. Derive it from the
lifter's own locale, and refresh it when the tab becomes visible again, or a session logged after
midnight lands on the day the tab was opened.

### Storage is an adapter you supply

Section 15 of this collection's architecture puts storage behind a port. The package ships two
implementations and will take yours.

```js
import { createRepository, openLogbookStore } from '@platform-toolkit/training-logbook/storage';

const store = await openLogbookStore();
element.repository = createRepository(store, {
  now: () => new Date().toISOString(),
  applicationVersion: '2026.8.5',
});
```

`openLogbookStore()` returns IndexedDB where the browser gives one and an in-memory store where it
does not, so **a refused database is a state the tool renders rather than an error it throws**. The
in-memory store reports `durable: false`, that flag reaches the screen as **Not saved on this
device**, and the lifter is told before they type rather than after they lose a block. Hold that
property honest in your own adapter; it is the only thing standing between somebody and a silent
loss.

The port is `LogbookStore`, and it is deliberately small and dumb: read and write settings, the
active-workout pointer, workouts, custom exercises and equipment profiles, plus `replaceAll` and
`clearAll`. It makes no decisions. `createRepository` is what turns it into the interface the
element uses, and that is where the rules about what may be written when live.

`openLogbookStore()` can still reject — with a `LogbookStorageError` carrying a coarse `reason` of
`unavailable`, `operation-failed` or `corrupt-record` — when a database exists but is blocked by
another tab holding an older version open. Catch it and fall back to `memoryLogbookStore()`, which
is what this repository's own shell does. The error type has nowhere to put a workout, a note or an
exercise name, and that is the enforcement of the privacy rule rather than a habit.

### The handoff reader is the other thing you supply

A session set up in the warm-up calculator reaches the logbook through storage on the same origin,
and the element reads it through a reader you hand in — for the reason it takes a repository rather
than opening one. `./handoff` is that subpath, and it stands on its own so that the tool _writing_ a
record takes none of the rest of this package with it.

```js
import { createHandoffSource } from '@platform-toolkit/training-logbook/handoff';

element.handoff = createHandoffSource(
  {
    read: (key) => localStorage.getItem(key),
    write: (key, value) => localStorage.setItem(key, value),
    remove: (key) => localStorage.removeItem(key),
  },
  { now: () => Date.now() },
);
```

The reader is asked once, when the property arrives, and never on a render path: `peek()` goes to
storage and parses a document. It does not consume what it finds, so the offer survives a reload,
and only a record that can never be used — unparseable, or older than the hour `HANDOFF_MAX_AGE_MS`
allows — is forgotten in passing. Leave `handoff` unset and the home screen never offers anything,
which is the right answer on a page with no sibling calculator.

**Do not give a framed copy a reader.** A third-party frame is handed storage partitioned to the
embedding site, and the calculator wrote its record to the top-level origin, so the key the reader
is looking for has never existed there and never will. What that buys is a reader that always
answers nothing — the same screen with a moving part behind it. This repository's own shell supplies
one on the standalone route and deliberately not on the embed route.

`offerHandoff` is the other side, for a tool writing a record: it puts one under
`HANDOFF_STORAGE_KEY` and answers `'offered'` or `'unavailable'` rather than throwing, so a page
that offers to hand a session over can say whether it managed to. The age is the reader's question
and not the writer's, because a record is written once and read on a page that may be opened at any
point afterwards.

### Events

Seven, all of them local browser events, and **none of them carries training data**.

| Event                         | Detail                 |
| ----------------------------- | ---------------------- |
| `training-workout-started`    | `{ workoutId }`        |
| `training-set-completed`      | `{ workoutId, setId }` |
| `training-workout-completed`  | `{ workoutId }`        |
| `training-workout-saved`      | `{ workoutId }`        |
| `training-backup-exported`    | `{ workoutCount }`     |
| `training-backup-restored`    | `{ workoutCount }`     |
| `training-local-data-cleared` | `{ workoutCount }`     |

`training-backup-restored` fires only once the write has landed **and** been read back, so a host
acting on it is acting on a device that holds what the file did. `training-local-data-cleared` is
the same promise inverted: it fires only once the database has been read back empty, and its count
is what was destroyed rather than what is left.

There is no event for the Markdown download. The list is closed at seven, and a new button beside an
existing one is not a reason to invent an eighth.

An identifier and a count, never a weight, a rep count, a note or an exercise. A listener that wants
to know a backup happened is served by the count; one that wants the contents is asking the page to
hand somebody's training history to whatever else is listening on the document. **Do not transmit
these anywhere.** They exist so a host can react — refresh its own view, dismiss a prompt — not so a
host can observe a lifter.

Every one is typed through `HTMLElementEventMap`, so `addEventListener` narrows the detail without a
cast.

---

## 3. Consume the data contracts

The third reuse route is neither the frame nor the element: it is the shapes. This is the one tool
in the collection that reads no published federation data, so its vocabulary is its own, exported
from `./types` and validated at the one boundary it has — the way back out of storage, and the way
back in from a backup file.

```js
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  readBackup,
  backupSummaries,
} from '@platform-toolkit/training-logbook/core';
```

- `WorkoutSession` is one training session: a calendar day, a status, and its exercises. Each
  `WorkoutExercise` holds `WorkoutSet`s, and each set holds a planned `SetPerformance` and what was
  actually done. Planned and performed are separate fields throughout, because the difference
  between them is the thing a training log is for.
- `SetLoad` is a discriminated union rather than a number, because a chin-up, a barbell squat and a
  band pull-apart are not the same kind of load and a schema that flattened them to kilograms would
  make the empty bar and bodyweight indistinguishable.
- `TrainingLogbookBackup` is the file. It carries `BACKUP_FORMAT`, a `schemaVersion`, the instant it
  was written, the application version that wrote it, and a snapshot: settings, equipment profiles,
  custom exercises, the active workout, and the history.
- `readBackup` is the trust boundary in the other direction. It takes parsed JSON from a file
  somebody chose off their own disk and returns either a backup or a list of problems — never a
  coerced half-restore, and never an exception for the caller to interpret.
- `backupPreview` and `backupSummaries` read a candidate file well enough to tell a lifter what is
  in it before they let it replace anything.

A backup is a plain, documented, versioned JSON file rather than an export format, and that is the
whole answer to "what happens to my training if this project stops". Anything that can read JSON can
read it, this package's own reader is one of those things, and neither requires the other.

There is a second, human-readable output beside it, and it is deliberately not a second backup:

```js
import { markdownExport, markdownFilename } from '@platform-toolkit/training-logbook/element';
```

`markdownExport` turns a `TrainingLogbookBackup` into a Markdown document — every session, every
set, planned against performed, notes kept whole and best-set markers where the history screen shows
them. It is a rendering, which is why it lives on `./element` next to the words it composes rather
than on `./core`, and it touches no DOM, so a Node script can call it. Nothing reads it back: the
document says so in its own first line, because the JSON is the file that restores and Markdown has
no version stamp to check.

Plate loading, weight conversion and directional rounding are rules, and the rules are in
`@platform-toolkit/domain`, which the other tools in this collection use as well — a rule copied
into two packages is the fork this collection exists to avoid. What this package adds is the part
that is about a logbook rather than about a barbell: `sessionLoadings` decides which stored plan a
set reads its plates from, so a finished session keeps the answer it was shown, and which sets the
plate-change line under a row is counted from, so a set the lifter says they skipped is not counted
as a bar they loaded. The search underneath both is the domain's.

---

## Licence

Apache-2.0. See the repository `LICENSE`.
