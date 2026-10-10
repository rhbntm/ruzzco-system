import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { applyGatewayStatus, ensureQrphCharge, gatewayConfig, paymongoClient, retrieveIntentStatus } from "@/lib/gateway";

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
const bodySchema = z.object({ transactionId: z.string().uuid() });

/** GET: 200 when QR Ph (test) is available, 404 when the gateway is off. The POS uses it to show the button. */
export async function GET() {
  if (!gatewayConfig()) return notFound();
  return NextResponse.json({ success: true, enabled: true, mode: "test" });
}

/**
 * POST { transactionId }: creates (or returns) the QR Ph charge for a synced QRPH sale.
 * Idempotent per sale: a second call, even a concurrent one, returns the existing intent and
 * never creates a second charge (ensureQrphCharge). This is also the "Retry QR payment" path
 * for a sale that synced without a charge. An expired or failed charge is not retried (out of
 * scope); the cashier rings a new sale.
 */
export async function POST(request: NextRequest) {
  const config = gatewayConfig();
  if (!config) return notFound();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "transactionId (UUID) is required" }, { status: 400 });
  const { transactionId } = parsed.data;

  try {
    const result = await ensureQrphCharge(transactionId, paymongoClient(config));
    if (result.kind === "not_synced") return NextResponse.json({ success: false, error: "NOT_SYNCED" }, { status: 404 });
    if (result.kind === "not_qrph") return NextResponse.json({ success: false, error: "NOT_QRPH" }, { status: 409 });
    if (result.kind === "existing") return NextResponse.json(await existingCharge(config, result.payment));
    return NextResponse.json({ success: true, status: "PENDING", intentId: result.intentId, qr: result.qr });
  } catch (error) {
    console.error("[POST /api/v1/payments/qrph]", error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: "Gateway error. Use cash, GCash or Maya." }, { status: 502 });
  }
}

async function existingCharge(
  config: NonNullable<ReturnType<typeof gatewayConfig>>,
  payment: { intentId: string; status: string }
) {
  if (payment.status !== "PENDING") return { success: true, status: payment.status, intentId: payment.intentId, qr: null };
  const live = await retrieveIntentStatus(config, payment.intentId);
  if (live.status !== "PENDING") {
    await applyGatewayStatus(payment.intentId, live.status, { paidAt: live.paidAt });
    const current = await prisma.gatewayPayment.findUniqueOrThrow({ where: { intentId: payment.intentId } });
    return { success: true, status: current.status, intentId: payment.intentId, qr: null };
  }
  return { success: true, status: "PENDING", intentId: payment.intentId, qr: live.qr };
}
