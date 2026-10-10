import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [barbers, services] = await Promise.all([
      prisma.barber.findMany({
        where: { isActive: true },
        select: {
          id: true,
          fullName: true,
          commissionRate: true,
          isActive: true,
        },
        orderBy: { fullName: "asc" },
      }),
      prisma.service.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          standardPrice: true,
          isActive: true,
        },
        orderBy: { standardPrice: "desc" },
      }),
    ]);

    return NextResponse.json({
      success: true,
      barbers: barbers.map((b) => ({
        ...b,
        commissionRate: Number(b.commissionRate),
      })),
      services: services.map((s) => ({
        ...s,
        standardPrice: Number(s.standardPrice),
      })),
    });
  } catch (error) {
    return serverError("Catalog fetch error:", error, "Failed to fetch catalog");
  }
}
