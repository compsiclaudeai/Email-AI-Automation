'use client';

import { useEffect, useState } from 'react';
import { Check, FileText, FolderInput, LogOut, RotateCw } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RulesBuilder } from '@/components/automation/rules-builder';
import { api } from '@/lib/api';
import { useApp } from '@/components/providers';
import { useMe, useSettings, useTemplates } from '@/lib/hooks';
import { Avatar } from '@/components/ui/avatar';
import { CATEGORY_COLOURS } from '@/lib/format';
import type { ApprovalMode, Settings, Tone } from '@/lib/types';

const TONES: Tone[] = ['Professional', 'Friendly', 'Formal', 'Casual'];
const CATEGORIES = ['invoice', 'support', 'hr', 'sales', 'marketing', 'spam', 'other'];

export default function SettingsPage() {
  const { toast } = useApp();
  const { data: me, mutate: reloadMe } = useMe();
  const { data: saved, mutate } = useSettings();
  const { data: templates } = useTemplates();

  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [folder, setFolder] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [folderBusy, setFolderBusy] = useState(false);

  useEffect(() => {
    if (me?.mailFolder !== undefined) setFolder(me.mailFolder ?? '');
  }, [me?.mailFolder]);

  useEffect(() => {
    if (saved) setForm(saved);
  }, [saved]);

  if (!form) return <div className="skeleton h-96 w-full rounded-2xl" />;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  async function save() {
    setSaving(true);
    try {
      const next = await api.patch<Settings>('/settings', form);
      await mutate(next, false);
      toast({ title: 'Settings saved', detail: 'New rules apply from the next run.' });
    } catch (e) {
      toast({ title: 'Could not save', detail: (e as Error).message, kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function sync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await api.post('/automation/sync');
      await reloadMe();
      toast({ title: 'Mailbox synced' });
    } catch (e) {
      // The old version swallowed this entirely: a sync that failed looked
      // exactly like one that worked.
      toast({ title: 'Sync failed', detail: (e as Error).message, kind: 'error' });
    } finally {
      setSyncing(false);
    }
  }

  async function loadFolders() {
    setFolderBusy(true);
    try {
      const res = await api.get<{ folders: string[]; current: string }>('/auth/folders');
      setFolders(res.folders);
      if (!res.folders.length) {
        toast({
          title: 'No folders to choose from',
          detail: 'Gmail organises by label, so the sync reads the inbox directly.',
          kind: 'info',
        });
      }
    } catch (e) {
      toast({ title: 'Could not list folders', detail: (e as Error).message, kind: 'error' });
    } finally {
      setFolderBusy(false);
    }
  }

  async function saveFolder() {
    setFolderBusy(true);
    try {
      await api.patch('/settings/mailbox', { mailFolder: folder });
      await reloadMe();
      toast({ title: 'Source folder saved', detail: 'The next sync reads from there.' });
    } catch (e) {
      toast({ title: 'Could not save the folder', detail: (e as Error).message, kind: 'error' });
    } finally {
      setFolderBusy(false);
    }
  }

  async function disconnect() {
    try {
      await api.post('/auth/disconnect');
      toast({ title: 'Account disconnected', detail: 'Reconnect any time — nothing was deleted.', kind: 'warn' });
    } finally {
      // Full load for the same reason as sign out: a client-side push reuses
      // the cached session and ping-pongs between the two pages.
      window.location.href = '/';
    }
  }

  return (
    <>
      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect this mailbox?"
        tone="danger"
        confirmLabel="Disconnect"
        body={
          <>
            <p>
              Stored credentials are deleted and the automation stops. Emails already synced stay
              in the dashboard.
            </p>
            <p className="mt-2">You will be signed out and can reconnect at any time.</p>
          </>
        }
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={disconnect}
      />
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.025em]">Settings</h1>
          <p className="text-[13px] text-ink-3 mt-0.5">Rules apply to the mailbox connected to this account</p>
        </div>
        <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
          <Check size={14} /> {saving ? 'Saving…' : 'Save changes'}
        </button>
      </header>

      <div className="card p-6">
        <RulesBuilder />
      </div>

      <div className="grid grid-cols-2 gap-4 items-start max-lg:grid-cols-1">
        <div className="flex flex-col gap-4">
          <section className="card">
            <header className="card-head">
              <div>
                <h2 className="card-title">Connected account</h2>
                <p className="card-sub">Signed in with OAuth — no password stored</p>
              </div>
              <span className="chip bg-ok-soft text-ok">
                <span className="w-1.5 h-1.5 rounded-full bg-current" /> Online
              </span>
            </header>
            <div className="flex items-center gap-3.5 p-6 flex-wrap">
              <Avatar name={me?.name ?? '?'} size={44} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold tracking-[-0.015em]">{me?.name}</p>
                <p className="text-[12.5px] text-ink-3 mt-0.5 truncate">{me?.email}</p>
                <div className="flex gap-2 mt-2 flex-wrap">
                  <span className="chip">{me?.providerLabel}</span>
                  <span className="chip">
                    Last sync:&nbsp;
                    <b>{me?.lastSyncAt ? new Date(me.lastSyncAt).toLocaleString() : 'never'}</b>
                  </span>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button className="btn btn-sm" onClick={sync} disabled={syncing}>
                  <RotateCw size={14} className={syncing ? 'animate-spin' : ''} /> Sync now
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => setConfirmDisconnect(true)}>
                  <LogOut size={14} /> Disconnect
                </button>
              </div>
            </div>
          </section>

          <section className="card">
            <header className="card-head">
              <div>
                <h2 className="card-title">Source folder</h2>
                <p className="card-sub">
                  A mail rule can route client email into its own folder — point the sync at it
                </p>
              </div>
            </header>
            <div className="flex flex-wrap items-end gap-2.5 p-6">
              <div className="flex-1 min-w-[200px]">
                <label htmlFor="mail-folder" className="block text-[12.5px] font-medium mb-1.5">
                  Folder to watch
                </label>
                {folders.length ? (
                  <select
                    id="mail-folder"
                    className="input w-full"
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                  >
                    <option value="">Inbox (default)</option>
                    {folders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="mail-folder"
                    className="input w-full"
                    value={folder}
                    placeholder="Inbox"
                    onChange={(e) => setFolder(e.target.value)}
                  />
                )}
              </div>
              <button className="btn btn-sm" onClick={loadFolders} disabled={folderBusy}>
                <FolderInput size={14} /> List folders
              </button>
              <button className="btn btn-sm btn-primary" onClick={saveFolder} disabled={folderBusy}>
                <Check size={14} /> Save folder
              </button>
            </div>
          </section>

          <section className="card">
            <header className="card-head">
              <h2 className="card-title">Replies</h2>
            </header>

            <Row title="Auto reply" detail="Let the automation answer mail that clears your confidence threshold.">
              <Switch on={form.autoReply} onChange={(v) => set('autoReply', v)} label="Auto reply" />
            </Row>

            <Row title="Approval mode" detail="Manual approval holds every draft until you press send.">
              <Segment
                options={[
                  { value: 'automatic', label: 'Automatic' },
                  { value: 'manual', label: 'Manual approval' },
                ]}
                value={form.approvalMode}
                onChange={(v) => set('approvalMode', v as ApprovalMode)}
              />
            </Row>

            <Row title="Confidence threshold" detail="Drafts below this score always wait for a human.">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.confidenceThreshold}
                  onChange={(e) => set('confidenceThreshold', Number(e.target.value))}
                  className="input w-[70px] text-center"
                  aria-label="Confidence threshold"
                />
                <span className="text-ink-3">%</span>
              </div>
            </Row>

            <Row
              title="Daily send limit"
              detail="A hard ceiling on replies sent in any rolling 24 hours. 0 blocks all sending."
            >
              <input
                type="number"
                min={0}
                max={5000}
                value={form.dailySendCap ?? 100}
                onChange={(e) => set('dailySendCap', Number(e.target.value))}
                className="input w-[90px] text-center"
                aria-label="Daily send limit"
              />
            </Row>

            <Row title="Business hours" detail="Outside these hours drafts queue instead of sending.">
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={form.businessHoursFrom}
                  onChange={(e) => set('businessHoursFrom', e.target.value)}
                  className="input w-[110px]"
                  aria-label="Business hours from"
                />
                <span className="text-ink-3">to</span>
                <input
                  type="time"
                  value={form.businessHoursTo}
                  onChange={(e) => set('businessHoursTo', e.target.value)}
                  className="input w-[110px]"
                  aria-label="Business hours to"
                />
                <Switch on={form.businessHoursEnabled} onChange={(v) => set('businessHoursEnabled', v)} label="Business hours" />
              </div>
            </Row>

            <Row title="AI tone" detail={`Applied to every generated reply. Currently ${form.tone.toLowerCase()}.`}>
              <Segment
                options={TONES.map((t) => ({ value: t, label: t }))}
                value={form.tone}
                onChange={(v) => set('tone', v as Tone)}
              />
            </Row>
          </section>

          <section className="card">
            <header className="card-head">
              <div>
                <h2 className="card-title">Signature</h2>
                <p className="card-sub">Appended to every automated reply</p>
              </div>
            </header>
            <div className="p-6">
              <textarea
                rows={4}
                value={form.signature}
                onChange={(e) => set('signature', e.target.value)}
                className="input w-full h-auto py-3 leading-relaxed resize-y"
                aria-label="Email signature"
              />
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="card">
            <header className="card-head">
              <div>
                <h2 className="card-title">Categories</h2>
                <p className="card-sub">Turn a category off and the automation leaves it alone</p>
              </div>
            </header>
            <div className="flex flex-wrap gap-2 p-6">
              {CATEGORIES.map((c) => {
                const on = form.enabledCategories.includes(c);
                return (
                  <button
                    key={c}
                    onClick={() =>
                      set(
                        'enabledCategories',
                        on ? form.enabledCategories.filter((x) => x !== c) : [...form.enabledCategories, c],
                      )
                    }
                    className={`inline-flex items-center gap-2 px-3 py-[7px] rounded-full border border-line
                                text-[12.5px] font-medium capitalize transition hover:bg-surface-2
                                ${on ? '' : 'opacity-40'}`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: CATEGORY_COLOURS[c] }} />
                    {c}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card">
            <header className="card-head">
              <div>
                <h2 className="card-title">Email templates</h2>
                <p className="card-sub">The AI starts from these before adapting to the message</p>
              </div>
            </header>
            {(templates ?? []).length === 0 && (
              <p className="px-6 py-5 text-[12.5px] text-ink-3">
                No templates yet. Seed the database or add one through the API to give the model a house style.
              </p>
            )}
            {(templates ?? []).map((t) => (
              <div key={t._id} className="flex items-center gap-3 px-6 py-3.5 border-b border-line last:border-b-0 transition hover:bg-surface-2">
                <span className="grid place-items-center w-7 h-7 rounded-lg bg-surface-3 text-ink-2 shrink-0">
                  <FileText size={14} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-medium">{t.name}</p>
                  <p className="text-[12.5px] text-ink-3 mt-0.5 capitalize">
                    {t.category} · {t.usageCount} uses
                  </p>
                </div>
              </div>
            ))}
          </section>

          <section className="card">
            <header className="card-head">
              <div>
                <h2 className="card-title">Safety rails</h2>
                <p className="card-sub">Hard stops the automation will never cross</p>
              </div>
            </header>
            <Row title="Never auto-send when money is mentioned" detail="Quotes, refunds and credit notes always wait for a person.">
              <Switch on={form.neverAutoSendMoney} onChange={(v) => set('neverAutoSendMoney', v)} label="Money rail" />
            </Row>
            <Row title="Never auto-send personal data" detail="Employment records, ID documents and salary details.">
              <Switch on={form.neverAutoSendPersonalData} onChange={(v) => set('neverAutoSendPersonalData', v)} label="Personal data rail" />
            </Row>
            <Row title="Pause automation" detail="Stops every outgoing reply while leaving drafting on.">
              <Switch on={form.paused} onChange={(v) => set('paused', v)} label="Paused" />
            </Row>
          </section>
        </div>
      </div>
    </>
  );
}

function Row({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-6 py-4 border-b border-line last:border-b-0 max-sm:flex-wrap">
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-medium tracking-[-0.008em]">{title}</p>
        <p className="text-[12.5px] text-ink-3 mt-0.5 leading-relaxed">{detail}</p>
      </div>
      <div className="ml-auto shrink-0">{children}</div>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative w-10 h-[23px] rounded-full transition shrink-0 ${on ? 'bg-brand' : 'bg-line-strong'}`}
    >
      <span
        className={`absolute top-[2.5px] left-[2.5px] w-[18px] h-[18px] rounded-full bg-white
                    shadow-[0_1px_3px_rgba(0,0,0,.28)] transition-transform ${on ? 'translate-x-[17px]' : ''}`}
      />
    </button>
  );
}

function Segment({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex p-0.5 bg-surface-3 rounded-[9px] gap-0.5 flex-wrap">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 rounded-md text-[12.5px] transition
                      ${value === o.value ? 'bg-surface font-semibold shadow-e1' : 'text-ink-2 font-medium'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
