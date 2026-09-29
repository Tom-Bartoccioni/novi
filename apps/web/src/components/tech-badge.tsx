import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function TechBadge({
  label,
  confidence,
  highlighted,
  title,
}: {
  label: string;
  confidence?: number;
  highlighted?: boolean;
  title?: string;
}) {
  return (
    <Badge
      variant={highlighted ? 'default' : 'secondary'}
      title={title}
      className={cn('font-normal', confidence !== undefined && confidence < 0.6 && 'opacity-70')}
    >
      {label}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    to_review: 'À voir',
    interested: 'Intéressée',
    contacted: 'Contactée',
    rejected: 'Refusée',
    ignored: 'Ignorée',
  };
  if (status === 'to_review') return null;
  return <Badge variant="outline">{labels[status] ?? status}</Badge>;
}
