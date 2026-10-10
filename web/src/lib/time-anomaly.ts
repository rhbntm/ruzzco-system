// Detects a sale whose phone timestamp should not pick its business day on its own (L5).
// Pure: the sync route passes the server's clock in, and tests pass any clock they need.
//
// Server time is the reference. Two checks, five minutes of tolerance each:
//   FUTURE_TIMESTAMP   the sale is stamped more than 5 minutes after the server received it.
//   DEVICE_CLOCK_SKEW  the phone's clock when it sent the batch (sentAt) was more than
//                      5 minutes off the server's, so its timestamps are suspect too.
// When both apply, DEVICE_CLOCK_SKEW wins: the wrong clock explains the future timestamp.
// There is no maximum age: an old sale from a phone with a correct clock is an ordinary
// offline sale and is never flagged for being late.
//
// Limitation: a phone whose clock was wrong when the sale was made, and corrected before it
// synced, sends a correct sentAt. A past timestamp from it looks like an ordinary offline sale
// and is not flagged; a future one is only caught while it is still in the future.

export const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

export type TimeFlagName = "FUTURE_TIMESTAMP" | "DEVICE_CLOCK_SKEW";
export type TimeAnomaly = { flag: TimeFlagName; skewSeconds: number };

export function detectTimeAnomaly(input: { transactionTime: Date; sentAt?: Date; serverNow: Date }): TimeAnomaly | null {
  const { transactionTime, sentAt, serverNow } = input;
  if (sentAt) {
    const skewMs = sentAt.getTime() - serverNow.getTime(); // + = phone ahead
    if (Math.abs(skewMs) > CLOCK_TOLERANCE_MS) {
      return { flag: "DEVICE_CLOCK_SKEW", skewSeconds: Math.round(skewMs / 1000) };
    }
  }
  const aheadMs = transactionTime.getTime() - serverNow.getTime();
  if (aheadMs > CLOCK_TOLERANCE_MS) {
    return { flag: "FUTURE_TIMESTAMP", skewSeconds: Math.round(aheadMs / 1000) };
  }
  return null;
}
