/**
 * Permission catalogue for secondary admins.
 *
 * A permission is "<resource>.<action>". The PRIMARY admin implicitly has all
 * of them (and alone can manage admins / see the audit log); a SECONDARY admin
 * has exactly the ones the primary ticked when creating/editing them.
 *
 * Rules enforced by normalizePermissions():
 *  - unknown strings are dropped
 *  - any non-view permission on a resource implies "<resource>.view" (you can't
 *    edit or delete what you can't see)
 */
export interface ResourceDef {
  key: string;
  label: string;
  actions: Array<'view' | 'create' | 'edit' | 'delete'>;
}

export const RESOURCES: ResourceDef[] = [
  { key: 'users', label: 'Users', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'videos', label: 'Videos', actions: ['view', 'edit', 'delete'] },
  { key: 'comments', label: 'Comments', actions: ['view', 'edit', 'delete'] },
  { key: 'reports', label: 'Reports (moderation)', actions: ['view', 'delete'] },
  { key: 'products', label: 'Products', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'locations', label: 'Locations', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'sites', label: 'Sites (linked marketplaces)', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'attribution', label: 'Attribution & payouts (view stats; edit = approve / pay / reverse)', actions: ['view', 'edit'] },
];

export const ALL_PERMISSIONS: string[] = RESOURCES.flatMap((r) => r.actions.map((a) => `${r.key}.${a}`));

const VALID = new Set(ALL_PERMISSIONS);

export function normalizePermissions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const raw of input) {
    const p = String(raw);
    if (!VALID.has(p)) continue;
    out.add(p);
    out.add(`${p.split('.')[0]}.view`);
  }
  return ALL_PERMISSIONS.filter((p) => out.has(p)); // stable catalogue order
}
