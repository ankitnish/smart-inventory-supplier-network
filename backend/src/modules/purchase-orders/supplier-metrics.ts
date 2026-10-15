export const MIN_DECIDED_ORDERS = 5;
/**
 * Fulfilment reliability = delivered / (delivered + rejected). Shop-side cancellations are not counted against the supplier.
 * Returns null (shown as "not enough history") below MIN_DECIDED_ORDERS instead of inventing a score.
 */
export function reliability(delivered: number, rejected: number): number | null {
  const decided = delivered + rejected;
  return decided < MIN_DECIDED_ORDERS ? null : Math.round((delivered / decided) * 1000) / 1000;
}
