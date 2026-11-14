import { NextRequest, NextResponse } from "next/server";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { readJson } from "@/lib/api";
import { manilaToday } from "@/lib/business-date";
import { ForecastServiceError, fetchForecast, saveForecast, serializeForecast } from "@/lib/forecast";
import { MAX_FORECAST_DAYS } from "@/lib/forecast-chart";

export const dynamic = "force-dynamic";

// Asks the ml-service for 30 days from today (Manila) and saves them as a new run. The home
// panel shows the first 7, 14 or 30 of them (slice 14); every other page reads 7.
// Service unreachable or a bad answer → 502 and nothing is saved.
//
// Slice 19 §7 (C1): the body must be `application/json` and exactly `{}` (the route takes no
// parameters), checked in this order before any database change or call to the ml-service:
// owner access (401), content type (415), body (400). A cross-origin page can't send JSON
// without a CORS preflight, which this server never grants.
export async function POST(request: NextRequest) {
  if (!(await hasOwnerAccess(request))) return ownerRequiredResponse();
  const body = await readJson(request, "Body must be the JSON object {}");
  if (!body.ok) return body.response;
  if (typeof body.data !== "object" || body.data === null || Array.isArray(body.data) || Object.keys(body.data).length > 0) {
    return NextResponse.json({ success: false, error: "Body must be the JSON object {}" }, { status: 400 });
  }
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
