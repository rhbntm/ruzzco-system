import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { readGatewayStatus, type GatewayConfig, type GatewayStatus } from "@/lib/gateway-config";

export type { GatewayConfig, GatewayStatus } from "@/lib/gateway-config";

/**
 * PayMongo QR Ph, test mode only (slice 5). Server-side only: the secret key never
 * reaches the client bundle. With PAYMENT_GATEWAY unset or "off", every gateway route 404s.
 *
 * Payment status is decided here, from PayMongo data (webhook or intent retrieval), never
 * by the client. A QRPH sale is synced as PENDING; only applyGatewayStatus moves it.
 */

const API = "https://api.paymongo.com/v1";
// A PayMongo call that takes longer fails like any gateway error (the routes answer 502).
const PAYMONGO_TIMEOUT_MS = 15_000;

const warned = new Set<string>();
function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[gateway] ${message}`);
}

/**
 * off, misconfigured or on (see src/lib/gateway-config.ts). Misconfiguration is warned about
 * once and treated as off. Never logs key values.
 */
export function gatewayStatus(): GatewayStatus {
  const status = readGatewayStatus({
    PAYMENT_GATEWAY: process.env.PAYMENT_GATEWAY,
    PAYMONGO_SECRET_KEY: process.env.PAYMONGO_SECRET_KEY,
    PAYMONGO_WEBHOOK_SECRET: process.env.PAYMONGO_WEBHOOK_SECRET,
  });
  if (status.state === "misconfigured") warnOnce(`${status.problem} Gateway disabled.`);
  if (status.state === "on" && status.warning) warnOnce(status.warning);
  return status;
}

/** The config when the gateway is on; null when it is off or misconfigured. */
export function gatewayConfig(): GatewayConfig | null {
  const status = gatewayStatus();
  return status.state === "on" ? status.config : null;
}

// ── Webhook signature ────────────────────────────────────────────────────────

/**
 * Paymongo-Signature: "t=<unix>,te=<test sig>,li=<live sig>". The signature is
 * HMAC-SHA256(webhook secret, `${t}.${rawBody}`) in hex; test mode compares `te`.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const parts = new Map(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
    })
  );
  const t = parts.get("t");
  const te = parts.get("te");
  if (!t || !te) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(te);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── PayMongo API ─────────────────────────────────────────────────────────────

export type QrCode = { imageUrl: string; expiresAt: string | null; testUrl: string | null };

type IntentAttributes = {
  status: string;
  client_key?: string;
  next_action?: { type?: string; code?: { image_url?: string; expires_at?: number | string; test_url?: string } } | null;
  last_payment_error?: unknown;
  payments?: { attributes?: { status?: string; paid_at?: number } }[];
};
type Intent = { id: string; attributes: IntentAttributes };

async function paymongo<T>(config: GatewayConfig, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${config.secretKey}:`).toString("base64")}`,
    },
    body: body === undefined ? undefined : JSON.stringify({ data: { attributes: body } }),
    cache: "no-store",
    signal: AbortSignal.timeout(PAYMONGO_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // Error codes only: PayMongo's detail text stays out of client responses.
    const codes = (json?.errors ?? []).map((e: { code?: string }) => e.code).join(",");
    throw new Error(`PayMongo ${path.split("/")[1]} failed: HTTP ${res.status} ${codes}`);
  }
  return json.data as T;
}

function toIso(value: number | string | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function qrFrom(intent: Intent): QrCode | null {
  const code = intent.attributes.next_action?.code;
  if (intent.attributes.status !== "awaiting_next_action" || !code?.image_url) return null;
  return { imageUrl: code.image_url, expiresAt: toIso(code.expires_at), testUrl: code.test_url ?? null };
}

/** Intent (qrph only) → qrph payment method → attach. Amount in centavos; tip is not charged. */
export async function createQrphCharge(config: GatewayConfig, amount: Prisma.Decimal, transactionId: string) {
  const intent = await paymongo<Intent>(config, "/payment_intents", {
    amount: amount.mul(100).toNumber(),
    currency: "PHP",
    payment_method_allowed: ["qrph"],
    description: "Ruzzco Barbers POS sale (test)",
    metadata: { transactionId },
  });
  const method = await paymongo<{ id: string }>(config, "/payment_methods", { type: "qrph" });
  const attached = await paymongo<Intent>(config, `/payment_intents/${intent.id}/attach`, {
    payment_method: method.id,
    client_key: intent.attributes.client_key,
  });
  return { intentId: intent.id, qr: qrFrom(attached) };
}

/**
 * Reads the intent from PayMongo and maps it to our status. `awaiting_payment_method` after
 * an attach means the QR expired (or the payment failed, if PayMongo reports an error).
 */
export async function retrieveIntentStatus(config: GatewayConfig, intentId: string) {
  const intent = await paymongo<Intent>(config, `/payment_intents/${intentId}`);
  const a = intent.attributes;
  const qr = qrFrom(intent);
  let status: PaymentStatus = "PENDING";
  let paidAt: Date | undefined;
  if (a.status === "succeeded") {
    status = "PAID";
    const paidSeconds = a.payments?.find((p) => p.attributes?.status === "paid")?.attributes?.paid_at;
    paidAt = paidSeconds ? new Date(paidSeconds * 1000) : new Date();
  } else if (a.status === "awaiting_payment_method") {
    status = a.last_payment_error ? "FAILED" : "EXPIRED";
  } else if (qr?.expiresAt && new Date(qr.expiresAt) <= new Date()) {
    status = "EXPIRED";
  }
  return { status, paidAt, qr };
}

// ── One charge per sale ──────────────────────────────────────────────────────

/** The PayMongo calls ensureQrphCharge needs. Tests pass a fake; routes pass paymongoClient(). */
export type QrphClient = {
  createCharge: (amount: Prisma.Decimal, transactionId: string) => Promise<{ intentId: string; qr: QrCode | null }>;
};

export function paymongoClient(config: GatewayConfig): QrphClient {
  return { createCharge: (amount, transactionId) => createQrphCharge(config, amount, transactionId) };
}

export type ChargeResult =
  | { kind: "not_synced" }
  | { kind: "not_qrph" }
  | { kind: "created"; intentId: string; qr: QrCode | null }
  | { kind: "existing"; payment: { intentId: string; status: PaymentStatus } };

// Long enough for the three PayMongo calls in createQrphCharge (15 s each at most).
const CHARGE_TRANSACTION_TIMEOUT_MS = 50_000;

/**
 * Creates the sale's QR Ph charge, or returns the one it already has. Exactly one PayMongo
 * charge per sale: the sale's row is locked (SELECT ... FOR UPDATE) while the charge is
 * created and stored, so a second request for the same sale (a double tap, a retry, the
 * shift log and the POS at once) waits, then finds the stored charge instead of making
 * another. An existing charge is returned as is; the caller refreshes its status.
 */
export async function ensureQrphCharge(transactionId: string, client: QrphClient): Promise<ChargeResult> {
  return prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM transactions WHERE id = ${transactionId} FOR UPDATE`;
      if (locked.length === 0) return { kind: "not_synced" } as const;
      const sale = await tx.transaction.findUniqueOrThrow({
        where: { id: transactionId },
        select: { paymentMethod: true, totalAmount: true, gatewayPayment: { select: { intentId: true, status: true } } },
      });
      if (sale.paymentMethod !== "QRPH") return { kind: "not_qrph" } as const;
      if (sale.gatewayPayment) return { kind: "existing", payment: sale.gatewayPayment } as const;

      // Amount = the sale's totalAmount (amount paid, tip excluded).
      const charge = await client.createCharge(sale.totalAmount, transactionId);
      await tx.gatewayPayment.create({
        data: { transactionId, intentId: charge.intentId, amount: sale.totalAmount, provider: "PAYMONGO_TEST" },
      });
      return { kind: "created", intentId: charge.intentId, qr: charge.qr } as const;
    },
    { timeout: CHARGE_TRANSACTION_TIMEOUT_MS, maxWait: CHARGE_TRANSACTION_TIMEOUT_MS }
  );
}

