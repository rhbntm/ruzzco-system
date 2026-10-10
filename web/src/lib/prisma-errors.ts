import { Prisma } from "@prisma/client";

// Prisma error codes the routes branch on. One place, so every route reads them the same way.

/** P2002: a unique constraint refused the row (usually a concurrent insert of the same id). */
export function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** P2034: a write conflict or deadlock rolled the transaction back; safe to retry. */
export function isWriteConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}
