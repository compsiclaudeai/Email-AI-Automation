import { describe, expect, it } from 'vitest';
import { evaluateRules, matchesCondition, ruleMatches } from '../modules/automation/rules.service';
import type { EvaluationInput } from '../modules/automation/rules.service';

const email: EvaluationInput = {
  fromEmail: 'accounts@vendor.com.pk',
  toEmail: 'ops@compsi.com',
  subject: 'Invoice INV-88213 payment advice',
  body: 'Payment of PKR 45,000 was transferred against invoice INV-88213.',
  category: 'invoice',
  priority: 'medium',
  confidence: 88,
  hasAttachment: true,
  attachmentText: 'INVOICE INV-88213 TOTAL 45,000',
};

const rule = (over: Partial<Parameters<typeof evaluateRules>[1][number]> = {}) => ({
  _id: { toString: () => over.name ?? 'r1' },
  name: 'Rule',
  enabled: true,
  priority: 100,
  match: 'all' as const,
  conditions: [],
  actions: [{ type: 'draft_reply' as const }],
  createdAt: new Date(),
  ...over,
});

describe('matchesCondition', () => {
  it.each([
    ['contains', 'subject', 'invoice', true],
    ['contains', 'subject', 'refund', false],
    ['not_contains', 'subject', 'refund', true],
    ['equals', 'category', 'invoice', true],
    ['not_equals', 'category', 'support', true],
    ['starts_with', 'subject', 'Invoice', true],
    ['ends_with', 'subject', 'advice', true],
  ] as const)('%s %s %s -> %s', (operator, field, value, expected) => {
    expect(matchesCondition(email, { field, operator, value } as never)).toBe(expected);
  });

  it('matches a sender domain and its subdomains', () => {
    const c = { field: 'from', operator: 'matches_domain' } as const;
    expect(matchesCondition(email, { ...c, value: 'vendor.com.pk' })).toBe(true);
    expect(matchesCondition(email, { ...c, value: '@vendor.com.pk' })).toBe(true);
    expect(
      matchesCondition({ ...email, fromEmail: 'a@mail.vendor.com.pk' }, { ...c, value: 'vendor.com.pk' }),
    ).toBe(true);
  });

  // "notvendor.com.pk" ends with "vendor.com.pk" as a string, which a naive
  // endsWith check would treat as the same organisation.
  it('does not treat a lookalike domain as a match', () => {
    expect(
      matchesCondition({ ...email, fromEmail: 'a@notvendor.com.pk' }, {
        field: 'from',
        operator: 'matches_domain',
        value: 'vendor.com.pk',
      }),
    ).toBe(false);
  });

  it('compares numbers for gte and lte', () => {
    expect(matchesCondition(email, { field: 'confidence', operator: 'gte', value: '80' })).toBe(true);
    expect(matchesCondition(email, { field: 'confidence', operator: 'gte', value: '95' })).toBe(false);
    expect(matchesCondition(email, { field: 'confidence', operator: 'lte', value: '95' })).toBe(true);
  });

  // NaN is neither >= nor <=, so an unchecked numeric condition would look like
  // a rule that simply never fires.
  it('fails closed on a non-numeric comparison', () => {
    expect(matchesCondition(email, { field: 'confidence', operator: 'gte', value: 'high' })).toBe(false);
  });

  it('handles boolean fields', () => {
    expect(matchesCondition(email, { field: 'hasAttachment', operator: 'is_true' })).toBe(true);
    expect(matchesCondition(email, { field: 'hasAttachment', operator: 'is_false' })).toBe(false);
  });

  it('reads attachment text', () => {
    expect(
      matchesCondition(email, { field: 'attachmentText', operator: 'contains', value: 'TOTAL' }),
    ).toBe(true);
  });

  it('never matches an empty value', () => {
    expect(matchesCondition(email, { field: 'subject', operator: 'contains', value: '' })).toBe(false);
  });
});