// ── Status transitions ───────────────────────────────────────────────────────

/**
 * Applies a PayMongo-reported status to the sale and its GatewayPayment in one DB
 * transaction. PENDING moves to anything; EXPIRED/FAILED may still become PAID (the money
 * was taken); PAID is final. With an eventId, the event is recorded in the same transaction,
 * so a redelivered event is a no-op. Returns false when nothing changed.
 */
export async function applyGatewayStatus(
  intentId: string,
  status: PaymentStatus,
  opts: { paidAt?: Date; eventId?: string; eventType?: string } = {}
): Promise<"applied" | "unchanged" | "duplicate" | "unknown_intent"> {
  const payment = await prisma.gatewayPayment.findUnique({ where: { intentId } });
  // Unknown intent: not recorded as processed, so a later redelivery can still apply it.
  // Check status on the POS is the recovery path (slice 5 §6 edge case b).
  if (!payment) return "unknown_intent";

  const allowed =
    status !== "PENDING" &&
    payment.status !== "PAID" &&
    (payment.status === "PENDING" || status === "PAID");

  try {
    return await prisma.$transaction(async (tx) => {
      if (opts.eventId) {
        await tx.gatewayWebhookEvent.create({ data: { eventId: opts.eventId, type: opts.eventType ?? "unknown" } });
      }
      if (!allowed) return "unchanged" as const;
      // Conditional on the status we read, so two concurrent updates cannot both apply.
      const updated = await tx.gatewayPayment.updateMany({
        where: { id: payment.id, status: payment.status },
        data: {
          status,
          paidAt: status === "PAID" ? opts.paidAt ?? new Date() : null,
          ...(opts.eventId ? { lastEventId: opts.eventId } : {}),
        },
      });
      if (updated.count === 0) return "unchanged" as const;
      await tx.transaction.update({ where: { id: payment.transactionId }, data: { paymentStatus: status } });
      return "applied" as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return "duplicate";
    throw error;
  }
}
