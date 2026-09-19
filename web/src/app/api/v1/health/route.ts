import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Ping MySQL through Prisma
    await prisma.$queryRaw`SELECT 1`;

    const barberCount = await prisma.barber.count();
    const serviceCount = await prisma.service.count();

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {
        api: "online",
        database: "connected",
        databaseType: "MySQL 8.0 (Docker)",
      },
      counts: {
        barbers: barberCount,
        services: serviceCount,
      },
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        services: {
          api: "online",
          database: "disconnected",
        },
        error: error instanceof Error ? error.message : "Unknown database error",
      },
      { status: 503 }
    );
  }
}
