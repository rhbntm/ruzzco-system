import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting Ruzzco Barbers database seed...");

  // 1. Seed Owner User
  const owner = await prisma.user.upsert({
    where: { email: "bayani@ruzzcobarbers.com" },
    update: {},
    create: {
      name: "Bayani Delo Santos",
      email: "bayani@ruzzcobarbers.com",
      role: Role.OWNER,
    },
  });

  // 2. Seed Core Barbers
  const mart = await prisma.barber.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      fullName: "Mart Baldemor",
      commissionRate: 0.50,
      isActive: true,
    },
  });

  const bayaniBarber = await prisma.barber.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      fullName: "Bayani Delo Santos",
      commissionRate: 0.50,
      isActive: true,
    },
  });

  // 3. Seed Core Services
  const haircut = await prisma.service.upsert({
    where: { id: "10000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "10000000-0000-0000-0000-000000000001",
      name: "Haircut",
      standardPrice: 150.00,
      isActive: true,
    },
  });

  const beardTrim = await prisma.service.upsert({
    where: { id: "10000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "10000000-0000-0000-0000-000000000002",
      name: "Beard Trim / Shave",
      standardPrice: 100.00,
      isActive: true,
    },
  });

  console.log("✅ Seed completed successfully!");
  console.log(`- Owner: ${owner.name} (${owner.email})`);
  console.log(`- Barbers: ${mart.fullName}, ${bayaniBarber.fullName}`);
  console.log(`- Services: ${haircut.name} (₱${haircut.standardPrice}), ${beardTrim.name} (₱${beardTrim.standardPrice})`);
}

main()
  .catch((e) => {
    console.error("❌ Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
