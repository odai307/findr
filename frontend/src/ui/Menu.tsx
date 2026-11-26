import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * A dropdown menu: a trigger button and a popover list. Closes on outside click, Escape, or when
 * an item is chosen. Arrow keys move between items.
 */
export function Menu({
  trigger,
  label,
  children,
  align = 'left',
  side = 'bottom',
  className,
}: {
  trigger: ReactNode;
  label: string;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  side?: 'bottom' | 'top';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next =
          e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-md text-left focus-visible:outline-2"
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={list}
          role="menu"
          aria-label={label}
          className={cn(
            'absolute z-40 min-w-52 rounded-md border border-line bg-surface p-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
            side === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onSelect,
  children,
  icon,
  active,
  danger,
}: {
  onSelect: () => void;
  children: ReactNode;
  icon?: ReactNode;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none',
        danger ? 'text-danger' : 'text-fg',
        active && 'font-medium',
      )}
    >
      <span className="flex size-4 items-center justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted">{children}</div>;
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" role="separator" />;
}
