import { describe, expect, it } from 'vitest';
import { gate, withinBusinessHours } from '../modules/automation/automation.service';
import { DEFAULT_SETTINGS, type AutomationSettings } from '../models/user.model';

/** Settings that would let a reply through, so each test changes one thing. */
const open: AutomationSettings = {
  ...DEFAULT_SETTINGS,
  approvalMode: 'automatic',
  businessHoursEnabled: false,
  confidenceThreshold: 90,
};

const good = { confidence: 95, category: 'support', body: 'We will book an engineer visit.' };

describe('gate', () => {
  it('clears a confident, in-category draft', () => {
    expect(gate(open, good).send).toBe(true);
  });

  it('never sends while paused', () => {
    expect(gate({ ...open, paused: true }, good).send).toBe(false);
  });

  it('never sends in manual approval mode', () => {
    expect(gate({ ...open, approvalMode: 'manual' }, good).send).toBe(false);
  });

  it('holds a draft under the confidence threshold', () => {
    expect(gate(open, { ...good, confidence: 89 }).send).toBe(false);
  });

  // The bug this exists for: a model returning `"confidence": "high"` produced
  // NaN, and `NaN < 90` is false, so a completely unscored draft sailed past
  // the threshold check and was sent automatically.
  it.each([NaN, Infinity, -Infinity])('treats %s confidence as zero, not as passing', (c) => {
    const r = gate(open, { ...good, confidence: c as number });
    expect(r.send).toBe(false);
  });

  it('never auto-sends when injection was detected, however confident', () => {
    const r = gate(open, { ...good, confidence: 100, injection: true });
    expect(r.send).toBe(false);
    expect(r.reason).toContain('instructions');
  });

  it('never auto-sends a stub draft', () => {
    expect(gate(open, { ...good, confidence: 100, stub: true }).send).toBe(false);
  });

  it('never auto-sends when validation objected', () => {
    expect(gate(open, { ...good, problems: ['header-like line'] }).send).toBe(false);
  });

  it('holds anything mentioning money when the rail is on', () => {
    expect(gate(open, { ...good, body: 'We will issue a refund of PKR 5,000.' }).send).toBe(false);
  });

  it('holds anything touching personal data when the rail is on', () => {
    expect(gate(open, { ...good, body: 'Please send your CNIC copy.' }).send).toBe(false);
  });

  it('holds a category the account has not enabled', () => {
    expect(gate({ ...open, enabledCategories: ['invoice'] }, good).send).toBe(false);
  });
});

describe('withinBusinessHours', () => {
  const utc = (hhmm: string) => new Date(`2026-08-08T${hhmm}:00Z`);
  const s = (from: string, to: string): AutomationSettings => ({
    ...DEFAULT_SETTINGS,
    timezone: 'UTC',
    businessHoursFrom: from,
    businessHoursTo: to,
  });

  it('accepts a time inside a normal window', () => {
    expect(withinBusinessHours(s('09:00', '18:00'), utc('12:00'))).toBe(true);
  });

  it('rejects a time outside a normal window', () => {
    expect(withinBusinessHours(s('09:00', '18:00'), utc('20:00'))).toBe(false);
  });

  // A night-shift window used to be inverted: `from <= now <= to` is never true
  // when from is 22:00 and to is 06:00, so the automation was silently off all
  // night and on all day — exactly backwards.
  it('handles a window that crosses midnight', () => {
    const overnight = s('22:00', '06:00');
    expect(withinBusinessHours(overnight, utc('23:30'))).toBe(true);
    expect(withinBusinessHours(overnight, utc('03:00'))).toBe(true);
    expect(withinBusinessHours(overnight, utc('12:00'))).toBe(false);
  });

  it('treats an equal from and to as always open', () => {
    expect(withinBusinessHours(s('09:00', '09:00'), utc('03:00'))).toBe(true);
  });

  it('falls back to UTC rather than throwing on an unknown timezone', () => {
    const broken = { ...s('09:00', '18:00'), timezone: 'Not/AZone' };
    expect(() => withinBusinessHours(broken, utc('12:00'))).not.toThrow();
  });

  it('respects the account timezone', () => {
    // 04:00 UTC is 09:00 in Karachi, so a 09:00-18:00 window is open.
    const karachi = { ...s('09:00', '18:00'), timezone: 'Asia/Karachi' };
    expect(withinBusinessHours(karachi, utc('04:00'))).toBe(true);
    expect(withinBusinessHours(karachi, utc('16:00'))).toBe(false);
  });
});
