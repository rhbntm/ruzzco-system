import { PrismaClient, DiscountType, PaymentMethod } from "@prisma/client";
import { commissionFor } from "../src/lib/commission";

// Demo transactions for today (Asia/Manila). Every row id starts with "demo-".
//   npm run seed:demo            -> replace demo rows with today's samples
//   npm run seed:demo -- --clean -> delete demo rows only
// Uses the barbers and services from `npx prisma db seed`; it creates none.

const prisma = new PrismaClient();

const DEMO_PREFIX = "demo-";
const MART_ID = "00000000-0000-0000-0000-000000000001";
const BAYANI_ID = "00000000-0000-0000-0000-000000000002";
const HAIRCUT_ID = "10000000-0000-0000-0000-000000000001";
const BEARD_ID = "10000000-0000-0000-0000-000000000002";

type DemoTx = {
  id: string;
  barberId: string;
  serviceId: string;
  time: string; // HH:MM, Asia/Manila
  listPrice: number;
  discountType?: DiscountType;
  discountAmount?: number;
  amountPaid: number;
  tipAmount?: number;
  customAmount?: boolean;
  customAmountNote?: string;
  paymentMethod: PaymentMethod;
  paymentReference?: string;
};

const DEMO_TRANSACTIONS: DemoTx[] = [
  {
    id: "demo-senior-pwd",
    barberId: MART_ID,
    serviceId: HAIRCUT_ID,
    time: "09:30",
    listPrice: 150,
    discountType: "PERCENT",
    discountAmount: 30,
    amountPaid: 120,
    paymentMethod: "CASH",
  },
  {
    id: "demo-tip",
    barberId: BAYANI_ID,
    serviceId: HAIRCUT_ID,
    time: "10:15",
    listPrice: 150,
    amountPaid: 150,
    tipAmount: 50,
    paymentMethod: "CASH",
  },
  {
    id: "demo-maya",
    barberId: MART_ID,
    serviceId: HAIRCUT_ID,
    time: "11:00",
    listPrice: 150,
    amountPaid: 150,
    paymentMethod: "MAYA",
    paymentReference: "DEMO-MAYA-0001",
  },
  {
    id: "demo-custom",
    barberId: BAYANI_ID,
    serviceId: HAIRCUT_ID,
    time: "13:20",
    listPrice: 300, // custom amount: list price equals the entered amount
    amountPaid: 300,
    customAmount: true,
    customAmountNote: "Demo custom amount",
    paymentMethod: "CASH",
  },
  {
    id: "demo-gcash",
    barberId: MART_ID,
    serviceId: BEARD_ID,
    time: "14:45",
    listPrice: 100,
    amountPaid: 100,
    paymentMethod: "GCASH",
    paymentReference: "DEMO-GCASH-0001",
  },
];

function manilaToday(): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

async function clean(): Promise<number> {
  // Items and commission logs go with the transaction (onDelete: Cascade).
  const { count } = await prisma.transaction.deleteMany({
    where: { id: { startsWith: DEMO_PREFIX } },
  });
  return count;
}

async function seed() {
  const barbers = await prisma.barber.findMany({
    where: { id: { in: [MART_ID, BAYANI_ID] } },
    select: { id: true, commissionRate: true },
  });
  const rateByBarber = new Map(barbers.map((b) => [b.id, b.commissionRate]));
  const services = await prisma.service.count({ where: { id: { in: [HAIRCUT_ID, BEARD_ID] } } });
  if (rateByBarber.size !== 2 || services !== 2) {
    throw new Error("Seeded barbers or services are missing. Run `npx prisma db seed` first.");
  }

  const today = manilaToday();
  const removed = await clean();

  for (const tx of DEMO_TRANSACTIONS) {
    const rate = rateByBarber.get(tx.barberId)!;
    // Rate and commission are snapshotted on LIST_PRICE, same as the sync route.
    const commission = commissionFor(tx.listPrice, rate);

    await prisma.transaction.create({
      data: {
        id: tx.id,
        barberId: tx.barberId,
        totalAmount: tx.amountPaid,
        listPrice: tx.listPrice,
        discountType: tx.discountType ?? "NONE",
        discountAmount: tx.discountAmount ?? 0,
        amountPaid: tx.amountPaid,
        tipAmount: tx.tipAmount ?? 0,
        customAmount: tx.customAmount ?? false,
        customAmountNote: tx.customAmountNote ?? null,
        barberCommissionAmount: commission,
        commissionRate: rate,
        commissionBase: "LIST_PRICE",
        paymentMethod: tx.paymentMethod,
        paymentReference: tx.paymentReference ?? null,
        transactionTime: new Date(`${today}T${tx.time}:00+08:00`),
        items: { create: { serviceId: tx.serviceId, priceAtSale: tx.amountPaid } },
        commissionLogs: { create: { barberId: tx.barberId, amount: commission } },
      },
    });
  }

  console.log(`Demo seed: removed ${removed} old demo row(s), inserted ${DEMO_TRANSACTIONS.length} for ${today}.`);
}

async function main() {
  if (process.argv.includes("--clean")) {
    const removed = await clean();
    console.log(`Demo clean: deleted ${removed} demo transaction(s).`);
    return;
  }
  await seed();
}

main()
  .catch((e) => {
    console.error("Demo seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
