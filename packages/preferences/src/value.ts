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
