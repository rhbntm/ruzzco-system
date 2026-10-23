/**
 * Tests /shift-log pagination (src/lib/paginate.ts, slice 13): 20 sales a page, newest first,
 * read from the phone's own store exactly as the page reads it. No server or database: the
 * phone's IndexedDB is fake-indexeddb, so this is also the "shop PC off" case.
 *
 *   npm run test:shift-log-pages
 */
import "fake-indexeddb/auto";
import { db, type LocalTransaction } from "../src/lib/db";
import { SHIFT_LOG_PAGE_SIZE, paginate } from "../src/lib/paginate";

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

/** Sale n is made n minutes after a fixed start, so a higher n is newer. Invented amounts. */
function sale(n: number): LocalTransaction {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    barberId: "barber-1",
    barberName: "Test barber",
    serviceId: "svc",
    serviceName: "Test service",
    price: 100,
    totalAmount: 100,
    paymentMethod: "CASH",
    transactionTime: new Date(Date.UTC(2000, 0, 1, 2, n)).toISOString(),
    synced: 0,
  };
}

async function main() {
  console.log("Pages (pure)");
  const numbers = Array.from({ length: 45 }, (_, i) => i + 1);
  check("20 a page", SHIFT_LOG_PAGE_SIZE === 20);
  const sizes = [1, 2, 3].map((p) => paginate(numbers, p).items.length);
  check("45 items make 3 pages: 20, 20, 5", sizes.join(",") === "20,20,5" && paginate(numbers, 1).pageCount === 3, sizes.join(","));
  check("page 3 holds the last five", paginate(numbers, 3).items.join(",") === "41,42,43,44,45");
  check("a page past the end shows the last page", paginate(numbers, 9).page === 3);
  check("page 0 or a bad number shows page 1", paginate(numbers, 0).page === 1 && paginate(numbers, Number.NaN).page === 1);
  check("an empty list is one empty page", paginate([], 1).pageCount === 1 && paginate([], 1).items.length === 0);
  check("exactly 20 is one page", paginate(numbers.slice(0, 20), 1).pageCount === 1);
  check("21 is two pages", paginate(numbers.slice(0, 21), 2).items.join(",") === "21");

  console.log("\nFrom the phone's store, newest first (no server)");
  await db.transactions.clear();
  // Written out of order, as offline sales and retries can be.
  await db.transactions.bulkAdd([...numbers].sort((a, b) => (a * 7) % 45 - (b * 7) % 45).map(sale));
  const stored = await db.transactions.orderBy("transactionTime").reverse().toArray();
  const pages = [1, 2, 3].map((p) => paginate(stored, p));
  const minute = (tx: LocalTransaction) => new Date(tx.transactionTime).getUTCMinutes();
  check("three pages of 20, 20 and 5", pages.map((p) => p.items.length).join(",") === "20,20,5");
  check("page 1 starts with the newest sale", minute(pages[0].items[0]) === 45 && minute(pages[0].items[19]) === 26);
  check("page 3 ends with the oldest sale", minute(pages[2].items[4]) === 1);
  const all = pages.flatMap((p) => p.items.map(minute));
  check("every sale appears once, newest first", all.length === 45 && all.every((m, i) => m === 45 - i));
  await db.transactions.clear();
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
    process.exit(0);
  });
