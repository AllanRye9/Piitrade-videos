import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../api';
import { setProfileDisplayName } from '../profileStore';
import { getMuted, setMuted, subscribeMuted } from '../soundPreference';
import { X, Volume2, VolumeX, Store, Loader2, Check } from 'lucide-react';

interface Props {
  displayName: string | null;
  onClose: () => void;
}

type LinkStatus = 'checking' | 'linked' | 'unlinked' | 'error';

export default function ProfileSettings({ displayName, onClose }: Props) {
  const [nameInput, setNameInput] = useState(displayName || '');
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const muted = useSyncExternalStore(subscribeMuted, getMuted);

  const [linkStatus, setLinkStatus] = useState<LinkStatus>('checking');
  const [unlinking, setUnlinking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .marketplaceAccount()
      .then((res) => !cancelled && setLinkStatus(res.linked ? 'linked' : 'unlinked'))
      .catch(() => !cancelled && setLinkStatus('error'));
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveName() {
    const trimmed = nameInput.trim();
    setSavingName(true);
    setNameError(null);
    setNameSaved(false);
    try {
      const res = await api.updateProfile(trimmed || null);
      setProfileDisplayName(res.displayName);
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 1500);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Could not save name');
    } finally {
      setSavingName(false);
    }
  }

  async function unlinkMarketplace() {
    setUnlinking(true);
    try {
      await api.marketplaceUnlink();
      setLinkStatus('unlinked');
    } catch {
      // Leave status as-is — the account is likely still linked if this failed.
    } finally {
      setUnlinking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center sm:justify-center bg-black/70">
      <div className="safe-bottom safe-left safe-right modal-max-h-90 w-full sm:max-w-md bg-neutral-900 rounded-t-2xl sm:rounded-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-white font-semibold text-sm">Settings</span>
          <button type="button" onClick={onClose} aria-label="Close settings" className="tap-target -mr-2 text-white/60">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Display name */}
          <section className="space-y-2">
            <label className="text-white/50 text-xs font-medium uppercase tracking-wide">Display name</label>
            <div className="flex items-center gap-2">
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Add a name"
                maxLength={40}
                className="flex-1 bg-white/10 text-white text-sm rounded-lg px-3 py-2.5 outline-none placeholder:text-white/40"
              />
              <button
                type="button"
                onClick={saveName}
                disabled={savingName || nameInput.trim() === (displayName || '')}
                className="tap-target shrink-0 h-10 px-4 rounded-lg bg-brand-pink text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-1.5"
              >
                {savingName ? <Loader2 size={14} className="animate-spin" /> : nameSaved ? <Check size={14} /> : null}
                {nameSaved ? 'Saved' : 'Save'}
              </button>
            </div>
            {nameError && <p className="text-red-400 text-xs">{nameError}</p>}
            <p className="text-white/30 text-[11px]">Shown next to your picture in comments and checkout on this device.</p>
          </section>

          {/* Sound */}
          <section className="space-y-2">
            <label className="text-white/50 text-xs font-medium uppercase tracking-wide">Sound</label>
            <button
              type="button"
              onClick={() => setMuted(!muted)}
              className="w-full flex items-center justify-between bg-white/5 rounded-lg px-3.5 py-3"
            >
              <span className="flex items-center gap-2.5 text-white text-sm">
                {muted ? <VolumeX size={18} className="text-white/50" /> : <Volume2 size={18} className="text-brand-cyan" />}
                {muted ? 'Muted' : 'Sound on'}
              </span>
              <span
                className={`relative w-11 h-6 rounded-full transition-colors ${muted ? 'bg-white/20' : 'bg-brand-pink'}`}
                aria-hidden="true"
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    muted ? '' : 'translate-x-5'
                  }`}
                />
              </span>
            </button>
            <p className="text-white/30 text-[11px]">Applies to every video in the feed on this device.</p>
          </section>

          {/* Marketplace account */}
          <section className="space-y-2">
            <label className="text-white/50 text-xs font-medium uppercase tracking-wide">Marketplace account</label>
            <div className="flex items-center justify-between bg-white/5 rounded-lg px-3.5 py-3">
              <span className="flex items-center gap-2.5 text-white text-sm">
                <Store size={18} className={linkStatus === 'linked' ? 'text-brand-cyan' : 'text-white/50'} />
                {linkStatus === 'checking' && 'Checking…'}
                {linkStatus === 'linked' && 'Linked'}
                {linkStatus === 'unlinked' && 'Not linked'}
                {linkStatus === 'error' && 'Could not check'}
              </span>
              {linkStatus === 'linked' && (
                <button
                  type="button"
                  onClick={unlinkMarketplace}
                  disabled={unlinking}
                  className="text-white/50 text-xs underline disabled:opacity-40"
                >
                  {unlinking ? 'Unlinking…' : 'Unlink'}
                </button>
              )}
            </div>
            <p className="text-white/30 text-[11px]">
              {linkStatus === 'unlinked'
                ? "You'll be asked to log in or register the first time you check out from a video."
                : 'Used to check out items you find while watching, without logging in every time.'}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
