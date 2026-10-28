import { NextRequest, NextResponse } from "next/server";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { manilaToday } from "@/lib/business-date";
import { ForecastServiceError, fetchForecast, saveForecast, serializeForecast } from "@/lib/forecast";
import { MAX_FORECAST_DAYS } from "@/lib/forecast-chart";

export const dynamic = "force-dynamic";

// Asks the ml-service for 30 days from today (Manila) and saves them as a new run. The home
// panel shows the first 7, 14 or 30 of them (slice 14); every other page reads 7.
// Service unreachable or a bad answer → 502 and nothing is saved.
export async function POST(request: NextRequest) {
  if (!hasOwnerAccess(request)) return ownerRequiredResponse();
  let forecast;
  try {
    forecast = await fetchForecast(manilaToday(), MAX_FORECAST_DAYS);
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
