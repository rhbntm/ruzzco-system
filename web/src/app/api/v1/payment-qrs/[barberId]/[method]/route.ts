import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { MAX_QR_BYTES, describeError, detectImageType, parseQrMethod, sha256Hex } from "@/lib/payment-qr";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ barberId: string; method: string }> };

const fail = (status: number, error: string) => NextResponse.json({ success: false, error }, { status });

// Reads the body but stops as soon as it exceeds the limit, so an oversized upload is never
// buffered whole. Returns null when it is too large.
async function readLimited(request: NextRequest, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function activeBarberExists(barberId: string) {
  return (await prisma.barber.count({ where: { id: barberId, isActive: true } })) > 0;
}

// The image itself, for the POS cache. Public like the catalog (POS phones have no login):
// the same exposure as a printed QR on the counter. Inactive barbers' QRs are not served.
export async function GET(_request: NextRequest, { params }: Context) {
  const { barberId, method: rawMethod } = await params;
  const method = parseQrMethod(rawMethod);
  if (!method) return fail(400, "Method must be GCASH or MAYA");
  try {
    const row = await prisma.barberPaymentQr.findFirst({
      where: { barberId, method, barber: { isActive: true } },
      select: { image: true, contentType: true, sha256: true },
    });
    if (!row) return fail(404, "No QR for this barber and method");
    return new NextResponse(Buffer.from(row.image), {
      headers: {
        "Content-Type": row.contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ETag: `"${row.sha256}"`,
      },
    });
  } catch (error) {
    console.error("[payment-qrs] read failed:", describeError(error));
    return fail(500, "Could not load the QR");
  }
}

// Owner only: upload or replace a barber's QR. The body is the raw image file.
export async function PUT(request: NextRequest, { params }: Context) {
  if (!hasOwnerAccess(request)) return ownerRequiredResponse();
  const { barberId, method: rawMethod } = await params;
  const method = parseQrMethod(rawMethod);
  if (!method) return fail(400, "Method must be GCASH or MAYA");
  try {
    if (!(await activeBarberExists(barberId))) return fail(404, "Unknown or inactive barber");

    const bytes = await readLimited(request, MAX_QR_BYTES);
    if (!bytes) return fail(413, "Image is larger than 1 MB");
    if (bytes.byteLength === 0) return fail(400, "No image in the request");
    const contentType = detectImageType(bytes);
    if (!contentType) return fail(415, "Upload a PNG, JPEG or WebP image");

    const sha256 = sha256Hex(bytes);
    const image = Buffer.from(bytes);
    const saved = await prisma.barberPaymentQr.upsert({
      where: { barberId_method: { barberId, method } },
      create: { barberId, method, contentType, image, sha256 },
      update: { contentType, image, sha256 },
      select: { barberId: true, method: true, sha256: true, contentType: true, updatedAt: true },
    });
    return NextResponse.json({ success: true, qr: saved });
  } catch (error) {
    console.error("[payment-qrs] save failed:", describeError(error));
    return fail(500, "Could not save the QR");
  }
}

// Owner only: remove a barber's QR. Removing one that does not exist is not an error.
export async function DELETE(request: NextRequest, { params }: Context) {
  if (!hasOwnerAccess(request)) return ownerRequiredResponse();
  const { barberId, method: rawMethod } = await params;
  const method = parseQrMethod(rawMethod);
  if (!method) return fail(400, "Method must be GCASH or MAYA");
  try {
    const { count } = await prisma.barberPaymentQr.deleteMany({ where: { barberId, method } });
    return NextResponse.json({ success: true, removed: count > 0 });
  } catch (error) {
    console.error("[payment-qrs] delete failed:", describeError(error));
    return fail(500, "Could not remove the QR");
  }
}
