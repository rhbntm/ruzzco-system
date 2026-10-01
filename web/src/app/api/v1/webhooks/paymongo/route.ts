import { NextRequest, NextResponse } from "next/server";
import type { PaymentStatus } from "@prisma/client";
import { applyGatewayStatus, gatewayConfig, verifyWebhookSignature } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// PayMongo event types (docs.paymongo.com, 2026-10-01). Anything else is acknowledged and ignored.
const EVENT_STATUS: Record<string, PaymentStatus> = {
  "payment.paid": "PAID",
  "payment.failed": "FAILED",
  "qrph.expired": "EXPIRED",
};

type EventResource = { id?: string; type?: string; attributes?: { payment_intent_id?: string; paid_at?: number } };

/**
 * POST /api/v1/webhooks/paymongo. The signature is checked against the raw body before
 * anything is parsed; a bad one gets 401. Duplicate event ids are no-ops.
 */
export async function POST(request: NextRequest) {
  const config = gatewayConfig();
  if (!config) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, request.headers.get("paymongo-signature"), config.webhookSecret)) {
    return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
  }

  let event: { data?: { id?: string; attributes?: { type?: string; livemode?: boolean; data?: EventResource } } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const eventId = event.data?.id;
  const type = event.data?.attributes?.type ?? "";
  const resource = event.data?.attributes?.data;
  const status = EVENT_STATUS[type];
  // Test mode only: a live event never changes a sale.
  if (!eventId || !status || event.data?.attributes?.livemode) {
    return NextResponse.json({ success: true, ignored: true });
  }

  const intentId =
    resource?.attributes?.payment_intent_id ?? (resource?.type === "payment_intent" ? resource.id : undefined);
  if (!intentId) return NextResponse.json({ success: true, ignored: true });

  const paidSeconds = resource?.attributes?.paid_at;
  const result = await applyGatewayStatus(intentId, status, {
    eventId,
    eventType: type,
    paidAt: status === "PAID" && paidSeconds ? new Date(paidSeconds * 1000) : undefined,
  });
  if (result === "unknown_intent") console.warn(`[webhook] ${type} ${eventId} for unknown intent; use Check status`);
  return NextResponse.json({ success: true, result });
}
