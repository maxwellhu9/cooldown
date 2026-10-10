import type { Bank, Purchase, Txn as NessieTxn } from './bank';

export type MerchantDef = {
  key: string;
  name: string;
  category: 'food' | 'delivery' | 'shopping' | 'games' | 'transport' | 'groceries';
  emoji: string;
  min: number;
  max: number;
  perWeek: number; // how often the fake student visits
  night: number; // chance a visit happens 10pm–3am
  items: string[];
};

export const MERCHANTS: MerchantDef[] = [
  { key: 'starbucks', name: 'Starbucks', category: 'food', emoji: '☕', min: 4, max: 8, perWeek: 4, night: 0.02, items: ['Oat latte', 'Cold brew', 'Cake pop'] },
  { key: 'chipotle', name: 'Chipotle', category: 'food', emoji: '🌯', min: 10, max: 15, perWeek: 2, night: 0.1, items: ['Burrito bowl', 'Chips & guac'] },
  { key: 'doordash', name: 'DoorDash', category: 'delivery', emoji: '🛵', min: 18, max: 42, perWeek: 2.5, night: 0.6, items: ['Late-night wings', 'Pad thai', 'Pizza'] },
  { key: 'amazon', name: 'Amazon', category: 'shopping', emoji: '📦', min: 12, max: 85, perWeek: 2, night: 0.5, items: ['Desk lamp', 'LED strip lights', 'Phone case', 'Protein powder'] },
  { key: 'target', name: 'Target', category: 'shopping', emoji: '🎯', min: 15, max: 60, perWeek: 1, night: 0.05, items: ['Dorm stuff', 'Snacks', 'Hoodie'] },
  { key: 'steam', name: 'Steam', category: 'games', emoji: '🎮', min: 5, max: 60, perWeek: 0.8, night: 0.7, items: ['Summer sale game', 'DLC pack', 'Skin bundle'] },
  { key: 'uber', name: 'Uber', category: 'transport', emoji: '🚗', min: 8, max: 25, perWeek: 1.5, night: 0.35, items: ['Ride home', 'Ride to RDU'] },
  { key: 'nike', name: 'Nike', category: 'shopping', emoji: '👟', min: 60, max: 140, perWeek: 0.25, night: 0.3, items: ['Running shoes', 'Dunks'] },
  { key: 'traderjoes', name: "Trader Joe's", category: 'groceries', emoji: '🛒', min: 25, max: 70, perWeek: 1, night: 0, items: ['Groceries'] },
];
export const merchantByKey = (k: string) => MERCHANTS.find((m) => m.key === k);

// ---------- profile: which Nessie ids belong to "us" ----------

export type Profile = {
  mode: 'live' | 'demo';
  key?: string;
  customerId: string;
  checkingId: string;
  savingsId: string;
  merchantIds: Record<string, string>; // our merchant key -> Nessie merchant _id
};
const PROFILE_KEY = 'cooldown.profile';

export function loadProfile(): Profile | null {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null');
  } catch {
    return null;
  }
}
export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {}
}
export function clearProfile() {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {}
}

// ---------- time-of-day hack ----------
// Nessie stores purchase_date as a plain date. The whole app is about *when* you
// spend, so we tuck the clock time onto the end of the description: "Pizza @23:41".

