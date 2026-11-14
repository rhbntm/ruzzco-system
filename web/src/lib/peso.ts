/**
 * Peso amounts as the phone shows them (slice 17b): two decimals and thousands separators,
 * "₱1,000.00". Pure, and written out by hand rather than through the browser's locale data, so
 * every phone and the tests print the same text.
 */
export function peso(value: number): string {
  const centavos = Math.round(Math.abs(value) * 100);
  const whole = Math.floor(centavos / 100).toString().replace(/\B(?=(\d{3})+$)/g, ",");
  const cents = (centavos % 100).toString().padStart(2, "0");
  // No "-₱0.00" for a value that rounds to nothing.
  return `${value < 0 && centavos > 0 ? "-" : ""}₱${whole}.${cents}`;
}
