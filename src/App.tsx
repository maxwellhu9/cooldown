import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DemoBank, NessieBank } from './bank';
import { SKIP_TAG, clearProfile, loadProfile, merchantByKey, money0, parseSkips, parseTxns, stamp, ymd, type MerchantDef, type Profile, type Txn } from './model';
import { assess, type Assessment } from './regret';
import { Setup } from './components/Setup';

const SHELF = [
  { merchant: 'amazon', item: 'Mechanical keyboard', price: 130, color: 'yellow' },
  { merchant: 'doordash', item: 'Wings + fries', price: 28, color: 'pink' },
  { merchant: 'nike', item: 'Dunk Lows', price: 120, color: 'blue' },
  { merchant: 'steam', item: 'Summer sale bundle', price: 60, color: 'purple' },
  { merchant: 'target', item: 'Dorm haul', price: 45, color: 'red' },
  { merchant: 'starbucks', item: 'Oat latte', price: 6, color: 'green' },
] as const;

// ?hour=1 pretends it's 1am, so the late-night check still fires during a daytime demo.
const fakeHour = new URLSearchParams(location.search).get('hour');
const nowHour = () => (fakeHour !== null ? +fakeHour % 24 : new Date().getHours());

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(loadProfile);
  if (!profile) return <Setup onReady={setProfile} />;
  return <Store profile={profile} onReset={() => { clearProfile(); DemoBank.wipe(); setProfile(null); }} />;
}

type Hold = { m: MerchantDef; item: string; price: number; color: string; a: Assessment };
type Screen = { kind: 'shop' } | { kind: 'hold'; h: Hold } | { kind: 'saved'; h: Hold } | { kind: 'bought'; h: Hold };

