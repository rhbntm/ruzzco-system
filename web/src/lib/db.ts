import Dexie, { type Table } from "dexie";

export interface LocalTransaction {
  id: string; // UUIDv4
  barberId: string;
  barberName: string;
  serviceId: string;
  serviceName: string;
  price: number;
  totalAmount: number;
  listPrice?: number;
  discountType?: "NONE" | "PERCENT" | "FIXED";
  discountAmount?: number;
  amountPaid?: number;
  tipAmount?: number;
  customAmount?: boolean;
  customAmountNote?: string | null;
  paymentMethod: "CASH" | "GCASH" | "MAYA";
  paymentReference?: string | null;
  transactionTime: string; // ISO datetime string
  synced: number; // 0 = pending sync, 1 = synced
  syncedAt?: string | null;
  // Sale-time attribution facts, copied from the binding. Never rewritten after a rebind.
  // Absent on sales queued before assignment ids existed.
  assignmentId?: string;
  deviceKey?: string;
  // Set when the server refused this sale (a SyncRejectReason). State is derived, no index:
  //   pending  = synced 0, no syncError       (in the automatic sync queue)
  //   rejected = synced 0, has syncError      (kept, never auto-retried, shown to the user)
  //   synced   = synced 1
  // Only the retry action clears it. The sale's own fields are never rewritten.
  syncError?: string;
}

export interface CachedBarber {
  id: string;
  fullName: string;
  commissionRate: number;
  isActive: boolean;
}

export interface CachedService {
  id: string;
  name: string;
  standardPrice: number;
  isActive: boolean;
}

export interface LocalDeviceBinding {
  deviceKey: string; // primary key — the localStorage UUID
  barberId: string;
  barberName: string;
  assignedAt: string; // ISO datetime
  assignmentId?: string; // generated on the phone at bind time; absent on bindings made before assignment ids
}

export class RuzzcoPOSDatabase extends Dexie {
  transactions!: Table<LocalTransaction, string>;
  barbers!: Table<CachedBarber, string>;
  services!: Table<CachedService, string>;
  deviceBindings!: Table<LocalDeviceBinding, string>;

  constructor() {
    super("RuzzcoPOSDB");
    this.version(1).stores({
      transactions: "id, barberId, serviceId, transactionTime, synced",
      barbers: "id, fullName, isActive",
      services: "id, name, isActive",
    });
    // v2: adds device binding persistence
    this.version(2).stores({
      transactions: "id, barberId, serviceId, transactionTime, synced",
      barbers: "id, fullName, isActive",
      services: "id, name, isActive",
      deviceBindings: "deviceKey, barberId",
    });
  }
}

export const db = new RuzzcoPOSDatabase();

/**
 * Universally safe UUID generator.
 * Works in secure (HTTPS / localhost) and non-secure (LAN HTTP on mobile devices) contexts.
 */
export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Standard UUID v4 via crypto.getRandomValues if available in non-secure contexts
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Math.random fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns the persistent device key for this browser. Creates and stores one
 * on first call. It identifies the device on its assignment records — it is not a secret.
 */
export function getOrCreateDeviceKey(): string {
  const STORAGE_KEY = "ruzzco_device_key";
  try {
    let key = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (!key) {
      key = generateUUID();
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, key);
      }
    }
    return key;
  } catch {
    return generateUUID();
  }
}

// Default seed fallbacks matching database seed.ts
export const DEFAULT_BARBERS: CachedBarber[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    fullName: "Mart Baldemor",
    commissionRate: 0.5,
    isActive: true,
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    fullName: "Bayani Delos Santos",
    commissionRate: 0.5,
    isActive: true,
  },
];

export const DEFAULT_SERVICES: CachedService[] = [
  {
    id: "10000000-0000-0000-0000-000000000001",
    name: "Haircut",
    standardPrice: 150,
    isActive: true,
  },
  {
    id: "10000000-0000-0000-0000-000000000002",
    name: "Beard Trim / Shave",
    standardPrice: 100,
    isActive: true,
  },
];

/**
 * Initializes IndexedDB catalog caches with fallback defaults if empty.
 */
export async function initializeLocalCatalog() {
  const barberCount = await db.barbers.count();
  if (barberCount === 0) {
    await db.barbers.bulkPut(DEFAULT_BARBERS);
  }

  const serviceCount = await db.services.count();
  if (serviceCount === 0) {
    await db.services.bulkPut(DEFAULT_SERVICES);
  }
}
