import { ChevronDown, ChevronUp, ChevronsUp, Minus, type LucideIcon } from 'lucide-react';
import { Priority } from '@kurul/shared-types';
import { cn } from '@/lib/utils';

const PRIORITY_META: Record<Priority, { icon: LucideIcon; className: string; labelKey: Priority }> =
  {
    [Priority.LOW]: {
      icon: ChevronDown,
      className: 'text-priority-low',
      labelKey: Priority.LOW,
    },
    [Priority.MEDIUM]: {
      icon: Minus,
      className: 'text-priority-medium',
      labelKey: Priority.MEDIUM,
    },
    [Priority.HIGH]: {
      icon: ChevronUp,
      className: 'text-priority-high',
      labelKey: Priority.HIGH,
    },
    [Priority.URGENT]: {
      icon: ChevronsUp,
      className: 'text-priority-urgent',
      labelKey: Priority.URGENT,
    },
  };

interface PriorityIconProps {
  priority: Priority;
  className?: string;
  title?: string;
}

export function PriorityIcon({
  priority,
  className,
  title,
}: PriorityIconProps): React.ReactElement {
  const meta = PRIORITY_META[priority];
  const Icon = meta.icon;
  return (
    <Icon
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn('size-3.5 shrink-0', meta.className, className)}
    />
  );
}
