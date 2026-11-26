import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from './Button';
import { useToast } from './Toast';

/** Copies text to the clipboard and confirms with a tick and a toast. */
export function CopyButton({
  value,
  label = 'Copy',
  toast: toastText = 'Copied',
}: {
  value: string;
  label?: string;
  toast?: string;
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <Button
      size="sm"
      icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast(toastText);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast('Copying failed; select the text and copy it manually.', 'error');
        }
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

/** A read-only box for secrets and links, with a copy button. */
export function CopyField({ value, toast }: { value: string; toast?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 p-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate bg-transparent p-0 text-xs" title={value}>
        {value}
      </code>
      <CopyButton value={value} {...(toast && { toast })} />
    </div>
  );
}