export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const stamp = (item: string, hour: number, minute: number) =>
  `${item} @${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

function parseWhen(date: string, desc: string) {
  const [y, mo, d] = date.slice(0, 10).split('-').map(Number);
  const m = desc.match(/@(\d{1,2}):(\d{2})$/);
  return new Date(y, mo - 1, d, m ? +m[1] : 12, m ? +m[2] : 0);
}
const stripStamp = (desc: string) => desc.replace(/\s*@\d{1,2}:\d{2}$/, '');

export type Txn = { id: string; merchant: MerchantDef | undefined; amount: number; when: Date; item: string };
export type Skip = { id: string; merchant: MerchantDef | undefined; amount: number; when: Date; item: string };

export function parseTxns(ps: Purchase[], profile: Profile): Txn[] {
  const byId = Object.fromEntries(Object.entries(profile.merchantIds).map(([k, id]) => [id, k]));
  return ps
    .map((p) => ({
      id: p._id,
      merchant: merchantByKey(byId[p.merchant_id]),
      amount: p.amount,
      when: parseWhen(p.purchase_date, p.description ?? ''),
      item: stripStamp(p.description ?? ''),
    }))
    .sort((a, b) => b.when.getTime() - a.when.getTime());
}

// A skip is recorded twice: a transfer out of checking and a deposit into the savings
// jar, both tagged "cooldown-skip|<merchant>|<item @hh:mm>". The jar reads the deposits.
export const SKIP_TAG = 'cooldown-skip';
export function parseSkips(ts: NessieTxn[]): Skip[] {
  return ts
    .filter((t) => t.description?.startsWith(SKIP_TAG + '|'))
    .map((t) => {
      const [, key, rest = ''] = t.description.split('|');
      return { id: t._id, merchant: merchantByKey(key), amount: t.amount, when: parseWhen(t.transaction_date, rest), item: stripStamp(rest) };
    })
    .sort((a, b) => b.when.getTime() - a.when.getTime());
}

// ---------- seeding ----------

// Seeded RNG so every demo has the same "personality".
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NIGHT_HOURS = [22, 22, 23, 23, 23, 0, 0, 1, 1, 2];
const DAY_HOURS = [8, 9, 10, 11, 12, 12, 13, 13, 14, 15, 16, 17, 18, 18, 19, 19, 20, 21];

function fakeMonth() {
  const rand = mulberry32(357);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const out: { merchant: MerchantDef; amount: number; date: string; description: string }[] = [];
  const today = new Date();
  for (let back = 30; back >= 1; back--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const weekend = day.getDay() === 5 || day.getDay() === 6;
    for (const m of MERCHANTS) {
      // Fridays and Saturdays get a bit worse, as they do.
      if (rand() > (m.perWeek / 7) * (weekend ? 1.4 : 1)) continue;
      const hour = rand() < m.night * (weekend ? 1.3 : 1) ? pick(NIGHT_HOURS) : pick(DAY_HOURS);
      const amount = Math.round(m.min + rand() * (m.max - m.min)); // Nessie keeps whole dollars
      out.push({ merchant: m, amount, date: ymd(day), description: stamp(pick(m.items), hour, Math.floor(rand() * 60)) });
    }
  }
  return out;
}

// Runs promises a few at a time so we don't hammer the sandbox.
async function inBatches<T>(tasks: (() => Promise<T>)[], size: number, onDone: () => void) {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += size) {
    const chunk = await Promise.all(tasks.slice(i, i + size).map((t) => t().then((r) => (onDone(), r))));
    out.push(...chunk);
  }
  return out;
}

export async function seed(bank: Bank, key: string | undefined, onProgress: (done: number, total: number, label: string) => void): Promise<Profile> {
  const month = fakeMonth();
  const total = 3 + MERCHANTS.length + month.length;
  let done = 0;
  const tick = (label: string) => onProgress(++done, total, label);

  const customerId = await bank.createCustomer('Rameses', 'Tarheel');
  tick('Created customer');
  const checkingId = await bank.createAccount(customerId, 'Checking', 'Everyday checking', 4200);
  tick('Opened checking');
  const savingsId = await bank.createAccount(customerId, 'Savings', 'Cooldown jar', 0);
  tick('Opened savings jar');

  const ids = await inBatches(
    MERCHANTS.map((m) => () => bank.createMerchant(m.name, m.category)),
    5,
    () => tick('Creating merchants'),
  );
  const merchantIds = Object.fromEntries(MERCHANTS.map((m, i) => [m.key, ids[i]]));

  await inBatches(
    month.map((p) => () => bank.createPurchase(checkingId, { merchant_id: merchantIds[p.merchant.key], amount: p.amount, purchase_date: p.date, description: p.description })),
    6,
    () => tick('Backfilling a month of purchases'),
  );

  const profile: Profile = { mode: bank.mode, key, customerId, checkingId, savingsId, merchantIds };
  saveProfile(profile);
  return profile;
}

// ---------- formatting ----------

export const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const money0 = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const fmtHour = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
export const isNight = (h: number) => h >= 22 || h < 4;
