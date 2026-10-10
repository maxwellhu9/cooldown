import { useState } from 'react';
import { DemoBank, NessieBank } from '../bank';
import { seed, type Profile } from '../model';

export function Setup({ onReady }: { onReady: (p: Profile) => void }) {
  const key = (import.meta.env.VITE_NESSIE_KEY ?? '').trim();
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');

  async function go(live: boolean) {
    setErr('');
    setRunning(true);
    try {
      if (!live) DemoBank.wipe();
      const bank = live ? new NessieBank(key) : new DemoBank();
      onReady(await seed(bank, live ? key : undefined, (d, t) => setProgress(d / t)));
    } catch (e) {
      setRunning(false);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="screen setup">
      <span className="wordmark big-mark">cooldown</span>
      <h1 className="hold-title">A speed bump for impulse buys.</h1>
      <p className="total">Hit buy, wait it out, or put the money in savings instead.</p>
      {running ? (
        <div className="progress"><div style={{ width: `${progress * 100}%` }} /></div>
      ) : (
        <div className="hold-actions">
          {key && <button className="big dark" onClick={() => go(true)}>Start with Nessie</button>}
          <button className={key ? 'big ghost' : 'big dark'} onClick={() => go(false)}>{key ? 'Use offline demo' : 'Start (offline demo)'}</button>
          {!key && <p className="small-note">Add VITE_NESSIE_KEY to .env.local to use the real API.</p>}
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </main>
  );
}
