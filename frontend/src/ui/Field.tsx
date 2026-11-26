import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { cn } from '../lib/cn';

const control =
  'w-full rounded-md border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(control, 'h-9', className)} {...rest} />;
  },
);

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, 'h-9 pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

/** A label + control + optional hint, wired together for screen readers. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (props: { id: string; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      {children({ id, ...(hint ? { 'aria-describedby': hintId } : {}) })}
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
