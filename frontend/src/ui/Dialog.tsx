import { X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from './Button';

/**
 * A modal built on the native <dialog> element, which handles focus trapping, Escape to close
 * and the backdrop for us.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
      className={`m-auto w-[calc(100%-2rem)] rounded-lg border border-line bg-surface p-0 text-fg shadow-xl ${
        wide ? 'max-w-xl' : 'max-w-md'
      }`}
    >
      {open && (
        <div className="flex flex-col">
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              {description && <p className="mt-1 text-sm text-muted">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-4" />
            </button>
          </div>
          {children && <div className="px-5 pt-4">{children}</div>}
          {footer && (
            <div className="mt-5 flex justify-end gap-2 border-t border-line px-5 py-3">
              {footer}
            </div>
          )}
          {!footer && <div className="pb-5" />}
        </div>
      )}
    </dialog>
  );
}

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(() =>
  Promise.resolve(false),
);

/** Provides `useConfirm()`: an accessible replacement for window.confirm. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(
    null,
  );
  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })),
    [],
  );
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={state !== null}
        onClose={() => close(false)}
        title={state?.title ?? ''}
        description={state?.description}
        footer={
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {state?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
