import Dexie, { type Table } from "dexie";

export interface LocalTransaction {
  id: string; // UUIDv4
  barberId: string;
  barberName: string;
  serviceId: string;
  serviceName: string;
  price: number;
  totalAmount: number;
  paymentMethod: "CASH" | "GCASH";
  paymentReference?: string | null;
  transactionTime: string; // ISO datetime string
  synced: number; // 0 = pending sync, 1 = synced
  syncedAt?: string | null;
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
 * Returns the persistent device key for this browser. Creates and stores one
 * on first call. This key is used for cashier attribution — it is not a secret.
 */
export function getOrCreateDeviceKey(): string {
  const STORAGE_KEY = "ruzzco_device_key";
  let key = localStorage.getItem(STORAGE_KEY);
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, key);
  }
  return key;
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
    fullName: "Bayani Delo Santos",
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
