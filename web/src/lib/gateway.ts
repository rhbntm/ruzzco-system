import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * PayMongo QR Ph, test mode only (slice 5). Server-side only: the secret key never
 * reaches the client bundle. With PAYMENT_GATEWAY unset or "off", every gateway route 404s.
 *
 * Payment status is decided here, from PayMongo data (webhook or intent retrieval), never
 * by the client. A QRPH sale is synced as PENDING; only applyGatewayStatus moves it.
 */

const API = "https://api.paymongo.com/v1";

export type GatewayConfig = { secretKey: string; webhookSecret: string };

let warned = false;

/** Null when the gateway is off or misconfigured. Never logs key values. */
export function gatewayConfig(): GatewayConfig | null {
  if (process.env.PAYMENT_GATEWAY !== "paymongo_test") return null;
  const secretKey = process.env.PAYMONGO_SECRET_KEY ?? "";
  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET ?? "";
  if (!secretKey.startsWith("sk_test_")) {
    if (!warned) {
      console.warn("[gateway] PAYMENT_GATEWAY=paymongo_test but PAYMONGO_SECRET_KEY is not a test key (sk_test_...). Gateway disabled.");
      warned = true;
    }
    return null;
  }
  return { secretKey, webhookSecret };
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "duplicate";
    throw error;
  }
}
