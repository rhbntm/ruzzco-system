import { NextRequest, NextResponse } from "next/server";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { manilaToday } from "@/lib/business-date";
import { ForecastServiceError, fetchForecast, saveForecast, serializeForecast } from "@/lib/forecast";

export const dynamic = "force-dynamic";

const FORECAST_DAYS = 7;

// Asks the ml-service for 7 days from today (Manila) and saves them as a new run.
// Service unreachable or a bad answer → 502 and nothing is saved.
export async function POST(request: NextRequest) {
  if (!hasOwnerAccess(request)) return ownerRequiredResponse();
  let forecast;
  try {
    forecast = await fetchForecast(manilaToday(), FORECAST_DAYS);
  } catch (error) {
    const message = error instanceof ForecastServiceError ? error.message : "unexpected error";
    console.error("[forecast] refresh failed:", message);
    return NextResponse.json({ success: false, error: "Forecast service is offline or sent an invalid forecast" }, { status: 502 });
  }
  try {
    const { run, days } = await saveForecast(forecast);
    return NextResponse.json({ success: true, ...serializeForecast(run, days) });
  } catch (error) {
    console.error("[forecast] save failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ success: false, error: "Could not save the forecast" }, { status: 500 });
  }
}
