// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The shapes a remembered setting is allowed to have.
 *
 * WHY THIS IS A CLOSED SET AND NOT "ANY VALIBOT SCHEMA"
 *
 * Two kinds of thing pass through a tool in this collection, and only one of
 * them may ever be written to a disk:
 *
 *   - What the lifter owns and prefers: kilograms or pounds, a 20 kg bar,
 *     competition collars, which plates are in the rack. Forgetting this between
 *     visits is the difference between a tool that is used at a rack and a tool
 *     that is re-configured at a rack.
 *   - Who the lifter is: a name, a profile address, a date of birth, a
 *     competition history imported from somewhere else. None of this may be
 *     persisted (see the privacy rules), and "we remembered to not save it" is
 *     not a mechanism.
 *
 * So the distinction is built into the type system rather than written on a
 * sticky note. A preference can only be defined against a `PreferenceValue`, a
 * `PreferenceValue` can only be produced by the static builders below, and there
 * is no builder that admits free text. A name has nowhere to go. A URL has
 * nowhere to go. A date of birth has nowhere to go. Adding a `text()` builder
 * would be the change that opens the hole, which makes it a change a reviewer
 * can see in a diff instead of an omission a reviewer has to notice.
 *
 * The constructor is private and the builders are static, which is the same
 * smart-constructor shape the domain package uses: the invariant is unforgeable
 * from outside, so nothing downstream has to re-check it.
 */
import * as v from 'valibot';

/** Inclusive bounds a stored number must fall within. */
export interface QuantityBounds {
  readonly min: number;
  readonly max: number;
}

/**
 * The shape of an identifier {@link PreferenceValue.publishedId} will hold.
 *
 * Dots as well as hyphens, because a weight-class identifier carries the class
 * in it and half of them are fractional -- a ladder runs `f-60`, `f-67.5`,
 * `f-75`, and a pattern without the dot silently refuses to remember the
 * lifters in every other class.
 *
 * The empty alternative is "not answered". It is spelled as its own branch
 * rather than reached by making the whole expression optional, because a
 * stored `''` and a missing key mean different things to the store: a missing
 * key fails the shape and resets the whole preference, and an unanswered
 * optional question must not do that to the four answers beside it.
 */
const PUBLISHED_ID_PATTERN = /^$|^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/**
 * Long enough for any identifier a federation has published and short enough
 * that a corrupted entry cannot become a payload.
 */
const PUBLISHED_ID_MAX_LENGTH = 64;

/** Maps a record of value shapes to the object type they describe together. */
type ShapeOf<Fields> = {
  readonly [Key in keyof Fields]: Fields[Key] extends PreferenceValue<infer Value> ? Value : never;
};

function assertUsableBounds(bounds: QuantityBounds): void {
  if (!Number.isFinite(bounds.min) || !Number.isFinite(bounds.max)) {
    throw new RangeError('Preference bounds must be finite numbers');
  }
  if (bounds.min > bounds.max) {
    throw new RangeError(`Preference bounds are inverted: ${bounds.min} > ${bounds.max}`);
  }
}

/**
 * A shape a stored preference may take, and the schema that checks it on the
 * way back in.
 */
export class PreferenceValue<Stored> {
  /**
   * The schema every read is validated against.
   *
   * Public because the store needs it; harmless to expose because the only way
   * to get one of these objects is through a builder below.
   */
  readonly schema: v.GenericSchema<Stored>;

  private constructor(schema: v.GenericSchema<Stored>) {
    this.schema = schema;
  }

  /**
   * Whether a candidate would be accepted, asked without attempting a write.
   *
   * `PreferenceStore.write` throws on a value that violates its definition, and
   * that is right: it is a caller bug, and the alternative is a setting that
   * silently never sticks. But some values are not the caller's to guarantee.
   * An identifier out of published data is the case this was added for -- a
   * federation could rename a weight class to something this shape refuses, and
   * a tool must not take the screen down over it when the honest response is to
   * store the six answers beside it and forget the seventh.
   *
   * A method here rather than a copy of each pattern at each call site: two
   * copies is how a widened shape leaves a caller still refusing values the
   * store would now take, and the symptom is a setting that stops being
   * remembered with nothing to explain why.
   */
  accepts(candidate: unknown): candidate is Stored {
    return v.is(this.schema, candidate);
  }

  /**
   * One value out of a fixed list.
   *
   * The list is the point. `choice(['kg', 'lb'])` can hold a unit and cannot
   * hold anything else, so a stored unit can be dropped straight into an
   * attribute or a lookup without being re-checked at the point of use.
   */
  static choice<const Values extends readonly [string, ...string[]]>(
    values: Values,
  ): PreferenceValue<Values[number]> {
    return new PreferenceValue<Values[number]>(v.picklist(values));
  }

  /** A yes or no: a checkbox the visitor ticked. */
  static flag(): PreferenceValue<boolean> {
    return new PreferenceValue(v.boolean());
  }

