import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { isAdmin } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { EmptyState } from '../ui/Surface';

/** Shows its content to owners and admins; others see why it's unavailable. (The API enforces it too.) */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { workspace } = useWorkspace();
  if (isAdmin(workspace.role)) return children;
  return (
    <EmptyState icon={<Lock className="size-7" />} title="Owners and admins only">
      Ask an owner or admin of {workspace.name} if you need access.
    </EmptyState>
  );
}
