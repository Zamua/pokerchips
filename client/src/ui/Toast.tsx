import { CheckCircleIcon, InfoIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type Tone = 'error' | 'ok' | 'info';
type Toast = { id: number; text: string; tone: Tone };
type Show = (text: string, tone?: Tone) => void;

const ToastContext = createContext<Show>(() => {});

const SHOW_MS = 3_600;
const MAX_SHOWN = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const show = useCallback<Show>((text, tone = 'info') => {
    const id = next.current++;
    setToasts((ts) => [...ts.filter((t) => t.text !== text), { id, text, tone }].slice(-MAX_SHOWN));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), SHOW_MS);
  }, []);

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>
            {t.tone === 'error' ? (
              <WarningCircleIcon size={20} weight="fill" />
            ) : t.tone === 'ok' ? (
              <CheckCircleIcon size={20} weight="fill" />
            ) : (
              <InfoIcon size={20} weight="fill" />
            )}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
