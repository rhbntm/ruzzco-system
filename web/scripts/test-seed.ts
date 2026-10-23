/**
 * Tests the seed's price list (prisma/seed.ts, slice 13) against MySQL.
 *
 *   npm run test:seed            (MySQL running; no dev server needed)
 *
 * Runs `npx prisma db seed` twice, as an existing shop database would, and checks that the four
 * services have the price list's names and prices and that a sale stored before the new prices
 * keeps its own list price and commission. The seed changes the services of the database it runs
 * on, which is what it is for. The test's barber and sale use a fixed past date and are deleted
 * at the end. Invented amounts only.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { SERVICE_CATALOG } from "../src/lib/catalog";

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

const RUN = randomUUID().slice(0, 8);
const BARBER_ID = `test-seed-barber-${RUN}`;
const SALE_ID = randomUUID();
const HAIRCUT_ID = SERVICE_CATALOG[0].id;

// The seed's own output names the owner and barbers; keep it out of the test log.
const seed = () => execSync("npx prisma db seed", { cwd: process.cwd(), stdio: "pipe" });

async function main() {
  await prisma.$queryRaw`SELECT 1`;

  // A sale stored at the old ₱200 haircut price, as an existing database has them.
  await prisma.barber.create({ data: { id: BARBER_ID, fullName: `Seed test ${RUN}`, commissionRate: 0.5, isActive: false } });
  await prisma.transaction.create({
    data: {
      id: SALE_ID,
      barberId: BARBER_ID,
      totalAmount: 200,
      listPrice: 200,
      amountPaid: 200,
      barberCommissionAmount: 100,
      commissionRate: 0.5,
      transactionTime: new Date("2000-01-07T04:00:00.000Z"),
      items: { create: { serviceId: HAIRCUT_ID, priceAtSale: 200 } },
      commissionLogs: { create: { barberId: BARBER_ID, amount: 100 } },
    },
  });

  console.log("Seed run twice");
  seed();
  const countAfterFirst = await prisma.service.count();
  seed();
  const countAfterSecond = await prisma.service.count();
  check("the second run adds no services", countAfterFirst === countAfterSecond, `${countAfterFirst} then ${countAfterSecond}`);

  const services = await prisma.service.findMany({ where: { id: { in: SERVICE_CATALOG.map((s) => s.id) } } });
  check("all four price-list services exist", services.length === 4, `found ${services.length}`);
  for (const expected of SERVICE_CATALOG) {
    const found = services.find((s) => s.id === expected.id);
    check(
      `${expected.name} ₱${expected.standardPrice}, active`,
      !!found && found.name === expected.name && Number(found.standardPrice) === expected.standardPrice && found.isActive,
      found ? `${found.name} ₱${found.standardPrice} active=${found.isActive}` : "missing"
    );
  }

  console.log("\nPast sales keep their snapshot");
  const sale = await prisma.transaction.findUnique({ where: { id: SALE_ID }, include: { items: true, commissionLogs: true } });
  check("list price stays ₱200", Number(sale?.listPrice) === 200, String(sale?.listPrice));
  check("amount paid stays ₱200", Number(sale?.amountPaid) === 200);
  check("commission stays ₱100", Number(sale?.barberCommissionAmount) === 100 && Number(sale?.commissionLogs[0]?.amount) === 100);
  check("the item keeps ₱200 and still points at the haircut", Number(sale?.items[0]?.priceAtSale) === 200 && sale?.items[0]?.serviceId === HAIRCUT_ID);
}

main()
  .catch((error) => {
    failures.push(`crashed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error instanceof Error ? error.message : error);
  })
  .finally(async () => {
    // Items and commission logs go with the sale (onDelete: Cascade).
    await prisma.transaction.deleteMany({ where: { id: SALE_ID } }).catch(() => undefined);
    await prisma.barber.deleteMany({ where: { id: BARBER_ID } }).catch(() => undefined);
    await prisma.$disconnect();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  FAIL ${f}`);
      process.exit(1);
    }
  });
