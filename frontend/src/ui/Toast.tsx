import { CheckCircle2, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';

interface Toast {
  id: number;
  tone: 'success' | 'error';
  message: string;
}

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});

/** Small confirmations ("Invite link copied") in the corner; announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-lg',
              t.tone === 'error' ? 'text-danger' : 'text-fg',
            )}
          >
            {t.tone === 'error' ? (
              <XCircle className="size-4 shrink-0" aria-hidden />
            ) : (
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
