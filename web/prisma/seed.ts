import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting Ruzzco Barbers database seed...");

  // 1. Seed Owner User (Mart owns the shop; 2026-09-25 interview)
  const owner = await prisma.user.upsert({
    where: { email: "mart@ruzzcobarbers.com" },
    update: {},
    create: {
      name: "Mart Baldemor",
      email: "mart@ruzzcobarbers.com",
      role: Role.OWNER,
    },
  });

  // 2. Seed Core Barbers
  // Mart owns the shop but doesn't cut hair (Mart and Bayani, Oct 2026), so a new database
  // creates his barber record inactive. `update` stays empty: re-seeding never changes an
  // existing database, where his record may already have sales.
  const mart = await prisma.barber.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      fullName: "Mart Baldemor",
      commissionRate: 0.50,
      isActive: false,
    },
  });

  const bayaniBarber = await prisma.barber.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      fullName: "Bayani Delos Santos",
      commissionRate: 0.50,
      isActive: true,
    },
  });

  const vince = await prisma.barber.upsert({
    where: { id: "00000000-0000-0000-0000-000000000003" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000003",
      fullName: "Vince",
      commissionRate: 0.50,
      isActive: true,
    },
  });

  // 3. Seed Core Services (prices from the logbook and 2026-09-25 interview).
  // `update` sets the price too, so re-seeding an existing DB picks it up.
  const haircut = await prisma.service.upsert({
    where: { id: "10000000-0000-0000-0000-000000000001" },
    update: { standardPrice: 200.00 },
    create: {
      id: "10000000-0000-0000-0000-000000000001",
      name: "Haircut",
      standardPrice: 200.00,
      isActive: true,
    },
  });

  const shaveMassage = await prisma.service.upsert({
    where: { id: "10000000-0000-0000-0000-000000000002" },
    update: { name: "Shave & Massage", standardPrice: 150.00 },
    create: {
      id: "10000000-0000-0000-0000-000000000002",
      name: "Shave & Massage",
      standardPrice: 150.00,
      isActive: true,
    },
  });

  console.log("✅ Seed completed successfully!");
  console.log(`- Owner: ${owner.name} (${owner.email})`);
  console.log(`- Barbers: ${bayaniBarber.fullName}, ${vince.fullName} (${mart.fullName}: ${mart.isActive ? "active" : "inactive"})`);
  console.log(`- Services: ${haircut.name} (₱${haircut.standardPrice}), ${shaveMassage.name} (₱${shaveMassage.standardPrice})`);
}

main()
  .catch((e) => {
    console.error("❌ Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
