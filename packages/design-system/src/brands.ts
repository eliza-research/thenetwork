/** The brands of the design system. Each id names a directory in `brands/` and a `data-brand` value. */
export const brandIds = ["network", "slop", "friends", "peon"] as const

/** One brand of the design system. */
export type BrandId = (typeof brandIds)[number]
