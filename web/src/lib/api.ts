import { NextResponse } from "next/server";

// Shared route helpers: a request body that is not JSON is the client's mistake (400),
// and a server failure is logged in full but answered with a generic message, so
// database or driver details never reach a phone.
//
// JSON-only (slice 15): a write whose Content-Type is not application/json is refused (415).
// A cross-site page can send text/plain or a form without asking; application/json (and the
// device headers) force a CORS preflight, which this server never grants.

export type JsonBody = { ok: true; data: unknown } | { ok: false; response: NextResponse };

export function isJsonContentType(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  return type.split(";")[0].trim().toLowerCase() === "application/json";
}

export async function readJson(request: Request, error = "Request body must be JSON"): Promise<JsonBody> {
  if (!isJsonContentType(request)) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Content-Type must be application/json" }, { status: 415 }),
    };
  }
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
