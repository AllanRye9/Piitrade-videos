import { useState } from 'react';
import { adminApi } from './adminApi';
import { useFetch } from './hooks';
import { Select, inputCls } from './ui';

/** Dropdown of admin-managed locations. `value=''` means none. */
export function LocationSelect({ value, onChange, allLabel, className, form }: { value: string; onChange: (v: string) => void; allLabel?: string; className?: string; form?: boolean }) {
  const { data } = useFetch(() => adminApi.locationOptions(), []);
  const Comp = form ? 'select' : Select;
  return (
    <Comp value={value} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)} className={form ? `${inputCls} ${className ?? ''}` : className} aria-label="Location">
      <option value="">{allLabel ?? 'No location'}</option>
      {data?.locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </Comp>
  );
}

/** Round avatar with initials fallback. */
export function MiniAvatar({ src, name, size = 32 }: { src?: string | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return src && !broken ? (
    <img src={src} alt="" onError={() => setBroken(true)} style={{ width: size, height: size }} className="rounded-full object-cover bg-white/10 shrink-0" />
  ) : (
    <span style={{ width: size, height: size }} className="rounded-full bg-white/10 text-white/70 text-xs font-bold grid place-items-center shrink-0">
      {initial}
    </span>
  );
}

export function formatDuration(sec: number | null | undefined): string {
  if (!sec && sec !== 0) return '—';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
