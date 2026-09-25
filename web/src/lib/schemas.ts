import { z } from "zod";

export const deviceBindSchema = z.object({
  deviceKey: z.string().uuid("Invalid device key UUID"),
  barberId: z.string().min(1, "Barber ID is required"),
  // Generated on the phone at bind time. Optional so older clients still bind.
  assignmentId: z.string().uuid("Invalid assignment UUID").optional(),
});

export const syncTransactionItemSchema = z.object({
  id: z.string().uuid("Invalid transaction UUID"),
  barberId: z.string().min(1, "Barber ID is required"),
  serviceId: z.string().min(1, "Service ID is required"),
  totalAmount: z.number().positive("Total amount must be greater than zero"),
  listPrice: z.number().positive().optional(),
  discountType: z.enum(["NONE", "PERCENT", "FIXED"]).default("NONE"),
  discountAmount: z.number().nonnegative().default(0),
  amountPaid: z.number().positive().optional(),
  tipAmount: z.number().nonnegative().default(0),
  customAmount: z.boolean().default(false),
  customAmountNote: z.string().max(255).nullable().optional(),
  paymentMethod: z.enum(["CASH", "GCASH", "MAYA"]).default("CASH"),
  paymentReference: z.string().nullable().optional(),
  transactionTime: z.string().datetime({ message: "Invalid ISO datetime string" }),
  deviceKey: z.string().uuid().optional(),
  // Assignment active on the phone when the sale was made. Absent on legacy queued sales.
  assignmentId: z.string().uuid().optional(),
}).refine((item) => !item.assignmentId || item.deviceKey, {
  message: "deviceKey is required when assignmentId is present",
  path: ["deviceKey"],
});

export const syncBatchSchema = z.object({
  transactions: z.array(syncTransactionItemSchema).min(1, "At least one transaction required for sync"),
});

export type DeviceBindPayload = z.infer<typeof deviceBindSchema>;
export type SyncTransactionItem = z.infer<typeof syncTransactionItemSchema>;
export type SyncBatchPayload = z.infer<typeof syncBatchSchema>;
