import { ArrowLeftIcon, HashIcon, SignInIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { api } from '../net/api.js';
import { profile } from '../store/profile.js';
import { recent } from '../store/recent.js';
import { ChipTop } from '../ui/Chip.js';
import { navigate, normalizeCode } from '../ui/route.js';
import { initial, sentence, showCode } from '../ui/text.js';

type Seats = { name: string; here: boolean }[];
type Lookup = { code: string; seats: Seats | null; missing: boolean };

/**
 * Join a table by code and name. Away seats are offered as one-tap claims:
 * joining with an away seat's name takes that seat over.
 */
export function Join({
  initialCode,
  initialName,
  message,
  onSeated,
}: {
  initialCode: string;
  initialName?: string;
  message?: string;
  /** Called instead of navigating when the seat is at the table this screen was opened for. */
  onSeated?(code: string, seatKey: string): void;
}) {
  const [code, setCode] = useState(initialCode ? showCode(initialCode) : '');
  const [name, setName] = useState(initialName ?? profile.name());
  const [error, setError] = useState(message ?? '');
  const [busy, setBusy] = useState(false);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const valid = normalizeCode(code);

  useEffect(() => {
    if (!valid) return;
    let live = true;
    void api.info(valid).then((r) => {
      if (!live) return;
      if (r.ok) setLookup({ code: valid, seats: r.value.seats, missing: false });
      else setLookup({ code: valid, seats: null, missing: r.code === 'not-found' });
    });
    return () => {
      live = false;
    };
  }, [valid]);

  const shown = lookup && lookup.code === valid ? lookup : null;
  const away = shown?.seats?.filter((s) => !s.here) ?? [];
  const here = shown?.seats?.filter((s) => s.here) ?? [];

  const join = async (asName: string) => {
    if (busy) return;
    if (!valid) {
      setError(sentence('bad-code'));
      return;
    }
    if (!asName.trim()) {
      setError(sentence('bad-name'));
      return;
    }
    setBusy(true);
    setError('');
    const r = await api.join(valid, asName.trim());
    setBusy(false);
    if (!r.ok) {
      setError(sentence(r.code));
      return;
    }
    profile.remember(asName.trim());
    recent.remember({ code: valid, name: asName.trim(), seatKey: r.value.seatKey, openedAt: Date.now() });
    if (onSeated && valid === initialCode) onSeated(valid, r.value.seatKey);
    else navigate({ name: 'table', code: valid }, { replace: true });
  };

  return (
    <main className="screen">
      <div className="wrap">
        <div className="f-top">
          <button className="iconbtn" aria-label="Back" onClick={() => navigate({ name: 'landing' })}>
            <ArrowLeftIcon size={22} weight="bold" />
          </button>
          <h1>Join a table</h1>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void join(name);
          }}
        >
          <div className="card f-card">
            <label className="f-label" htmlFor="join-code">
              Game code
            </label>
            <div className="field">
              <HashIcon size={20} weight="bold" />
              <input
                id="join-code"
                className="code"
                value={code}
                onChange={(e) => setCode(e.target.value.slice(0, 12))}
                placeholder="8 letters and digits"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            {shown?.missing && <p className="f-hint">{sentence('not-found')}</p>}
            <div className="f-gap" />
            <label className="f-label" htmlFor="join-name">
              Your name
            </label>
            <div className="field">
              <input
                id="join-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                autoComplete="nickname"
                autoCapitalize="words"
                placeholder="What the table calls you"
                enterKeyHint="go"
              />
            </div>
            {away.length > 0 && (
              <>
                <div className="f-gap" />
                <span className="f-label">Back at this table? Tap your name.</span>
                <div className="claims">
                  {away.map((s) => (
                    <button
                      type="button"
                      key={s.name}
                      className="claim"
                      disabled={busy}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setName(s.name);
                        void join(s.name);
                      }}
                    >
                      <ChipTop color="mist" label={initial(s.name)} size={32} />
                      I'm {s.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            {here.length > 0 && <p className="here-list">At the table now: {here.map((s) => s.name).join(', ')}</p>}
            {error && (
              <p className="f-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="f-actions">
            <button type="submit" className="btn tomato block" disabled={busy} onMouseDown={(e) => e.preventDefault()}>
              <SignInIcon size={22} weight="bold" />
              {busy ? 'Joining' : 'Take a seat'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
