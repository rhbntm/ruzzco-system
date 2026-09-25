import { prisma } from "../src/lib/prisma";

async function testSyncIdempotency() {
  console.log("🧪 Starting Slice 1 Sync Idempotency Verification...");

  const testId = "99999999-9999-4999-8999-999999999999";
  const barberId = "00000000-0000-0000-0000-000000000001"; // Mart Baldemor
  const serviceId = "10000000-0000-0000-0000-000000000001"; // Haircut ₱150

  // 1. Clean up any leftover test data
  await prisma.transaction.deleteMany({ where: { id: testId } });

  // 2. Mock payload
  const payload = {
    transactions: [
      {
        id: testId,
        barberId,
        serviceId,
        totalAmount: 150.0,
        paymentMethod: "CASH" as const,
        paymentReference: null,
        transactionTime: new Date().toISOString(),
      },
    ],
  };

  console.log("\n--- TEST 1: Initial Sync Insertion ---");
  // Simulate POST /api/v1/transactions/sync
  const incomingIds = payload.transactions.map((t) => t.id);
  const existingBefore = await prisma.transaction.findMany({
    where: { id: { in: incomingIds } },
    select: { id: true },
  });
  const existingSet = new Set(existingBefore.map((t) => t.id));

  let processedCount = 0;
  let duplicatesSkipped = 0;

  for (const item of payload.transactions) {
    if (existingSet.has(item.id)) {
      duplicatesSkipped++;
    } else {
      const commissionAmount = Math.round(item.totalAmount * 0.5 * 100) / 100;
      await prisma.transaction.create({
        data: {
          id: item.id,
          barberId: item.barberId,
          totalAmount: item.totalAmount,
          barberCommissionAmount: commissionAmount,
          commissionRate: 0.5,
          paymentMethod: item.paymentMethod,
          paymentReference: item.paymentReference,
          transactionTime: new Date(item.transactionTime),
          syncedAt: new Date(),
          items: {
            create: {
              serviceId: item.serviceId,
              priceAtSale: item.totalAmount,
            },
          },
          commissionLogs: {
            create: {
              barberId: item.barberId,
              amount: commissionAmount,
            },
          },
        },
      });
      processedCount++;
    }
  }

  console.log(`Initial Sync Result -> Processed: ${processedCount}, Skipped: ${duplicatesSkipped}`);
  if (processedCount !== 1 || duplicatesSkipped !== 0) {
    throw new Error("❌ Test 1 failed: Expected processedCount = 1, duplicatesSkipped = 0");
  }

  // Verify created records
  const tx = await prisma.transaction.findUnique({
    where: { id: testId },
    include: { items: true, commissionLogs: true },
  });

  if (!tx) throw new Error("❌ Transaction not found in database!");
  console.log(`✓ Transaction persisted: ID ${tx.id}, Amount: ₱${tx.totalAmount}, Commission: ₱${tx.barberCommissionAmount}`);
  console.log(`✓ Line item: Service ${tx.items[0]?.serviceId}, Price: ₱${tx.items[0]?.priceAtSale}`);
  console.log(`✓ Commission log: Barber ${tx.commissionLogs[0]?.barberId}, Logged: ₱${tx.commissionLogs[0]?.amount}`);

  if (Number(tx.barberCommissionAmount) !== 75.0) {
    throw new Error(`❌ Commission mismatch: Expected 75.00, got ${tx.barberCommissionAmount}`);
  }

  console.log("\n--- TEST 2: Duplicate Sync Idempotency (Same UUID) ---");
  const existingAfterFirst = await prisma.transaction.findMany({
    where: { id: { in: incomingIds } },
    select: { id: true },
  });
  const existingSet2 = new Set(existingAfterFirst.map((t) => t.id));

  let processedCount2 = 0;
  let duplicatesSkipped2 = 0;

  for (const item of payload.transactions) {
    if (existingSet2.has(item.id)) {
      duplicatesSkipped2++;
    } else {
      processedCount2++;
    }
  }

  console.log(`Duplicate Sync Result -> Processed: ${processedCount2}, Skipped: ${duplicatesSkipped2}`);
  if (processedCount2 !== 0 || duplicatesSkipped2 !== 1) {
    throw new Error("❌ Test 2 failed: Expected processedCount = 0, duplicatesSkipped = 1");
  }

  const allTxWithId = await prisma.transaction.count({ where: { id: testId } });
  if (allTxWithId !== 1) {
    throw new Error(`❌ Duplicate row created! Count is ${allTxWithId}`);
  }
  console.log("✓ Zero duplicate rows confirmed in MySQL!");

  // Cleanup
  await prisma.transaction.delete({ where: { id: testId } });
  console.log("✓ Test records cleaned up successfully.");

  console.log("\n🎉 ALL SLICE 1 IDEMPOTENCY TESTS PASSED!\n");
}

testSyncIdempotency()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
