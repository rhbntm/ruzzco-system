import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { describeError, qrViewer } from "@/lib/payment-qr";
import { deviceNotApprovedResponse } from "@/lib/device-auth";

export const dynamic = "force-dynamic";

// Which QRs exist for active barbers, with a sha256 so phones download only what changed.
// No image bytes here. Slice 19 §7 (S4), superseding slice 6's public list: the owner gets every
// active barber's; an approved phone only its active assignment's barber's (`barberId`, null and an
// empty list without one), so the phone can drop every other cached QR; anyone else 401.
export async function GET(request: NextRequest) {
  try {
    const viewer = await qrViewer(request);
    if (!viewer) return deviceNotApprovedResponse();
    if (viewer.kind === "phone" && !viewer.barberId) return NextResponse.json({ success: true, scope: "phone", barberId: null, qrs: [] });
    const rows = await prisma.barberPaymentQr.findMany({
      where: {
        barber: { isActive: true },
        method: { in: ["GCASH", "MAYA"] },
        ...(viewer.kind === "phone" ? { barberId: viewer.barberId! } : {}),
      },
      select: { barberId: true, method: true, sha256: true, contentType: true, updatedAt: true },
      orderBy: [{ barberId: "asc" }, { method: "asc" }],
    });
    if (viewer.kind === "owner") return NextResponse.json({ success: true, scope: "owner", qrs: rows });
    return NextResponse.json({ success: true, scope: "phone", barberId: viewer.barberId, qrs: rows });
  } catch (error) {
    console.error("[payment-qrs] list failed:", describeError(error));
    return NextResponse.json({ success: false, error: "Could not load payment QRs" }, { status: 500 });
  }
}