function Store({ profile, onReset }: { profile: Profile; onReset: () => void }) {
  const bank = useMemo(() => (profile.mode === 'live' ? new NessieBank(profile.key!) : new DemoBank()), [profile]);
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [saved, setSaved] = useState(0);
  const [checking, setChecking] = useState(0);
  const [err, setErr] = useState('');
  const [screen, setScreen] = useState<Screen>({ kind: 'shop' });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [ps, ds, acct] = await Promise.all([bank.listPurchases(profile.checkingId), bank.listDeposits(profile.savingsId), bank.getAccount(profile.checkingId)]);
      const t = parseTxns(ps, profile), skips = parseSkips(ds);
      const savedTotal = skips.reduce((s, x) => s + x.amount, 0);
      // Nessie never moves balances, so: opening balance minus everything that went out.
      setChecking(acct.balance - t.reduce((s, x) => s + x.amount, 0) - savedTotal);
      setSaved(savedTotal);
      setTxns(t);
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [bank, profile]);
  useEffect(() => void refresh(), [refresh]);

  function buy(p: (typeof SHELF)[number]) {
    if (!txns) return;
    const m = merchantByKey(p.merchant)!;
    setScreen({ kind: 'hold', h: { m, item: p.item, price: p.price, color: p.color, a: assess(m, p.price, nowHour(), txns, checking) } });
  }

  async function decide(h: Hold, choice: 'save' | 'buy') {
    setBusy(true);
    const desc = stamp(h.item, nowHour(), new Date().getMinutes());
    const today = ymd(new Date());
    try {
      if (choice === 'buy') {
        await bank.createPurchase(profile.checkingId, { merchant_id: profile.merchantIds[h.m.key], amount: h.price, purchase_date: today, description: desc });
      } else {
        // Nessie transfers have no payee, so "move to savings" is two records.
        const tag = `${SKIP_TAG}|${h.m.key}|${desc}`;
        await Promise.all([bank.createTransfer(profile.checkingId, h.price, today, tag), bank.createDeposit(profile.savingsId, h.price, today, tag)]);
      }
      await refresh();
      setScreen({ kind: choice === 'buy' ? 'bought' : 'saved', h });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (screen.kind === 'hold') return <HoldScreen h={screen.h} busy={busy} onSave={() => decide(screen.h, 'save')} onBuy={() => decide(screen.h, 'buy')} />;
  if (screen.kind === 'saved') return <SavedScreen h={screen.h} total={saved} onBack={() => setScreen({ kind: 'shop' })} />;
  if (screen.kind === 'bought') return <BoughtScreen h={screen.h} onBack={() => setScreen({ kind: 'shop' })} />;

  return (
    <main className="shop">
      <header className="bar">
        <span className="wordmark">cooldown</span>
        <span className="pill saved-pill">saved {money0(saved)}</span>
        <span className="pill">checking {money0(checking)}</span>
      </header>
      {err && <p className="err">{err}</p>}
      <h1 className="shop-title">What are we buying?</h1>
      <div className="shelf">
        {SHELF.map((p) => (
          <div key={p.item} className={`tile ${p.color}`}>
            <span className="tile-store">{merchantByKey(p.merchant)!.name}</span>
            <span className="tile-item">{p.item}</span>
            <div className="tile-foot">
              <span className="tile-price">{money0(p.price)}</span>
              <button className="buy" disabled={!txns} onClick={() => buy(p)}>Buy</button>
            </div>
          </div>
        ))}
      </div>
      <footer className="foot">
        {profile.mode === 'live' ? 'connected to Capital One Nessie' : 'offline demo data'} · <button onClick={onReset}>reset</button>
      </footer>
    </main>
  );
}

function HoldScreen({ h, busy, onSave, onBuy }: { h: Hold; busy: boolean; onSave: () => void; onBuy: () => void }) {
  const [left, setLeft] = useState(h.a.cooldownSec);
  const [dodge, setDodge] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  useEffect(() => { if (left <= 0) setDodge({ x: 0, y: 0 }); }, [left]);

  // While locked, the buy button jumps away from the cursor.
  const runAway = () => {
    if (left <= 0) return;
    const r = () => (Math.random() < 0.5 ? -1 : 1) * (80 + Math.random() * 90);
    setDodge({ x: r(), y: r() * 0.6 });
  };

  const reasons = [...h.a.signals].sort((a, b) => b.points - a.points).slice(0, 2);
  return (
    <main className="screen hold">
      <p className="kicker">{h.m.name} · {h.item} · {money0(h.price)}</p>
      <div className="count">{left > 0 ? left : '0'}</div>
      <h1 className="hold-title">{left > 0 ? 'Hold on a sec.' : 'Ok, your call.'}</h1>
      {reasons.length > 0 && (
        <ul className="reasons">{reasons.map((r) => <li key={r.label}>{r.detail}</li>)}</ul>
      )}
      <div className="hold-actions">
        <button className="big save" disabled={busy} onClick={onSave}>Save the {money0(h.price)} instead</button>
        <button
          className={`big ghost ${left > 0 ? 'locked' : ''}`}
          style={{ transform: `translate(${dodge.x}px, ${dodge.y}px)` }}
          onMouseEnter={runAway}
          onPointerDown={(e) => { if (left > 0) { e.preventDefault(); runAway(); } }}
          onClick={() => left <= 0 && onBuy()}
          disabled={busy}
        >
          Buy it anyway
        </button>
      </div>
    </main>
  );
}

function SavedScreen({ h, total, onBack }: { h: Hold; total: number; onBack: () => void }) {
  const coins = useRef(Array.from({ length: 28 }, () => ({ left: Math.random() * 100, delay: Math.random() * 0.9, size: 26 + Math.random() * 30, dur: 1.2 + Math.random() * 0.9 }))).current;
  return (
    <main className="screen saved">
      <div className="coins" aria-hidden>
        {coins.map((c, i) => (
          <span key={i} className="coin" style={{ left: `${c.left}%`, width: c.size, height: c.size, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s` }}>$</span>
        ))}
      </div>
      <p className="kicker">skipped: {h.item}</p>
      <div className="plus">+{money0(h.price)}</div>
      <h1 className="hold-title">moved into savings</h1>
      <p className="total">you've saved {money0(total)} so far</p>
      <button className="big dark" onClick={onBack}>Back to the store</button>
    </main>
  );
}

function BoughtScreen({ h, onBack }: { h: Hold; onBack: () => void }) {
  return (
    <main className="screen bought">
      <p className="kicker">{h.m.name}</p>
      <h1 className="hold-title">Bought the {h.item.toLowerCase()}.</h1>
      <p className="total">{money0(h.price)} came out of checking. Hope it was worth it.</p>
      <button className="big dark" onClick={onBack}>Back to the store</button>
    </main>
  );
}
