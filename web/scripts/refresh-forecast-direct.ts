import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { fetchForecast, saveForecast } from "../src/lib/forecast";
import { manilaToday } from "../src/lib/business-date";
import { MAX_FORECAST_DAYS } from "../src/lib/forecast-chart";

async function main() {
  const today = manilaToday();
  console.log(`Fetching 30-day forecast for ${today} from ML service...`);
  const forecast = await fetchForecast(today, MAX_FORECAST_DAYS);
  console.log(`Forecast received! Model version: ${forecast.model_version}`);
  console.log("Saving run to database...");
  const { run, days } = await saveForecast(forecast);
  console.log(`✅ Success! Saved forecast run ${run.id} with ${days.length} days of predictions to database.`);
}

main().catch((err) => {
  console.error("❌ Failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