describe('ruleMatches', () => {
  const c = (value: string) => ({ field: 'subject' as const, operator: 'contains' as const, value });

  it('matches everything when there are no conditions', () => {
    expect(ruleMatches(email, { conditions: [], match: 'all' } as never)).toBe(true);
  });

  it('requires every condition with match: all', () => {
    expect(ruleMatches(email, { conditions: [c('invoice'), c('payment')], match: 'all' } as never)).toBe(true);
    expect(ruleMatches(email, { conditions: [c('invoice'), c('refund')], match: 'all' } as never)).toBe(false);
  });

  it('requires one condition with match: any', () => {
    expect(ruleMatches(email, { conditions: [c('refund'), c('invoice')], match: 'any' } as never)).toBe(true);
    expect(ruleMatches(email, { conditions: [c('refund'), c('warranty')], match: 'any' } as never)).toBe(false);
  });
});

describe('evaluateRules', () => {
  it('changes nothing for an account with no rules', () => {
    const d = evaluateRules(email, []);
    expect(d.draft).toBe(true);
    expect(d.sendMode).toBe('none');
    expect(d.matchedRuleIds).toEqual([]);
  });

  it('ignores disabled rules', () => {
    const d = evaluateRules(email, [rule({ enabled: false, actions: [{ type: 'ignore' }] })]);
    expect(d.ignore).toBe(false);
  });

  it('runs rules in priority order and records a trace', () => {
    const d = evaluateRules(email, [
      rule({ name: 'second', priority: 200, actions: [{ type: 'set_priority', value: 'low' }] }),
      rule({ name: 'first', priority: 10, actions: [{ type: 'set_priority', value: 'high' }] }),
    ]);
    // Later rule wins on the same axis, and the trace says who did what.
    expect(d.priority).toBe('low');
    expect(d.trace.join(' ')).toContain('first');
    expect(d.trace.join(' ')).toContain('second');
  });

  // The one direction a rule must never be able to move the system.
  it('never lets a later rule undo an earlier require_approval', () => {
    const d = evaluateRules(email, [
      rule({ name: 'careful', priority: 10, actions: [{ type: 'require_approval' }] }),
      rule({ name: 'eager', priority: 20, actions: [{ type: 'auto_send' }] }),
    ]);
    expect(d.sendMode).toBe('approval');
    expect(d.trace.join(' ')).toContain('approval wins');
  });

  it('allows auto_send when nothing has restricted it', () => {
    const d = evaluateRules(email, [rule({ actions: [{ type: 'auto_send' }] })]);
    expect(d.sendMode).toBe('auto');
  });

  it('stops evaluating after stop_processing', () => {
    const d = evaluateRules(email, [
      rule({ name: 'halt', priority: 10, actions: [{ type: 'stop_processing' }] }),
      rule({ name: 'never', priority: 20, actions: [{ type: 'set_category', value: 'spam' }] }),
    ]);
    expect(d.category).toBeUndefined();
    expect(d.matchedRuleIds).toHaveLength(1);
  });

  it('files an email without replying on ignore', () => {
    const d = evaluateRules(email, [rule({ actions: [{ type: 'ignore' }] })]);
    expect(d.ignore).toBe(true);
    expect(d.draft).toBe(false);
    expect(d.sendMode).toBe('none');
  });

  it('collects drafting instructions from every matched rule', () => {
    const d = evaluateRules(email, [
      rule({ name: 'a', priority: 10, actions: [{ type: 'add_instruction', value: 'Quote the invoice number back.' }] }),
      rule({ name: 'b', priority: 20, actions: [{ type: 'add_instruction', value: 'Never confirm an amount.' }] }),
    ]);
    expect(d.instructions).toHaveLength(2);
  });

  it('only applies rules whose conditions actually match', () => {
    const d = evaluateRules(email, [
      rule({
        name: 'refunds',
        conditions: [{ field: 'subject', operator: 'contains', value: 'refund' }],
        actions: [{ type: 'ignore' }],
      }),
    ]);
    expect(d.ignore).toBe(false);
    expect(d.matchedRuleIds).toEqual([]);
  });
});
