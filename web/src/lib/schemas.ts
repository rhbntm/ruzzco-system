import { z } from "zod";

export const deviceBindSchema = z.object({
  deviceKey: z.string().uuid("Invalid device key UUID"),
  barberId: z.string().min(1, "Barber ID is required"),
});

export const syncTransactionItemSchema = z.object({
  id: z.string().uuid("Invalid transaction UUID"),
  barberId: z.string().min(1, "Barber ID is required"),
  serviceId: z.string().min(1, "Service ID is required"),
  totalAmount: z.number().positive("Total amount must be greater than zero"),
  paymentMethod: z.enum(["CASH", "GCASH"]).default("CASH"),
  paymentReference: z.string().nullable().optional(),
  transactionTime: z.string().datetime({ message: "Invalid ISO datetime string" }),
  deviceKey: z.string().uuid().optional(),
});

export const syncBatchSchema = z.object({
  transactions: z.array(syncTransactionItemSchema).min(1, "At least one transaction required for sync"),
});

export type DeviceBindPayload = z.infer<typeof deviceBindSchema>;
export type SyncTransactionItem = z.infer<typeof syncTransactionItemSchema>;
export type SyncBatchPayload = z.infer<typeof syncBatchSchema>;
