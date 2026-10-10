// Reads the QR Ph gateway switch from the environment (slice 5). Pure, so it can be tested
// without a server. Three states, because "the owner switched it off" and "someone tried to
// switch it on but the keys are wrong" need different messages, even though QR Ph sales are
// refused in both:
//   off            PAYMENT_GATEWAY unset, empty or "off": intentionally disabled.
//   misconfigured  PAYMENT_GATEWAY is set to something else, or is "paymongo_test" without a
//                  test secret key (sk_test_...). Treated as disabled, with a server warning.
//   on             PAYMENT_GATEWAY=paymongo_test with a test secret key.

export type GatewayConfig = { secretKey: string; webhookSecret: string };

export type GatewayStatus =
  | { state: "off" }
  | { state: "misconfigured"; problem: string }
  | { state: "on"; config: GatewayConfig; warning?: string };

type GatewayEnv = { PAYMENT_GATEWAY?: string; PAYMONGO_SECRET_KEY?: string; PAYMONGO_WEBHOOK_SECRET?: string };

export function readGatewayStatus(env: GatewayEnv): GatewayStatus {
  const mode = (env.PAYMENT_GATEWAY ?? "").trim();
  if (mode === "" || mode === "off") return { state: "off" };
  if (mode !== "paymongo_test") {
    return { state: "misconfigured", problem: `PAYMENT_GATEWAY="${mode}" is not "off" or "paymongo_test".` };
  }
  const secretKey = env.PAYMONGO_SECRET_KEY ?? "";
  if (!secretKey.startsWith("sk_test_")) {
    return { state: "misconfigured", problem: "PAYMENT_GATEWAY=paymongo_test but PAYMONGO_SECRET_KEY is not a test key (sk_test_...)." };
  }
  const webhookSecret = env.PAYMONGO_WEBHOOK_SECRET ?? "";
  return {
    state: "on",
    config: { secretKey, webhookSecret },
    // Still usable: Check status on the POS confirms payments without webhooks.
    ...(webhookSecret ? {} : { warning: "PAYMONGO_WEBHOOK_SECRET is empty: webhooks are refused; only Check status confirms payments." }),
  };
}
