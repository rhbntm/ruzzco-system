// The limits shared by the in-memory limiter (pin-attempts.ts) and the database one (rate-limit-db.ts).

export type PinLimits = { perClient: number; shopWide: number; windowMs: number; lockMs: number };

export const DEFAULT_PIN_LIMITS: PinLimits = {
  perClient: 5,
  shopWide: 30,
  windowMs: 15 * 60 * 1000,
  lockMs: 15 * 60 * 1000,
};
