import { ArrowLeftIcon, PokerChipIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { BUY_IN_MAX } from '../../../domain/values.js';
import { api } from '../net/api.js';
import { profile } from '../store/profile.js';
import { recent } from '../store/recent.js';
import { navigate } from '../ui/route.js';
import { chips, sentence } from '../ui/text.js';

const PRESETS = [500, 1_000, 2_000, 5_000, 10_000];

export function OpenTable() {
  const [name, setName] = useState(profile.name);
  const [preset, setPreset] = useState<number | 'custom'>(1_000);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const buyIn = preset === 'custom' ? Number(custom) : preset;
  const buyInOk = Number.isSafeInteger(buyIn) && buyIn >= 1 && buyIn <= BUY_IN_MAX;

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) {
      setError(sentence('bad-name'));
      return;
    }
    if (!buyInOk) {
      setError(`A buy-in is a whole number from 1 to ${chips(BUY_IN_MAX)}.`);
      return;
    }
    setBusy(true);
    setError('');
    const r = await api.open(name.trim(), buyIn);
    setBusy(false);
    if (!r.ok) {
      setError(sentence(r.code));
      return;
    }
    profile.remember(name.trim());
    recent.remember({
      ...r.value,
      name: name.trim(),
      openedAt: Date.now(),
      buyIn,
      stack: buyIn,
      hostName: name.trim(),
      players: 1,
    });
    navigate({ name: 'table', code: r.value.code }, { replace: true });
  };

  return (
    <main className="screen">
      <div className="wrap">
        <div className="f-top">
          <button className="iconbtn" aria-label="Back" onClick={() => navigate({ name: 'landing' })}>
            <ArrowLeftIcon size={22} weight="bold" />
          </button>
          <h1>Open a table</h1>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="card f-card">
            <label className="f-label" htmlFor="open-name">
              Your name
            </label>
            <div className="field">
              <input
                id="open-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                autoComplete="nickname"
                autoCapitalize="words"
                placeholder="What the table calls you"
                enterKeyHint="done"
              />
            </div>
            <div className="f-gap" />
            <span className="f-label" id="buyin-label">
              Buy-in
            </span>
            <div className="presets" role="radiogroup" aria-labelledby="buyin-label">
              {PRESETS.map((p) => (
                <button
                  type="button"
                  key={p}
                  role="radio"
                  aria-checked={preset === p}
                  className={`preset${preset === p ? ' on' : ''}`}
                  onClick={() => setPreset(p)}
                >
                  {chips(p)}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={preset === 'custom'}
                className={`preset word${preset === 'custom' ? ' on' : ''}`}
                onClick={() => setPreset('custom')}
              >
                Custom
              </button>
            </div>
            {preset === 'custom' && (
              <>
                <div className="f-gap" />
                <label className="f-label" htmlFor="open-custom">
                  Custom buy-in
                </label>
                <div className="field">
                  <input
                    id="open-custom"
                    className="code"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 7))}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder={`1 to ${chips(BUY_IN_MAX)}`}
                    autoFocus
                  />
                </div>
              </>
            )}
            <p className="f-hint">Everyone who joins starts with this many chips.</p>
            {error && (
              <p className="f-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="f-actions">
            <button type="submit" className="btn sun block" disabled={busy} onMouseDown={(e) => e.preventDefault()}>
              <PokerChipIcon size={22} weight="fill" />
              {busy ? 'Opening' : 'Open the table'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
