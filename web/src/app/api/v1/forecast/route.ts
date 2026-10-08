import { NextRequest, NextResponse } from "next/server";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { latestForecast, serializeForecast } from "@/lib/forecast";

export const dynamic = "force-dynamic";

// The latest saved forecast run and its days from today (Manila) for 7 days.
// Database only: never calls the ml-service, so it works while the service is down.
export async function GET(request: NextRequest) {
  if (!hasOwnerAccess(request)) return ownerRequiredResponse();
  try {
    const { run, days } = await latestForecast();
    return NextResponse.json({ success: true, ...serializeForecast(run, days) });
  } catch (error) {
    console.error("[forecast] load failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ success: false, error: "Could not load the saved forecast" }, { status: 500 });
  }
}
