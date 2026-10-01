import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { applyGatewayStatus, gatewayConfig, retrieveIntentStatus } from "@/lib/gateway";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ transactionId: z.string().uuid() });

/** GET ?transactionId=: the stored status only (no PayMongo call). The POS polls this while the QR is shown. */
export async function GET(request: NextRequest) {
  if (!gatewayConfig()) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  const parsed = bodySchema.safeParse({ transactionId: request.nextUrl.searchParams.get("transactionId") });
  if (!parsed.success) return NextResponse.json({ success: false, error: "transactionId (UUID) is required" }, { status: 400 });
  const payment = await prisma.gatewayPayment.findUnique({
    where: { transactionId: parsed.data.transactionId },
    select: { status: true, paidAt: true },
  });
  if (!payment) return NextResponse.json({ success: false, error: "NO_CHARGE" }, { status: 404 });
  return NextResponse.json({ success: true, status: payment.status, paidAt: payment.paidAt });
}

/**
 * POST { transactionId }: Check status. Retrieves the intent from PayMongo and applies the
 * same update as the webhook (fallback when the tunnel is down). The client only reads the
 * result; it never decides payment status.
 */
export async function POST(request: NextRequest) {
  const config = gatewayConfig();
  if (!config) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "transactionId (UUID) is required" }, { status: 400 });

  try {
    const payment = await prisma.gatewayPayment.findUnique({ where: { transactionId: parsed.data.transactionId } });
    if (!payment) return NextResponse.json({ success: false, error: "NO_CHARGE" }, { status: 404 });
    if (payment.status === "PENDING") {
      const live = await retrieveIntentStatus(config, payment.intentId);
      if (live.status !== "PENDING") await applyGatewayStatus(payment.intentId, live.status, { paidAt: live.paidAt });
    }
    const current = await prisma.gatewayPayment.findUniqueOrThrow({ where: { id: payment.id } });
    return NextResponse.json({ success: true, status: current.status, paidAt: current.paidAt });
  } catch (error) {
    console.error("[POST /api/v1/payments/qrph/check]", error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: "Could not reach the gateway" }, { status: 502 });
  }
}
