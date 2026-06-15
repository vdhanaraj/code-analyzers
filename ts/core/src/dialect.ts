/**
 * The proof dialect version stamp.
 *
 * Every emitted artifact carries this. The schema is *expected* to churn
 * (v1 -> v3-4 during solo iteration before anyone else is looped in), so the
 * envelope is versioned from line one to de-risk every change. Consumers must
 * branch on this value rather than assume a shape.
 */
export const DIALECT_VERSION = "1" as const;

export type DialectVersion = typeof DIALECT_VERSION;
