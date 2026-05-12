// Dollar formatter. Input is a string or number representing dollars
// (e.g. "5.20" or 5.2). Returns "$X.XX" with trailing zeros. Matches
// the inline fmtDollar implementations previously duplicated across
// components/payouts/{AllocationView,EarningsView,EarningsHero}.jsx.
//
// Note: internal allocation math in lib/allocation/calculate.js uses
// hundredths of cents (1 unit = $0.0001), but the calculator returns
// pre-formatted dollar strings on the wire. This helper formats those
// wire values; do not pass raw hundredths-of-cents.
export function formatDollar(amount) {
  const n = parseFloat(amount || '0');
  return `$${n.toFixed(2)}`;
}
