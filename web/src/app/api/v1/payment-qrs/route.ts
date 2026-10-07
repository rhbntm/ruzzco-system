import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { describeError } from "@/lib/payment-qr";

export const dynamic = "force-dynamic";

// Which QRs exist for active barbers, with a sha256 so phones download only what changed.
// No image bytes here. Public like the catalog: POS phones have no login.
export async function GET() {
  try {
    const rows = await prisma.barberPaymentQr.findMany({
      where: { barber: { isActive: true }, method: { in: ["GCASH", "MAYA"] } },
      select: { barberId: true, method: true, sha256: true, contentType: true, updatedAt: true },
      orderBy: [{ barberId: "asc" }, { method: "asc" }],
    });
    return NextResponse.json({ success: true, qrs: rows });
  } catch (error) {
    console.error("[payment-qrs] list failed:", describeError(error));
    return NextResponse.json({ success: false, error: "Could not load payment QRs" }, { status: 500 });
  }
}
