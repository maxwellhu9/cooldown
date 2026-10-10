// The app talks to a `Bank`. There are two implementations:
//   NessieBank -> the real Capital One Nessie API (needs a key)
//   DemoBank   -> an in-browser copy with the same shapes, so the app works offline
// Everything above this file is written against the interface and can't tell them apart.
//
// Quirks of the current (2026) Nessie, found by poking it, not from the docs:
//   - balances are never updated by purchases/transfers/deposits; they're just records
//   - amounts are stored as whole dollars (12.50 comes back as 12)
//   - transfers have no payee, and come back with `id` instead of `_id`

export type Account = {
  _id: string;
  type: string;
  nickname: string;
  balance: number;
  rewards: number;
  customer_id: string;
};
export type Merchant = { _id: string; name: string; category: string[] | string | null };
export type Purchase = {
  _id: string;
  merchant_id: string;
  payer_id: string;
  purchase_date: string; // YYYY-MM-DD; Nessie has no time-of-day, see model.ts
  amount: number;
  status: string;
  medium: string;
  description: string;
};
export type Txn = { _id: string; transaction_date: string; amount: number; status: string; description: string };

export type NewPurchase = { merchant_id: string; amount: number; purchase_date: string; description: string };

export interface Bank {
  readonly mode: 'live' | 'demo';
  createCustomer(first: string, last: string): Promise<string>;
  createAccount(customerId: string, type: 'Checking' | 'Savings', nickname: string, balance: number): Promise<string>;
  getAccount(id: string): Promise<Account>;
  createMerchant(name: string, category: string): Promise<string>;
  listPurchases(accountId: string): Promise<Purchase[]>;
  createPurchase(accountId: string, p: NewPurchase): Promise<string>;
  createTransfer(accountId: string, amount: number, date: string, description: string): Promise<string>;
  listDeposits(accountId: string): Promise<Txn[]>;
  createDeposit(accountId: string, amount: number, date: string, description: string): Promise<string>;
}

// Plain HTTP works on the old docs but the server only answers on HTTPS now.
const BASE = 'https://api.nessieisreal.com';

// Nessie wants an address on customers and a geocode on merchants. Chapel Hill it is.
const ADDRESS = { street_number: '100', street_name: 'Franklin St', city: 'Chapel Hill', state: 'NC', zip: '27514' };
const GEOCODE = { lat: 35.9132, lng: -79.0558 };

export class NessieBank implements Bank {
  readonly mode = 'live' as const;
  constructor(private key: string) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${BASE}${path}${sep}key=${encodeURIComponent(this.key)}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Nessie ${method} ${path.split('?')[0]} → ${res.status} ${data?.message ?? ''}`);
    return data as T;
  }

  // POSTs come back as { code, message, objectCreated: {...} }.
  private async create(path: string, body: unknown): Promise<string> {
    const r = await this.req<{ objectCreated?: { _id: string }; _id?: string }>('POST', path, body);
    const id = r.objectCreated?._id ?? r._id;
    if (!id) throw new Error(`Nessie POST ${path} returned no id`);
    return id;
  }

  createCustomer(first: string, last: string) {
    return this.create('/customers', { first_name: first, last_name: last, address: ADDRESS });
  }
  createAccount(customerId: string, type: 'Checking' | 'Savings', nickname: string, balance: number) {
    return this.create(`/customers/${customerId}/accounts`, { type, nickname, rewards: 0, balance });
  }
  getAccount(id: string) {
    return this.req<Account>('GET', `/accounts/${id}`);
  }
  createMerchant(name: string, category: string) {
    return this.create('/merchants', { name, category, address: ADDRESS, geocode: GEOCODE });
  }
  listPurchases(accountId: string) {
    return this.req<Purchase[]>('GET', `/accounts/${accountId}/purchases`);
  }
  createPurchase(accountId: string, p: NewPurchase) {
    return this.create(`/accounts/${accountId}/purchases`, { ...p, medium: 'balance', status: 'completed' });
  }
  createTransfer(accountId: string, amount: number, date: string, description: string) {
    return this.create(`/accounts/${accountId}/transfers`, { amount, transaction_date: date, status: 'completed', description });
  }
  listDeposits(accountId: string) {
    return this.req<Txn[]>('GET', `/accounts/${accountId}/deposits`);
  }
  createDeposit(accountId: string, amount: number, date: string, description: string) {
    return this.create(`/accounts/${accountId}/deposits`, { medium: 'balance', amount, transaction_date: date, status: 'completed', description });
  }
}

type DB = {
  accounts: Record<string, Account>;
  merchants: Record<string, Merchant>;
  purchases: Purchase[];
  transfers: (Txn & { account_id: string })[];
  deposits: (Txn & { account_id: string })[];
};
const DEMO_KEY = 'cooldown.demoDB';

// Mirrors live Nessie on purpose, quirks included (whole dollars, balances never move),
// so a demo that works offline also works on stage.
export class DemoBank implements Bank {
  readonly mode = 'demo' as const;
  private db: DB;

  constructor() {
    let saved: DB | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(DEMO_KEY) ?? 'null');
    } catch {}
    this.db = saved?.deposits ? saved : { accounts: {}, merchants: {}, purchases: [], transfers: [], deposits: [] };
  }
  static wipe() {
    try {
      localStorage.removeItem(DEMO_KEY);
    } catch {}
  }
  private save() {
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify(this.db));
    } catch {}
  }
  private id() {
    return crypto.randomUUID();
  }

  async createCustomer() {
    return this.id();
  }
  async createAccount(customerId: string, type: 'Checking' | 'Savings', nickname: string, balance: number) {
    const _id = this.id();
    this.db.accounts[_id] = { _id, type, nickname, balance, rewards: 0, customer_id: customerId };
    this.save();
    return _id;
  }
  async getAccount(id: string) {
    const a = this.db.accounts[id];
    if (!a) throw new Error('Demo account missing. Reset the app.');
    return { ...a };
  }
  async createMerchant(name: string, category: string) {
    const _id = this.id();
    this.db.merchants[_id] = { _id, name, category };
    this.save();
    return _id;
  }
  async listPurchases(accountId: string) {
    return this.db.purchases.filter((p) => p.payer_id === accountId);
  }
  async createPurchase(accountId: string, p: NewPurchase) {
    const _id = this.id();
    this.db.purchases.push({ ...p, amount: Math.trunc(p.amount), _id, payer_id: accountId, medium: 'balance', status: 'completed' });
    this.save();
    return _id;
  }
  async createTransfer(accountId: string, amount: number, date: string, description: string) {
    const _id = this.id();
    this.db.transfers.push({ _id, account_id: accountId, amount: Math.trunc(amount), transaction_date: date, status: 'completed', description });
    this.save();
    return _id;
  }
  async listDeposits(accountId: string) {
    return this.db.deposits.filter((d) => d.account_id === accountId);
  }
  async createDeposit(accountId: string, amount: number, date: string, description: string) {
    const _id = this.id();
    this.db.deposits.push({ _id, account_id: accountId, amount: Math.trunc(amount), transaction_date: date, status: 'completed', description });
    this.save();
    return _id;
  }
}
