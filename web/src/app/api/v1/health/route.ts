import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Ping the database through Prisma. Public route: it says only whether the app is healthy.
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "healthy" });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json({ status: "unhealthy" }, { status: 503 });
  }
}
