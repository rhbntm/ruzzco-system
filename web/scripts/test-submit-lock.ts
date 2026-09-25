/**
 * Tests the checkout lock used by /pos (src/lib/submit-lock.ts). No server needed.
 *
 *   npm run test:submit-lock
 */
import { randomUUID } from "node:crypto";
import { createSubmitLock } from "../src/lib/submit-lock";

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Mirrors /pos: each accepted action generates a transaction id and "writes" it. */
function fakeSaleWriter(writeMs: number, fail = false) {
  const written: string[] = [];
  const write = async () => {
    const id = randomUUID();
    await sleep(writeMs);
    if (fail) throw new Error("IndexedDB write failed");
    written.push(id);
    return true;
  };
  return { written, write };
}

async function main() {
  console.log("Checkout lock");

  console.log("\nSame-tick taps (before any re-render could disable the button)");
  {
    const lock = createSubmitLock({ holdAfterSuccessMs: 50 });
    const sale = fakeSaleWriter(20);
    const taps = [lock.run(sale.write), lock.run(sale.write), lock.run(sale.write)];
    check("lock is taken synchronously by the first call", lock.busy);
    const results = await Promise.all(taps);
    check("first tap saved", results[0].status === "done");
    check("second and third taps return busy", results[1].status === "busy" && results[2].status === "busy");
    check("exactly one transaction id written", sale.written.length === 1, `got ${sale.written.length}`);
  }

  console.log("\nTap while the first write is still in progress");
  {
    const lock = createSubmitLock({ holdAfterSuccessMs: 50 });
    const sale = fakeSaleWriter(40);
    const first = lock.run(sale.write);
    await sleep(10);
    const second = await lock.run(sale.write);
    await first;
    check("mid-write tap returns busy", second.status === "busy");
    check("exactly one transaction id written", sale.written.length === 1, `got ${sale.written.length}`);
  }

  console.log("\nDouble tap landing after a fast write (repeat guard)");
  {
    const lock = createSubmitLock({ holdAfterSuccessMs: 100 });
    const sale = fakeSaleWriter(1);
    await lock.run(sale.write);
    await sleep(30);
    const late = await lock.run(sale.write);
    check("tap 30 ms after save is ignored", late.status === "busy");
    check("still one transaction id", sale.written.length === 1, `got ${sale.written.length}`);
    await sleep(100);
    const next = await lock.run(sale.write);
    check("after the guard, the next deliberate sale is allowed", next.status === "done" && sale.written.length === 2);
  }

  console.log("\nFailure releases the lock immediately");
  {
    const lock = createSubmitLock({ holdAfterSuccessMs: 1000 });
    const failing = fakeSaleWriter(5, true);
    const result = await lock.run(failing.write);
    check("failed write reports failed", result.status === "failed");
    check("lock released at once (no repeat guard after failure)", !lock.busy);
    check("nothing written", failing.written.length === 0);
    const ok = fakeSaleWriter(1);
    const retry = await lock.run(ok.write);
    check("retry right after failure saves", retry.status === "done" && ok.written.length === 1);
  }

  console.log("\nSynchronous throw inside the action also releases");
  {
    const lock = createSubmitLock({ holdAfterSuccessMs: 1000 });
    const result = await lock.run(() => {
      throw new Error("sync throw");
    });
    check("reports failed and releases", result.status === "failed" && !lock.busy);
  }

  console.log("\nonChange drives the disabled UI state");
  {
    const events: boolean[] = [];
    const lock = createSubmitLock({ holdAfterSuccessMs: 20, onChange: (busy) => events.push(busy) });
    await lock.run(async () => true);
    check("busy=true fired on start", events[0] === true && events.length === 1);
    await sleep(40);
    check("busy=false fired after the guard", events.join(",") === "true,false");
  }

  console.log("\nAll payment methods share one lock (as in /pos)");
  {
    const lock = createSubmitLock({ holdAfterSuccessMs: 50 });
    const sale = fakeSaleWriter(10);
    const results = await Promise.all([lock.run(sale.write), lock.run(sale.write), lock.run(sale.write)]); // CASH, GCASH, MAYA
    check("only one of CASH/GCASH/MAYA records", results.filter((r) => r.status === "done").length === 1 && sale.written.length === 1);
  }
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
