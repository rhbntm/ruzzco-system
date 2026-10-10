/**
 * Tests the QR Ph availability rules with no server or database:
 * - readGatewayStatus: off vs misconfigured vs on (src/lib/gateway-config.ts)
 * - checkQrphAvailable: the POS recheck before a QRPH sale, against a stubbed server
 * - the GATEWAY_DISABLED label and hint the phone shows
 *
 *   npm run test:qrph-policy
 */
import "fake-indexeddb/auto";
import { readGatewayStatus } from "../src/lib/gateway-config";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const TEST_KEY = "sk_test_fake";

async function main() {
  console.log("Gateway state from the environment");
  check("unset is off", readGatewayStatus({}).state === "off");
  check("empty is off", readGatewayStatus({ PAYMENT_GATEWAY: "" }).state === "off");
  check('"off" is off', readGatewayStatus({ PAYMENT_GATEWAY: "off", PAYMONGO_SECRET_KEY: TEST_KEY }).state === "off");
  const typo = readGatewayStatus({ PAYMENT_GATEWAY: "paymongo-test", PAYMONGO_SECRET_KEY: TEST_KEY });
  check("a typo in the mode is misconfigured, not off", typo.state === "misconfigured");
  const live = readGatewayStatus({ PAYMENT_GATEWAY: "paymongo_test", PAYMONGO_SECRET_KEY: "sk_live_fake" });
  check("a live key is misconfigured", live.state === "misconfigured");
  check("a missing key is misconfigured", readGatewayStatus({ PAYMENT_GATEWAY: "paymongo_test" }).state === "misconfigured");
  const on = readGatewayStatus({ PAYMENT_GATEWAY: "paymongo_test", PAYMONGO_SECRET_KEY: TEST_KEY, PAYMONGO_WEBHOOK_SECRET: "whsk_fake" });
  check("test key and mode is on", on.state === "on" && !("warning" in on && on.warning));
  const noWebhook = readGatewayStatus({ PAYMENT_GATEWAY: "paymongo_test", PAYMONGO_SECRET_KEY: TEST_KEY });
  check("on without a webhook secret warns but stays on", noWebhook.state === "on" && Boolean(noWebhook.warning));
  check("problems never include key values", typo.state === "misconfigured" && !typo.problem.includes(TEST_KEY) && live.state === "misconfigured" && !live.problem.includes("sk_live_fake"));

  console.log("\nPOS recheck before a QRPH sale (stale button)");
  const { checkQrphAvailable } = await import("../src/lib/qrph-client");
  const realFetch = globalThis.fetch;
  const answer = (respond: () => Promise<Response>) => {
    globalThis.fetch = (async () => respond()) as typeof fetch;
  };
  answer(async () => Response.json({ success: true, enabled: true }));
  check("200 means QR Ph can be used", await checkQrphAvailable());
  answer(async () => Response.json({ success: false, error: "Not found" }, { status: 404 }));
  check("404 (switched off since the page loaded) means no", !(await checkQrphAvailable()));
  answer(async () => {
    throw new TypeError("fetch failed");
  });
  check("an unreachable server means no", !(await checkQrphAvailable()));
  answer(async () => new Response("oops", { status: 500 }));
  check("a server error means no", !(await checkQrphAvailable()));
  globalThis.fetch = realFetch;

  console.log("\nWhat the phone shows");
  const { rejectHint, rejectLabel } = await import("../src/lib/sync");
  check("GATEWAY_DISABLED has a readable label", rejectLabel("GATEWAY_DISABLED") === "QR Ph is switched off on the server");
  check("GATEWAY_DISABLED explains how to recover", /Retry when QR Ph is back on/.test(rejectHint("GATEWAY_DISABLED") ?? ""));
  check("DEVICE_MISMATCH keeps its review hint", /Needs review/.test(rejectHint("DEVICE_MISMATCH") ?? ""));
  check("other reasons have no hint", rejectHint("INVALID") === null);
}

main()
  .catch((error) => {
    failures.push(`crashed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  FAIL ${f}`);
      process.exit(1);
    }
  });
