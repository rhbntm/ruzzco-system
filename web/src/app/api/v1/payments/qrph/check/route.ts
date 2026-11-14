import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { readJson, serverError } from "@/lib/api";
import { authenticateDevice, deviceNotApprovedResponse } from "@/lib/device-auth";
import { applyGatewayStatus, gatewayConfig, retrieveIntentStatus } from "@/lib/gateway";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ transactionId: z.string().uuid() });
const noCharge = () => NextResponse.json({ success: false, error: "NO_CHARGE" }, { status: 404 });

// Slice 19 §7 (S1): only the approved phone that made the sale, checked before the gateway switch.
// A sale with no assignment, or another phone's, answers like a sale with no charge.
const ownSaleCharge = (transactionId: string, deviceKey: string) =>
  prisma.gatewayPayment.findFirst({
    where: { transactionId, transaction: { assignment: { deviceKey } } },
  });

/** GET ?transactionId=: the stored status only (no PayMongo call). The POS polls this while the QR is shown. */
export async function GET(request: NextRequest) {
  const deviceKey = await authenticateDevice(request);
  if (!deviceKey) return deviceNotApprovedResponse();
  if (!gatewayConfig()) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  const parsed = bodySchema.safeParse({ transactionId: request.nextUrl.searchParams.get("transactionId") });
  if (!parsed.success) return NextResponse.json({ success: false, error: "transactionId (UUID) is required" }, { status: 400 });
  try {
    const payment = await ownSaleCharge(parsed.data.transactionId, deviceKey);
    if (!payment) return noCharge();
    return NextResponse.json({ success: true, status: payment.status, paidAt: payment.paidAt });
  } catch (error) {
    return serverError("[GET /api/v1/payments/qrph/check]", error, "Could not read the payment status");
  }
}

/**
 * POST { transactionId }: Check status. Retrieves the intent from PayMongo and applies the
 * same update as the webhook (fallback when the tunnel is down). The client only reads the
 * result; it never decides payment status.
 */
export async function POST(request: NextRequest) {
  const deviceKey = await authenticateDevice(request);
  if (!deviceKey) return deviceNotApprovedResponse();
  const config = gatewayConfig();
  if (!config) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  const body = await readJson(request, "transactionId (UUID) is required");
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ success: false, error: "transactionId (UUID) is required" }, { status: 400 });

  try {
    const payment = await ownSaleCharge(parsed.data.transactionId, deviceKey);
    if (!payment) return noCharge();
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
