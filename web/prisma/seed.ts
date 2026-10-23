import { PrismaClient, Role } from "@prisma/client";
import { SERVICE_CATALOG } from "../src/lib/catalog";

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

  // 3. Seed Core Services: the shop's price list (src/lib/catalog.ts, slice 13).
  // `update` sets the name and the price, so re-seeding an existing DB picks up both. Past
  // sales keep the prices and commissions they were stored with.
  const services = [];
  for (const service of SERVICE_CATALOG) {
    services.push(
      await prisma.service.upsert({
        where: { id: service.id },
        update: { name: service.name, standardPrice: service.standardPrice, isActive: true },
        create: { id: service.id, name: service.name, standardPrice: service.standardPrice, isActive: true },
      })
    );
  }

  console.log("✅ Seed completed successfully!");
  console.log(`- Owner: ${owner.name} (${owner.email})`);
  console.log(`- Barbers: ${bayaniBarber.fullName}, ${vince.fullName} (${mart.fullName}: ${mart.isActive ? "active" : "inactive"})`);
  console.log(`- Services: ${services.map((s) => `${s.name} (₱${s.standardPrice})`).join(", ")}`);
}

main()
  .catch((e) => {
    console.error("❌ Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
