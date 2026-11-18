'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { BRAND } from '@muse/core/brand';
import { strings } from '@muse/core/i18n';
import { useMuse } from '../lib/store';
import { registerServiceWorker } from '../lib/push';
import { Avatar } from './Avatar';

export function AppShell({ children }: { children: ReactNode }) {
  const { s } = useMuse();
  const path = usePathname();
  const router = useRouter();
  const me = s.me;

  useEffect(() => {
    if (me === null) router.replace('/onboarding');
    else if (me && !me.onboarded) router.replace('/onboarding');
  }, [me, router]);

  useEffect(() => {
    if (!me) return;
    const root = document.documentElement;
    if (me.settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', me.settings.theme);
    root.setAttribute('data-reduced-motion', String(me.settings.reducedMotion));
    root.lang = me.settings.language;
    void registerServiceWorker();
  }, [me]);

  if (!me || !me.onboarded) return <div className="center" aria-busy="true"><p className="muted">Loading…</p></div>;
  const t = strings(me.settings.language);
  const links: { href: string; label: string; short: string; badge?: number }[] = [
    { href: '/', label: t.chat, short: t.chat },
    { href: '/tasks', label: t.tasks, short: t.tasks, badge: s.tasksRunning || undefined },
    { href: '/approvals', label: t.approvals, short: t.approvals, badge: s.pendingApprovals || undefined },
    { href: '/activity', label: t.activity, short: t.activity },
    { href: '/memory', label: t.memory, short: t.memory },
    { href: '/connections', label: t.connections, short: 'Apps' },
    { href: '/avatar', label: me.avatar.name, short: me.avatar.name },
    { href: '/settings', label: t.settings, short: t.settings },
  ];
  const mobile = links.filter((l) => ['/', '/tasks', '/approvals', '/activity', '/settings'].includes(l.href));
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <Avatar settings={me.avatar} state={s.tasksRunning ? 'working' : 'idle'} size={40} reducedMotion={me.settings.reducedMotion} />
          <span>{BRAND.shortName}</span>
        </div>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="nav-link" aria-current={path === l.href ? 'page' : undefined}>
            <span>{l.label}</span>
            {l.badge ? <span className="badge" aria-label={`${l.badge} pending`}>{l.badge}</span> : null}
          </Link>
        ))}
        <div style={{ flex: 1 }} />
        <p className="disclosure">{BRAND.aiDisclosure}</p>
      </nav>
      <div className="main">{children}</div>
      <nav className="tabbar" aria-label="Main">
        {mobile.map((l) => (
          <Link key={l.href} href={l.href} aria-current={path === l.href ? 'page' : undefined}>
            {l.short}
            {l.badge ? <span className="badge">{l.badge}</span> : null}
          </Link>
        ))}
      </nav>
      <div className="toasts" role="status" aria-live="polite">
        {s.toasts.map((t2) => t2.href ? <Link key={t2.id} className="toast" href={t2.href}>{t2.text}</Link> : <div key={t2.id} className="toast">{t2.text}</div>)}
      </div>
    </div>
  );
}
