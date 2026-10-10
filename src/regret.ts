import { fmtHour, isNight, money, type MerchantDef, type Txn } from './model';

// The "regret score" is deliberately a transparent checklist, not a model.
// Every point comes with a sentence the user can read, so the app never says
// "no" without explaining why.

export type Signal = { label: string; detail: string; points: number };
export type Assessment = { score: number; signals: Signal[]; cooldownSec: number };

const IMPULSE = new Set(['delivery', 'shopping', 'games']);
const DAY = 86_400_000;
const sum = (ts: { amount: number }[]) => ts.reduce((s, t) => s + t.amount, 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function assess(m: MerchantDef, amount: number, hour: number, history: Txn[], checking: number): Assessment {
  const signals: Signal[] = [];
  const atMerchant = history.filter((t) => t.merchant?.key === m.key);

  if (isNight(hour)) {
    const spent = sum(atMerchant);
    const share = spent ? sum(atMerchant.filter((t) => isNight(t.when.getHours()))) / spent : 0;
    signals.push({
      label: 'Late night',
      detail:
        share >= 0.2
          ? `It's ${fmtHour(hour)}, and ${pct(share)} of your ${m.name} spending happens after 10pm.`
          : `It's ${fmtHour(hour)}. Most of your worst purchases happen this late.`,
      points: 20 + Math.round(share * 20),
    });
  }

  const thisWeek = atMerchant.filter((t) => Date.now() - t.when.getTime() < 7 * DAY);
  if (thisWeek.length >= 2) {
    signals.push({
      label: 'On a streak',
      detail: `You've already spent ${money(sum(thisWeek))} at ${m.name} this week (${thisWeek.length} orders).`,
      points: Math.min(25, thisWeek.length * 6),
    });
  }

  const typical = median(history.map((t) => t.amount));
  if (typical && amount > 2 * typical) {
    signals.push({
      label: 'Bigger than usual',
      detail: `That's ${(amount / typical).toFixed(1)}x what you usually spend on one purchase.`,
      points: amount > 5 * typical ? 25 : 18,
    });
  }

  if (IMPULSE.has(m.category)) {
    signals.push({ label: 'Impulse aisle', detail: `${m.category[0].toUpperCase() + m.category.slice(1)} is where impulse buys usually happen.`, points: 12 });
  }

  if (checking > 0 && amount / checking >= 0.08) {
    signals.push({ label: 'Budget pressure', detail: `That's ${pct(amount / checking)} of what's left in checking.`, points: 15 });
  }

  const score = Math.min(100, signals.reduce((s, x) => s + x.points, 0));
  // Demo-friendly wait: 5s for a coffee, ~20s for a 1am sneaker drop.
  // A production version would scale this into hours.
  const cooldownSec = Math.round(5 + score * 0.15);
  return { score, signals, cooldownSec };
}
