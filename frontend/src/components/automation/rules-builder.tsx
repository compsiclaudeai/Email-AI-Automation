'use client';

import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  FlaskConical,
  GitBranch,
  Loader2,
  Plus,
  Power,
  Trash2,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApp } from '@/components/providers';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useEmails } from '@/lib/hooks';
import type { Rule, RuleAction, RuleCondition, RuleDecision } from '@/lib/types';

const FIELDS: { value: RuleCondition['field']; label: string; kind: 'text' | 'number' | 'bool' }[] = [
  { value: 'from', label: 'Sender', kind: 'text' },
  { value: 'to', label: 'Recipient', kind: 'text' },
  { value: 'subject', label: 'Subject', kind: 'text' },
  { value: 'body', label: 'Body', kind: 'text' },
  { value: 'category', label: 'Category', kind: 'text' },
  { value: 'priority', label: 'Priority', kind: 'text' },
  { value: 'confidence', label: 'AI confidence', kind: 'number' },
  { value: 'hasAttachment', label: 'Has an attachment', kind: 'bool' },
  { value: 'attachmentText', label: 'Attachment text', kind: 'text' },
];

const OPERATORS: Record<string, { value: RuleCondition['operator']; label: string }[]> = {
  text: [
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'equals', label: 'is exactly' },
    { value: 'not_equals', label: 'is not' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'ends_with', label: 'ends with' },
    { value: 'matches_domain', label: 'is from the domain' },
  ],
  number: [
    { value: 'gte', label: 'is at least' },
    { value: 'lte', label: 'is at most' },
  ],
  bool: [
    { value: 'is_true', label: 'is true' },
    { value: 'is_false', label: 'is false' },
  ],
};

const ACTIONS: { value: RuleAction['type']; label: string; needsValue?: string; danger?: boolean }[] = [
  { value: 'draft_reply', label: 'Draft a reply' },
  { value: 'require_approval', label: 'Always wait for my approval' },
  { value: 'auto_send', label: 'Allow sending automatically', danger: true },
  { value: 'set_category', label: 'Set the category to', needsValue: 'support' },
  { value: 'set_priority', label: 'Set the priority to', needsValue: 'high' },
  { value: 'add_instruction', label: 'Tell the AI', needsValue: 'Quote the invoice number back.' },
  { value: 'ignore', label: 'File it without replying' },
  { value: 'stop_processing', label: 'Stop running further rules' },
];

const kindOf = (field: RuleCondition['field']) =>
  FIELDS.find((f) => f.value === field)?.kind ?? 'text';

type RuleDraft = Omit<Rule, '_id' | 'runCount' | 'lastRunAt'>;

const blank = (): RuleDraft => ({
  name: '',
  description: '',
  enabled: true,
  priority: 100,
  match: 'all',
  conditions: [{ field: 'subject', operator: 'contains', value: '' }],
  actions: [{ type: 'draft_reply' }],
});

