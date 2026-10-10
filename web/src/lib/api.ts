import { NextResponse } from "next/server";

// Shared route helpers: a request body that is not JSON is the client's mistake (400),
// and a server failure is logged in full but answered with a generic message, so
// database or driver details never reach a phone.

export type JsonBody = { ok: true; data: unknown } | { ok: false; response: NextResponse };

export async function readJson(request: Request, error = "Request body must be JSON"): Promise<JsonBody> {
  try {
    return { ok: true, data: await request.json() };
  } catch {
    return { ok: false, response: NextResponse.json({ success: false, error }, { status: 400 }) };
  }
}

export function serverError(tag: string, error: unknown, message = "Internal server error", status = 500) {
  console.error(tag, error);
  return NextResponse.json({ success: false, error: message }, { status });
}
