/**
 * The `data-field` names, in one place because two files have to agree on them.
 *
 * The root reads answers by walking `event.composedPath()` and looking for a
 * `data-field` (§5.8), which means the string on the control and the string in
 * the switch are a contract written twice. Spelled as literals in both, a typo
 * compiles, renders, and produces a control that visibly responds while nothing
 * is recorded -- which reads as a rendering fault rather than a wiring one. As
 * constants, the two spellings cannot drift.
 */
export const LIFT_FIELD = 'lift';
export const WEIGHT_FIELD = 'weight';
export const UNIT_FIELD = 'unit';
export const REPS_FIELD = 'reps';
export const RESERVE_FIELD = 'reserve';
export const TECHNIQUE_FIELD = 'technique';
export const FRESHNESS_FIELD = 'freshness';
export const FORM_QUALITY_FIELD = 'form-quality';
export const EXPERIENCE_FIELD = 'experience';
export const SEX_FIELD = 'sex';
export const ASSISTED_FIELD = 'assisted';
export const ROUND_TO_FIELD = 'round-to';
export const PERCENTAGE_STEP_FIELD = 'percentage-step';
