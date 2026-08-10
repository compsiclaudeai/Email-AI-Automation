'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { AlertTriangle, BarChart3, Inbox, ListChecks, Settings } from 'lucide-react';
import { useCounts } from '@/lib/hooks';

const MAIN = [
  { href: '/inbox', label: 'Inbox', Icon: Inbox, countKey: 'unread' as const },
  { href: '/analytics', label: 'Analytics', Icon: BarChart3, countKey: null },
  { href: '/settings', label: 'Settings', Icon: Settings, countKey: null },
];

const QUEUES = [
  { href: '/inbox?status=pending', label: 'Needs approval', Icon: ListChecks, countKey: 'pending' as const },
  { href: '/inbox?status=failed', label: 'Failed', Icon: AlertTriangle, countKey: 'failed' as const },
];

export function Rail() {
  const pathname = usePathname();
  const params = useSearchParams();
  const status = params.get('status');
  const { data: counts } = useCounts();

  return (
    <nav
      aria-label="Primary"
      className="sticky top-[60px] flex flex-col gap-0.5 w-[212px] max-lg:w-16 shrink-0 px-3 py-4
                 h-[calc(100vh-60px)] overflow-y-auto border-r border-line bg-surface"
    >
      <p className="eyebrow px-2.5 pt-3 pb-1.5 max-lg:hidden">Workspace</p>
      {MAIN.map((item) => (
        <RailLink
          key={item.href}
          {...item}
          count={item.countKey ? counts?.[item.countKey] : undefined}
          active={pathname === item.href && !status}
        />
      ))}

      <p className="eyebrow px-2.5 pt-4 pb-1.5 max-lg:hidden">Queues</p>
      {QUEUES.map((item) => (
        <RailLink
          key={item.href}
          {...item}
          count={counts?.[item.countKey]}
          active={pathname === '/inbox' && status === item.href.split('=')[1]}
        />
      ))}
    </nav>
  );
}

function RailLink({
  href,
  label,
  Icon,
  count,
  active,
}: {
  href: string;
  label: string;
  Icon: typeof Inbox;
  count?: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 h-[34px] px-2.5 max-lg:justify-center max-lg:px-0
                  rounded-sm text-[13.5px] transition
                  ${active ? 'bg-brand-soft text-brand font-semibold' : 'text-ink-2 hover:bg-surface-3 hover:text-ink'}`}
      title={label}
    >
      <Icon size={16} />
      <span className="max-lg:hidden">{label}</span>
      {count !== undefined && (
        <span className={`ml-auto text-[11.5px] font-semibold max-lg:hidden ${active ? 'text-brand' : 'text-ink-3'}`}>
          {count}
        </span>
      )}
    </Link>
  );
}
