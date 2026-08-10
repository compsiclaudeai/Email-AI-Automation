import { describe, expect, it } from 'vitest';
import { checkReplyLoop } from '../modules/automation/loop-guard';

const base = { fromEmail: 'customer@example.com', subject: 'Printer jam', toEmail: 'ops@compsi.com', ownEmail: 'ops@compsi.com' };

describe('checkReplyLoop', () => {
  it('lets an ordinary customer email through', () => {
    expect(checkReplyLoop(base).block).toBe(false);
  });

  it('blocks a reply to our own mailbox', () => {
    const r = checkReplyLoop({ ...base, fromEmail: 'ops@compsi.com' });
    expect(r.block).toBe(true);
    expect(r.code).toBe('self');
  });

  it('sees through a plus-tagged version of our own address', () => {
    const r = checkReplyLoop({ ...base, fromEmail: 'ops+tickets@compsi.com' });
    expect(r.code).toBe('self');
  });

  it.each([
    'no-reply@vendor.com',
    'noreply@vendor.com',
    'do_not_reply@vendor.com',
    'MAILER-DAEMON@vendor.com',
    'postmaster@vendor.com',
  ])('blocks the system address %s', (fromEmail) => {
    expect(checkReplyLoop({ ...base, fromEmail }).block).toBe(true);
  });

  it('blocks a bounce by subject', () => {
    const r = checkReplyLoop({ ...base, subject: 'Undeliverable: Printer jam' });
    expect(r.code).toBe('bounce');
  });

  it('blocks a bounce by null return path', () => {
    const r = checkReplyLoop({ ...base, headers: { 'return-path': '<>' } });
    expect(r.code).toBe('bounce');
  });

  it('blocks an out-of-office autoresponder', () => {
    const r = checkReplyLoop({ ...base, subject: 'Automatic reply: Printer jam' });
    expect(r.code).toBe('auto_reply');
  });

  it('honours the RFC 3834 header', () => {
    const r = checkReplyLoop({ ...base, headers: { 'auto-submitted': 'auto-replied' } });
    expect(r.code).toBe('auto_reply');
  });

  it('does not block on Auto-Submitted: no', () => {
    expect(checkReplyLoop({ ...base, headers: { 'auto-submitted': 'no' } }).block).toBe(false);
  });

  it('blocks mailing list traffic', () => {
    expect(checkReplyLoop({ ...base, headers: { 'list-id': '<news.vendor.com>' } }).code).toBe('list_mail');
    expect(checkReplyLoop({ ...base, headers: { precedence: 'bulk' } }).code).toBe('list_mail');
  });

  it('stops ping-pong once a thread has been answered three times', () => {
    expect(checkReplyLoop({ ...base, repliesAlreadySent: 2 }).block).toBe(false);
    expect(checkReplyLoop({ ...base, repliesAlreadySent: 3 }).code).toBe('thread_cap');
  });

  it('stops answering one sender endlessly in a day', () => {
    expect(checkReplyLoop({ ...base, repliesToSenderRecently: 6 }).code).toBe('sender_cap');
  });

  it('is case-insensitive about addresses', () => {
    expect(checkReplyLoop({ ...base, fromEmail: 'OPS@COMPSI.COM' }).code).toBe('self');
  });
});
