import { useState } from 'react';
import { adminApi } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { Badge, Button, Card, Field, PageHeader, inputCls, useToast } from '../ui';

export default function MyAccountPage() {
  const { admin, setAdmin, isPrimary } = useAdminAuth();
  const toast = useToast();
  const [name, setName] = useState(admin?.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    try {
      const res = await adminApi.updateMe(name);
      setAdmin(res.admin);
      toast('Profile updated');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'error');
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (next !== confirm) return setPwError('New passwords do not match');
    setSavingPw(true);
    try {
      await adminApi.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      toast('Password changed');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <>
      <PageHeader title="My account" />
      <div className="grid gap-4 lg:grid-cols-2 max-w-4xl">
        <Card className="p-5">
          <form onSubmit={saveName} className="space-y-4">
            <h2 className="text-white font-semibold">Profile</h2>
            <Field label="Email">
              <input value={admin?.email ?? ''} disabled className={inputCls} />
            </Field>
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputCls} />
            </Field>
            <div className="flex items-center gap-2 text-sm text-white/60">
              Role: <Badge tone={isPrimary ? 'orange' : 'blue'}>{isPrimary ? 'Primary admin' : 'Secondary admin'}</Badge>
            </div>
            <Button type="submit" variant="primary" loading={savingName}>Save</Button>
          </form>
        </Card>

        <Card className="p-5">
          <form onSubmit={savePassword} className="space-y-4">
            <h2 className="text-white font-semibold">Change password</h2>
            <Field label="Current password">
              <input type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputCls} />
            </Field>
            <Field label="New password" hint="At least 8 characters">
              <input type="password" required minLength={8} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Confirm new password">
              <input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} />
            </Field>
            {pwError && <p className="text-red-400 text-sm">{pwError}</p>}
            <Button type="submit" variant="primary" loading={savingPw}>Update password</Button>
          </form>
        </Card>

        {!isPrimary && (
          <Card className="p-5 lg:col-span-2">
            <h2 className="text-white font-semibold mb-3">Your permissions</h2>
            {admin && admin.permissions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {admin.permissions.map((p) => (
                  <Badge key={p}>{p.replace('.', ' · ')}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-white/50 text-sm">No permissions assigned yet.</p>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
