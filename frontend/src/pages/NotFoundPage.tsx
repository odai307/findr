import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { buttonClass } from '../ui/Button';
import { EmptyState } from '../ui/Surface';

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass className="size-8" />}
      title="Page not found"
      action={
        <Link to="/" className={buttonClass('primary')}>
          Back to search
        </Link>
      }
    >
      The page you're looking for doesn't exist or you don't have access to it.
    </EmptyState>
  );
}
