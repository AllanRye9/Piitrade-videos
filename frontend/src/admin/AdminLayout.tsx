import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Flag, Film, LayoutDashboard, LogOut, MapPin, Menu, MessageSquare, ScrollText, ShieldCheck, ShoppingBag, UserCircle, Users, X } from 'lucide-react';
import { useAdminAuth } from './AdminAuthContext';
import { ADMIN_BASE } from './paths';
import { Badge, cx } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Users;
  permission?: string;
  primaryOnly?: boolean;
  end?: boolean;
}

const NAV: Array<{ heading?: string; items: NavItem[] }> = [
  { items: [{ to: '', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    heading: 'Manage',
    items: [
      { to: 'users', label: 'Users', icon: Users, permission: 'users.view' },
      { to: 'videos', label: 'Videos', icon: Film, permission: 'videos.view' },
      { to: 'comments', label: 'Comments', icon: MessageSquare, permission: 'comments.view' },
      { to: 'reports', label: 'Reports', icon: Flag, permission: 'reports.view' },
      { to: 'products', label: 'Products', icon: ShoppingBag, permission: 'products.view' },
      { to: 'locations', label: 'Locations', icon: MapPin, permission: 'locations.view' },
    ],
  },
  {
    heading: 'Administration',
    items: [
      { to: 'admins', label: 'Admins & roles', icon: ShieldCheck, primaryOnly: true },
      { to: 'activity', label: 'Activity log', icon: ScrollText, primaryOnly: true },
    ],
  },
];

export default function AdminLayout() {
  const { admin, can, isPrimary, logout } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [location.pathname]);

  const visible = (i: NavItem) => (i.primaryOnly ? isPrimary : i.permission ? can(i.permission) : true);

  const nav = (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
      {NAV.map((group, gi) => {
        const items = group.items.filter(visible);
        if (!items.length) return null;
        return (
          <div key={gi}>
            {group.heading && <p className="px-3 mb-1.5 text-[10px] uppercase tracking-wider text-white/30 font-semibold">{group.heading}</p>}
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={i.to}>
                  <NavLink
                    to={i.to ? `${ADMIN_BASE}/${i.to}` : ADMIN_BASE}
                    end={i.end}
                    className={({ isActive }) =>
                      cx('flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium', isActive ? 'bg-brand-orange/15 text-brand-amber' : 'text-white/65 hover:bg-white/5 hover:text-white')
                    }
                  >
                    <i.icon size={17} />
                    {i.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const sidebar = (
    <div className="h-full flex flex-col bg-neutral-900 border-r border-white/10">
      <div className="h-14 shrink-0 flex items-center gap-2.5 px-5 border-b border-white/10">
        <span className="w-7 h-7 rounded-lg bg-brand-orange grid place-items-center text-white font-extrabold text-sm">P</span>
        <span className="text-white font-bold">Piitrade Admin</span>
      </div>
      {nav}
      <div className="p-3 border-t border-white/10">
        <NavLink
          to={`${ADMIN_BASE}/account`}
          className={({ isActive }) => cx('flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium', isActive ? 'bg-white/10 text-white' : 'text-white/65 hover:bg-white/5 hover:text-white')}
        >
          <UserCircle size={17} /> My account
        </NavLink>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {/* desktop sidebar */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-60 z-30">{sidebar}</aside>

      {/* mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="w-64 max-w-[80%]">{sidebar}</div>
          <button aria-label="Close menu" className="flex-1 bg-black/60" onClick={() => setOpen(false)} />
        </div>
      )}

      <div className="lg:pl-60 flex flex-col min-h-screen">
        <header className="sticky top-0 z-20 h-14 flex items-center justify-between gap-3 px-4 sm:px-6 bg-neutral-950/90 backdrop-blur border-b border-white/10">
          <button className="lg:hidden p-1.5 -ml-1.5 text-white/70" aria-label="Open menu" onClick={() => setOpen(true)}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-right min-w-0">
              <p className="text-sm text-white font-medium truncate">{admin?.name || admin?.email}</p>
              <p className="text-[11px] text-white/40 truncate hidden sm:block">{admin?.name ? admin.email : ''}</p>
            </div>
            <Badge tone={isPrimary ? 'orange' : 'blue'}>{isPrimary ? 'Primary admin' : 'Admin'}</Badge>
            <button
              onClick={() => {
                logout();
                navigate(`${ADMIN_BASE}/login`);
              }}
              className="p-2 rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 max-w-[1400px] w-full">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