export function RulesBuilder() {
  const { toast } = useApp();
  const { data: rules, mutate, isLoading } = useSWR<Rule[]>('/automation/rules');
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Rule | null>(null);

  const startNew = () => {
    setEditingId(null);
    setDraft(blank());
  };

  const startEdit = (rule: Rule) => {
    setEditingId(rule._id);
    setDraft({
      name: rule.name,
      description: rule.description ?? '',
      enabled: rule.enabled,
      priority: rule.priority,
      match: rule.match,
      conditions: rule.conditions.length ? rule.conditions : blank().conditions,
      actions: rule.actions.length ? rule.actions : blank().actions,
    });
  };

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      if (editingId) await api.patch(`/automation/rules/${editingId}`, draft);
      else await api.post('/automation/rules', draft);
      await mutate();
      setDraft(null);
      setEditingId(null);
      toast({ title: editingId ? 'Rule updated' : 'Rule created' });
    } catch (e) {
      toast({ title: 'Could not save the rule', detail: (e as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await mutate();
      toast({ title: label });
    } catch (e) {
      toast({ title: 'That did not work', detail: (e as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.02em]">Automation rules</h2>
          <p className="text-[12.5px] text-ink-3 mt-0.5 max-w-[560px] leading-relaxed">
            Rules run in order on every email after the AI has read it. They can narrow what the
            automation does — they can never override the safety rails in Settings.
          </p>
        </div>
        <button className="btn btn-sm btn-primary" onClick={startNew} disabled={busy}>
          <Plus size={14} /> New rule
        </button>
      </header>

      {isLoading ? (
        <div className="skeleton h-28 w-full rounded-2xl" />
      ) : !rules?.length && !draft ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand">
            <GitBranch size={20} />
          </span>
          <p className="text-[14px] font-semibold">No rules yet</p>
          <p className="max-w-[380px] text-[12.5px] leading-relaxed text-ink-3">
            Without rules every email follows the account settings. Add one to treat a sender,
            subject or category differently — for example, always hold anything mentioning a refund.
          </p>
          <button className="btn btn-sm btn-primary" onClick={startNew}>
            <Plus size={14} /> Create the first rule
          </button>
        </div>
      ) : (
        <ol className="flex list-none flex-col gap-2.5 p-0">
          {rules?.map((rule, i) => (
            <li key={rule._id}>
              <RuleRow
                rule={rule}
                index={i}
                busy={busy}
                onEdit={() => startEdit(rule)}
                onToggle={() =>
                  act(rule.enabled ? 'Rule disabled' : 'Rule enabled', () =>
                    api.patch(`/automation/rules/${rule._id}`, { enabled: !rule.enabled }),
                  )
                }
                onDuplicate={() =>
                  act('Rule duplicated — the copy is switched off', () =>
                    api.post(`/automation/rules/${rule._id}/duplicate`),
                  )
                }
                onDelete={() => setDeleting(rule)}
              />
            </li>
          ))}
        </ol>
      )}

      {draft && (
        <RuleEditor
          draft={draft}
          onChange={setDraft}
          onCancel={() => {
            setDraft(null);
            setEditingId(null);
          }}
          onSave={save}
          busy={busy}
          isEdit={Boolean(editingId)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete "${deleting?.name}"?`}
        tone="danger"
        confirmLabel="Delete rule"
        body={
          <p>
            Emails this rule already acted on keep their history. New email will fall back to your
            account settings.
          </p>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const target = deleting;
          setDeleting(null);
          if (target) await act('Rule deleted', () => api.del(`/automation/rules/${target._id}`));
        }}
      />
    </section>
  );
}

/* -------------------------------- one row ------------------------------- */

function RuleRow({
  rule,
  index,
  busy,
  onEdit,
  onToggle,
  onDuplicate,
  onDelete,
}: {
  rule: Rule;
  index: number;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const autoSends = rule.actions.some((a) => a.type === 'auto_send');

  return (
    <article
      className={`card flex flex-wrap items-center gap-3 p-4 transition ${
        rule.enabled ? '' : 'opacity-60'
      }`}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-3 text-[11.5px] font-bold text-ink-3 tabular-nums">
        {index + 1}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13.5px] font-semibold tracking-[-0.01em]">{rule.name}</h3>
          <span className={`chip ${rule.enabled ? 'bg-ok-soft text-ok' : 'bg-surface-3 text-ink-3'}`}>
            {rule.enabled ? 'Enabled' : 'Off'}
          </span>
          {autoSends && (
            <span className="chip bg-warn-soft text-warn" title="This rule permits sending with no human review">
              <Zap size={11} /> Can auto-send
            </span>
          )}
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{describe(rule)}</p>
        <p className="mt-1 text-[11px] text-ink-3">
          Ran {rule.runCount} time{rule.runCount === 1 ? '' : 's'}
          {rule.lastRunAt && ` · last ${new Date(rule.lastRunAt).toLocaleDateString()}`}
        </p>
      </div>

      <div className="flex shrink-0 gap-1.5">
        <IconAction label={rule.enabled ? 'Disable rule' : 'Enable rule'} onClick={onToggle} disabled={busy}>
          <Power size={14} />
        </IconAction>
        <IconAction label="Duplicate rule" onClick={onDuplicate} disabled={busy}>
          <Copy size={14} />
        </IconAction>
        <IconAction label="Delete rule" onClick={onDelete} disabled={busy} danger>
          <Trash2 size={14} />
        </IconAction>
        <button className="btn btn-sm" onClick={onEdit} disabled={busy}>
          Edit
        </button>
      </div>
    </article>
  );
}

/** A one-line, plain-English summary of what the rule does. */
function describe(rule: Rule): string {
  const conditions = rule.conditions.length
    ? rule.conditions
        .map((c) => {
          const field = FIELDS.find((f) => f.value === c.field)?.label ?? c.field;
          const op =
            OPERATORS[kindOf(c.field)]?.find((o) => o.value === c.operator)?.label ?? c.operator;
          return `${field} ${op}${c.value ? ` "${c.value}"` : ''}`;
        })
        .join(rule.match === 'all' ? ' and ' : ' or ')
    : 'every email';

  const actions = rule.actions
    .map((a) => {
      const label = ACTIONS.find((x) => x.value === a.type)?.label ?? a.type;
      return a.value ? `${label} ${a.value}` : label;
    })
    .join(', ');

  return `When ${conditions} → ${actions}`;
}

function IconAction({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-[30px] w-[30px] place-items-center rounded-md border border-line transition
                  disabled:opacity-45 ${
                    danger
                      ? 'text-danger hover:bg-danger-soft hover:border-transparent'
                      : 'text-ink-2 hover:bg-surface-3 hover:text-ink'
                  }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------- the editor ----------------------------- */

function RuleEditor({
  draft,
  onChange,
  onCancel,
  onSave,
  busy,
  isEdit,
}: {
  draft: RuleDraft;
  onChange: (r: RuleDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
  isEdit: boolean;
}) {
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    onChange({ ...draft, [key]: value });

  const autoSends = draft.actions.some((a) => a.type === 'auto_send');
  const valid = draft.name.trim().length >= 2 && draft.actions.length > 0;

  return (
    <div className="card overflow-hidden">
      <header className="card-head">
        <div>
          <h3 className="card-title">{isEdit ? 'Edit rule' : 'New rule'}</h3>
          <p className="card-sub">When something arrives → if it matches → then do this</p>
        </div>
      </header>

      <div className="flex flex-col gap-5 p-6">
        <div className="grid grid-cols-[1fr_120px] gap-3 max-sm:grid-cols-1">
          <div>
            <label htmlFor="rule-name" className="mb-1.5 block text-[12.5px] font-medium">
              Rule name
            </label>
            <input
              id="rule-name"
              className="input w-full"
              value={draft.name}
              placeholder="Hold anything mentioning a refund"
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="rule-priority" className="mb-1.5 block text-[12.5px] font-medium">
              Order
            </label>
            <input
              id="rule-priority"
              type="number"
              min={0}
              max={10000}
              className="input w-full text-center"
              value={draft.priority}
              onChange={(e) => set('priority', Number(e.target.value))}
            />
          </div>
        </div>

        <Stage step="WHEN" title="An email arrives">
          <p className="text-[12.5px] text-ink-3">
            Every incoming email is evaluated after the AI has classified it.
          </p>
        </Stage>

        <Stage step="IF" title="It matches these conditions">
          <div className="mb-2.5 flex items-center gap-2 text-[12.5px]">
            <label htmlFor="rule-match" className="text-ink-2">
              Match
            </label>
            <select
              id="rule-match"
              className="input"
              value={draft.match}
              onChange={(e) => set('match', e.target.value as 'all' | 'any')}
            >
              <option value="all">all of these</option>
              <option value="any">any of these</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            {draft.conditions.map((c, i) => (
              <ConditionRow
                key={i}
                condition={c}
                onChange={(next) =>
                  set(
                    'conditions',
                    draft.conditions.map((x, j) => (j === i ? next : x)),
                  )
                }
                onRemove={() =>
                  set(
                    'conditions',
                    draft.conditions.filter((_, j) => j !== i),
                  )
                }
              />
            ))}
          </div>

          <button
            className="btn btn-sm mt-2.5"
            onClick={() =>
              set('conditions', [
                ...draft.conditions,
                { field: 'subject', operator: 'contains', value: '' },
              ])
            }
          >
            <Plus size={14} /> Add condition
          </button>
          {draft.conditions.length === 0 && (
            <p className="mt-2 flex gap-1.5 text-[11.5px] text-warn">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              With no conditions this rule applies to every email.
            </p>
          )}
        </Stage>

        <Stage step="THEN" title="Do this">
          <div className="flex flex-col gap-2">
            {draft.actions.map((a, i) => (
              <ActionRow
                key={i}
                action={a}
                onChange={(next) =>
                  set(
                    'actions',
                    draft.actions.map((x, j) => (j === i ? next : x)),
                  )
                }
                onRemove={() =>
                  draft.actions.length > 1 &&
                  set(
                    'actions',
                    draft.actions.filter((_, j) => j !== i),
                  )
                }
              />
            ))}
          </div>
          <button
            className="btn btn-sm mt-2.5"
            onClick={() => set('actions', [...draft.actions, { type: 'draft_reply' }])}
          >
            <Plus size={14} /> Add action
          </button>

          {autoSends && (
            <div className="mt-3 flex gap-2.5 rounded-xl border border-warn/40 bg-warn-soft p-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
              <p className="text-[11.5px] leading-relaxed text-ink-2">
                Emails matching this rule may be answered and sent with no human reading them
                first. The account safety rails still apply: money, personal data, prompt injection,
                business hours, the confidence threshold and the daily send limit can all still hold
                a reply back.
              </p>
            </div>
          )}
        </Stage>

        <RuleTester rule={draft} />
      </div>

      <footer className="flex items-center gap-2 border-t border-line px-6 py-4">
        <button className="btn btn-sm btn-primary" onClick={onSave} disabled={busy || !valid}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {isEdit ? 'Save changes' : 'Create rule'}
        </button>
        <button className="btn btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </footer>
    </div>
  );
}

function Stage({
  step,
  title,
  children,
}: {
  step: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface-2 p-4">
      <header className="mb-3 flex items-center gap-2.5">
        <span className="rounded-md bg-ink px-2 py-0.5 text-[10.5px] font-bold tracking-wider text-surface">
          {step}
        </span>
        <h4 className="text-[13px] font-semibold tracking-[-0.01em]">{title}</h4>
      </header>
      {children}
    </section>
  );
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: RuleCondition;
  onChange: (c: RuleCondition) => void;
  onRemove: () => void;
}) {
  const kind = kindOf(condition.field);
  const operators = OPERATORS[kind];
  const needsValue = !['is_true', 'is_false'].includes(condition.operator);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-2 max-sm:grid-cols-1">
      <select
        className="input"
        aria-label="Condition field"
        value={condition.field}
        onChange={(e) => {
          const field = e.target.value as RuleCondition['field'];
          // Switching field can invalidate the operator (a text operator on a
          // number field never matches), so it resets to the first valid one.
          const first = OPERATORS[kindOf(field)][0].value;
          onChange({ field, operator: first, value: '' });
        }}
      >
        {FIELDS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      <select
        className="input"
        aria-label="Condition operator"
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as RuleCondition['operator'] })}
      >
        {operators.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {needsValue ? (
        <input
          className="input"
          aria-label="Condition value"
          type={kind === 'number' ? 'number' : 'text'}
          value={condition.value ?? ''}
          placeholder={kind === 'number' ? '75' : 'refund'}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
        />
      ) : (
        <span className="grid h-[34px] place-items-center text-[12px] text-ink-3">—</span>
      )}

      <IconAction label="Remove condition" onClick={onRemove} danger>
        <Trash2 size={14} />
      </IconAction>
    </div>
  );
}

function ActionRow({
  action,
  onChange,
  onRemove,
}: {
  action: RuleAction;
  onChange: (a: RuleAction) => void;
  onRemove: () => void;
}) {
  const meta = ACTIONS.find((a) => a.value === action.type);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-2 max-sm:grid-cols-1">
      <select
        className="input"
        aria-label="Action"
        value={action.type}
        onChange={(e) => onChange({ type: e.target.value as RuleAction['type'], value: '' })}
      >
        {ACTIONS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>

      {meta?.needsValue ? (
        <input
          className="input"
          aria-label="Action value"
          value={action.value ?? ''}
          placeholder={meta.needsValue}
          onChange={(e) => onChange({ ...action, value: e.target.value })}
        />
      ) : (
        <span className="grid h-[34px] place-items-center text-[12px] text-ink-3">—</span>
      )}

      <IconAction label="Remove action" onClick={onRemove} danger>
        <Trash2 size={14} />
      </IconAction>
    </div>
  );
}

/* ------------------------------- dry run -------------------------------- */

/**
 * Runs the rule against a real email and shows what would happen.
 *
 * The endpoint behind this is side-effect free: nothing is saved, no counter
 * moves and no model is called, so testing can never send anything.
 */
function RuleTester({ rule }: { rule: RuleDraft }) {
  const { data: page } = useEmails({ status: 'all', q: '', limit: 20 });
  const [emailId, setEmailId] = useState('');
  const [result, setResult] = useState<{ decision: RuleDecision } | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useApp();

  useEffect(() => {
    if (!emailId && page?.items.length) setEmailId(page.items[0]._id);
  }, [page, emailId]);

  const run = useCallback(async () => {
    if (!emailId) return;
    setBusy(true);
    try {
      const res = await api.post<{ decision: RuleDecision }>('/automation/rules/test', {
        emailId,
        rule,
      });
      setResult(res);
    } catch (e) {
      toast({ title: 'Test failed', detail: (e as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }, [emailId, rule, toast]);

  return (
    <Stage step="TEST" title="Try it against a real email">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="test-email" className="mb-1.5 block text-[12px] text-ink-2">
            Email to test against
          </label>
          <select
            id="test-email"
            className="input w-full"
            value={emailId}
            onChange={(e) => setEmailId(e.target.value)}
          >
            {(page?.items ?? []).map((e) => (
              <option key={e._id} value={e._id}>
                {e.fromEmail} — {e.subject.slice(0, 50)}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-sm" onClick={run} disabled={busy || !emailId}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
          Test rule
        </button>
      </div>

      {result && (
        <div className="mt-3 rounded-xl border border-line bg-surface p-3.5">
          <p className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold">
            {result.decision.matchedRuleIds.length ? (
              <>
                <Check size={14} className="text-ok" /> This rule matches
              </>
            ) : (
              <>
                <ArrowRight size={14} className="text-ink-3" /> This rule does not match
              </>
            )}
          </p>
          <ul className="list-none space-y-1 p-0">
            {result.decision.trace.map((line, i) => (
              <li key={i} className="text-[11.5px] leading-relaxed text-ink-2">
                · {line}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-ink-3">
            Outcome: {result.decision.ignore
              ? 'filed without a reply'
              : result.decision.sendMode === 'auto'
                ? 'may send automatically, if the account rails allow it'
                : result.decision.sendMode === 'approval'
                  ? 'drafted and held for approval'
                  : 'drafted, then account settings decide'}
          </p>
        </div>
      )}
    </Stage>
  );
}
