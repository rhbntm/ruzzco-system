import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { applyGatewayStatus, createQrphCharge, gatewayConfig, retrieveIntentStatus } from "@/lib/gateway";

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
 * Idempotent per sale: a second call returns the existing intent, never a new one. An
 * expired or failed charge is not retried (out of scope); the cashier rings a new sale.
 */
export async function POST(request: NextRequest) {
  const config = gatewayConfig();
  if (!config) return notFound();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "transactionId (UUID) is required" }, { status: 400 });
  const { transactionId } = parsed.data;

  try {
    const sale = await prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { paymentMethod: true, totalAmount: true, gatewayPayment: true },
    });
    if (!sale) return NextResponse.json({ success: false, error: "NOT_SYNCED" }, { status: 404 });
    if (sale.paymentMethod !== "QRPH") return NextResponse.json({ success: false, error: "NOT_QRPH" }, { status: 409 });

    if (sale.gatewayPayment) return NextResponse.json(await existingCharge(config, sale.gatewayPayment));

    // Amount = the sale's totalAmount (amount paid, tip excluded).
    const charge = await createQrphCharge(config, sale.totalAmount, transactionId);
    try {
      await prisma.gatewayPayment.create({
        data: { transactionId, intentId: charge.intentId, amount: sale.totalAmount, provider: "PAYMONGO_TEST" },
      });
    } catch (error) {
      // A concurrent call stored its intent first; that one is the sale's charge.
      if (!isUniqueViolation(error)) throw error;
      const winner = await prisma.gatewayPayment.findUniqueOrThrow({ where: { transactionId } });
      return NextResponse.json(await existingCharge(config, winner));
    }
    return NextResponse.json({ success: true, status: "PENDING", intentId: charge.intentId, qr: charge.qr });
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