  /**
   * An identifier the visitor picked out of published data, or `''` for "not
   * picked".
   *
   * WHY THIS EXISTS AT ALL
   *
   * {@link choice} needs its options at module load and these do not exist
   * then: a weight class, an equipment category, an age division and a state
   * are all named by the federation, in an artifact fetched at runtime. A tool
   * that cannot remember which weight class somebody is in is a tool that asks
   * again at every rack, which is the difference the whole package exists to
   * make.
   *
   * WHY IT IS NOT THE `text()` BUILDER THIS FILE FORBIDS
   *
   * Two things, and the second is the load-bearing one.
   *
   * The charset is the weaker of the two. Lowercase, digits, and single dots or
   * hyphens between them, capped at 64 characters: no whitespace, no capitals,
   * no `@`, no `/`, no `:`. That excludes a URL, an email address, and a name
   * as anybody would actually write one. It does not exclude a name somebody
   * deliberately slugified, and it does not exclude a date of birth -- stating
   * that plainly is better than a claim this pattern cannot support.
   *
   * What does the real work is the rule on the reading side: **a value stored
   * here must be resolved against published data before it is used, and
   * discarded if the source does not offer it.** The Platform Targets resolver
   * already works this way for its own reasons -- an answer the catalogue does
   * not offer is not an answer, or a lifter who corrects their sex category
   * keeps a class from the other ladder -- and any caller of this builder
   * inherits the obligation. So a smuggled name is not merely discouraged: it
   * matches nothing in the catalogue, is dropped on the next read, and has no
   * path to a screen, a log, or a report. There is nothing for it to *do*.
   *
   * That is the difference from a general text builder, which would store
   * whatever it was given and hand it straight back.
   */
  static publishedId(): PreferenceValue<string> {
    return new PreferenceValue(
      v.pipe(v.string(), v.maxLength(PUBLISHED_ID_MAX_LENGTH), v.regex(PUBLISHED_ID_PATTERN)),
    );
  }

  /**
   * A finite number inside stated bounds -- a bar weight, a plate weight.
   *
   * The bounds are required rather than optional so that defining a preference
   * forces someone to answer "what is a ridiculous value for this?". Without
   * them a corrupted or hand-edited entry becomes a bar weight of 1e308, and
   * every total computed from it is `Infinity` on a screen with no explanation.
   */
  static quantity(bounds: QuantityBounds): PreferenceValue<number> {
    assertUsableBounds(bounds);
    return new PreferenceValue(
      v.pipe(v.number(), v.finite(), v.minValue(bounds.min), v.maxValue(bounds.max)),
    );
  }

  /** A whole number inside stated bounds -- how many pairs of a plate exist. */
  static count(bounds: QuantityBounds): PreferenceValue<number> {
    assertUsableBounds(bounds);
    return new PreferenceValue(
      v.pipe(v.number(), v.integer(), v.minValue(bounds.min), v.maxValue(bounds.max)),
    );
  }

  /**
   * A bounded list of one of the shapes above.
   *
   * The length limit is required for the same reason the number bounds are: a
   * plate inventory is a couple of dozen entries, and anything that arrives
   * claiming ten thousand is not an inventory. Rejecting it costs a lifter their
   * remembered rack; accepting it costs them a frozen tab.
   */
  static listOf<Item>(
    item: PreferenceValue<Item>,
    options: { readonly maxLength: number },
  ): PreferenceValue<readonly Item[]> {
    if (!Number.isInteger(options.maxLength) || options.maxLength < 1) {
      throw new RangeError(
        `A preference list needs a whole positive limit, received ${options.maxLength}`,
      );
    }
    return new PreferenceValue<readonly Item[]>(
      v.pipe(v.array(item.schema), v.maxLength(options.maxLength)),
    );
  }

  /**
   * A fixed set of named fields, each one of the shapes above.
   *
   * Unknown keys are dropped rather than refused. A build that adds a field to a
   * preference and is then rolled back would otherwise find every stored value
   * unparseable and reset the lot; dropping the extra key means the older build
   * reads the fields it knows and leaves the visitor's settings intact. A key
   * that is *missing* still fails, because a partial preference has no honest
   * reading.
   */
  static shape<const Fields extends Readonly<Record<string, PreferenceValue<unknown>>>>(
    fields: Fields,
  ): PreferenceValue<ShapeOf<Fields>> {
    const entries = Object.entries(fields).map(([name, value]) => [name, value.schema] as const);
    // `Object.fromEntries` is typed as producing an index signature, which
    // TypeScript cannot relate back to the mapped type above however the entries
    // are built. The mapping is one-to-one and total by construction -- every
    // field contributes exactly its own schema, under its own name -- so the
    // assertion restates what the loop just did rather than asserting anything
    // new.
    const schema = v.object(Object.fromEntries(entries)) as unknown as v.GenericSchema<
      ShapeOf<Fields>
    >;
    return new PreferenceValue(schema);
  }
}
