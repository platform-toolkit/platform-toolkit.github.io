# @platform-toolkit/domain

Pure powerlifting calculation. No DOM, no network, no I/O, no clock.

Every tool in this collection is a rendering of something in here. Keeping the calculation separate
from the screen is what lets the same plate maths answer a warm-up planner, a loading table and an
attempt card without three implementations disagreeing about the fifteenth kilogram.

Its only dependency is `@platform-toolkit/data-contracts`, for the published shapes it reads.

## What is in it

| Area                | Entry points                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Weight and units    | `convertWeight`, `formatWeight`, `parseWeightInput`, `enterWeight`, `KILOGRAMS_PER_POUND`       |
| Plates and bars     | `toBarbellSetup`, `buildLoadingTable`, `findLoading`, `plateChange`, `emptyImplement`           |
| Equipment inventory | `DEFAULT_EQUIPMENT`, `BAR_PRESETS`, `COLLAR_PRESETS`, `toggleDenomination`, `setMicroPlates`    |
| One-rep max         | `estimateOneRepMax`, `FORMULAS`, `evaluateFormula`, `trainingPercentages`                       |
| Warm-ups            | `planWarmup`, `adjustWarmups`, `meetWarmup`, `timelineWindows`                                  |
| Attempt selection   | `planAttempts`, `planFromOpener`, `distributeTargetTotal`, `classifyAttemptRisk`, `reviewJumps` |
| Running a meet      | `createMeetDocument`, `applyMeetAction`, `undo`, `meetTotals`, `whatWins`, `coachBoard`         |
| Rules               | `MeetRules`, `changeAllowanceFor`, `recordPlan`                                                 |
| Categories          | `WeightClassLadder`, `ClassificationLadder`, `eligibleAgeDivisions`, `competitionAge`           |
| Records             | `findRecord`, `recordTargets`, `standingAgainstRecord`                                          |
| Dates               | `PlainDate`, `parsePlainDate`, `completedYearsBetween`, `comparePlainDates`                     |

## Example

```js
import {
  DEFAULT_EQUIPMENT,
  buildLoadingTable,
  convertWeight,
  emptyImplement,
  findLoading,
  formatWeight,
  toBarbellSetup,
} from '@platform-toolkit/domain';

const setup = toBarbellSetup(DEFAULT_EQUIPMENT);

emptyImplement(setup); // 45 -- the bar alone
buildLoadingTable(setup, 500); // every loadable total up to 500
findLoading(buildLoadingTable(setup, 500), 315, { bound: 'at-most' });
// { total: 315, perSide: [45, 45, 45] }

formatWeight(convertWeight({ amount: 225, unit: 'lb' }, 'kg')); // '102.06 kg'
```

`findLoading` returns `null` when nothing in the table satisfies the bound. `bound` is
`'at-most' | 'at-least' | 'nearest'`, and choosing it is the caller's decision: a warm-up rounds
down, an opener attempt does not.

## Four conventions worth knowing before you write against it

**A weight is `{ amount, unit }`, never a bare number.** `Weight` and `WeightUnit` carry the unit
through every calculation, so a pound figure cannot be added to a kilogram one. The bare numbers
that do exist are local to a setup whose unit is already fixed — `emptyImplement(setup)` is in the
setup's plate unit.

**A calendar day is a `PlainDate` string, `YYYY-MM-DD`, and never a `Date`.**
`new Date('1990-05-15')` is midnight UTC, which is the fourteenth of May anywhere west of Greenwich,
and a qualifying window that closes today is exactly where that costs somebody an answer. Nothing
here reads a clock either: the day is an argument.

**Failure is a returned value, not an exception.** The larger calculations answer a result object —
`{ ok: true, plan }` or `{ ok: false, problems }`. A plan that came back `ok` may still carry
`advisories`, and those are meant to be shown: suppressing them turns an honest "we are guessing
from one data point" into a confident number.

**Federation figures are data.** No weight class, qualifying total or classification standard is
written in this source. They arrive as artifacts through `@platform-toolkit/data-contracts`, which
is what makes a rule change a data refresh rather than a release. `WeightClassLadder.from(classes)`
and `ClassificationLadder` are built from published tables at runtime.

## Licence

Apache-2.0. See the repository `LICENSE`.
