import { describe, expect, it } from 'vitest';
import { contentDisposition, safeFilename } from '../modules/emails/attachments.service';
import { replySubject } from '../modules/ai/safety';
import { decodeMimeWords } from '../providers/gmail.provider';

describe('safeFilename', () => {
  it('keeps an ordinary filename intact', () => {
    expect(safeFilename('invoice-88213.pdf')).toBe('invoice-88213.pdf');
  });

  it('neutralises path traversal', () => {
    // Leading dots are stripped, then every separator becomes an underscore, so
    // nothing survives that a filesystem could read as a directory hop.
    for (const input of ['../../../etc/passwd', '..\\..\\windows\\system32', '/etc/shadow']) {
      const out = safeFilename(input);
      expect(out).not.toMatch(/[\\/]/);
      expect(out.startsWith('.')).toBe(false);
    }
  });

  it('strips CR and LF so a filename cannot inject a response header', () => {
    const out = safeFilename('report.pdf\r\nSet-Cookie: admin=1');
    expect(out).not.toMatch(/[\r\n]/);
    expect(out).toContain('report.pdf');
  });

  it('strips quotes that would break out of the header value', () => {
    expect(safeFilename('a"b.png')).toBe('ab.png');
  });

  it('never returns an empty name', () => {
    expect(safeFilename('')).toBe('attachment');
    expect(safeFilename('...')).toBe('attachment');
  });

  it('caps absurdly long names', () => {
    expect(safeFilename(`${'a'.repeat(500)}.pdf`).length).toBeLessThanOrEqual(200);
  });
});

describe('contentDisposition', () => {
  it('marks a download as an attachment and a preview as inline', () => {
    expect(contentDisposition('a.pdf', true)).toMatch(/^attachment;/);
    expect(contentDisposition('a.pdf', false)).toMatch(/^inline;/);
  });

  it('carries a non-ASCII name through RFC 5987 as well as an ASCII fallback', () => {
    const header = contentDisposition('فاتورة.pdf', true);
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toMatch(/filename="[\x20-\x7E]+"/);
  });
});

describe('replySubject', () => {
  it('adds Re: to a normal subject', () => {
    expect(replySubject('LaserJet jam')).toBe('Re: LaserJet jam');
  });

  it('does not stack Re: on an existing reply', () => {
    expect(replySubject('Re: LaserJet jam')).toBe('Re: LaserJet jam');
    expect(replySubject('RE: LaserJet jam')).toBe('RE: LaserJet jam');
  });

  // The customer-visible symptom: replies titled "Re: (no subject)", because a
  // display placeholder was being written into the outgoing header.
  it.each(['(no subject)', 'Re: (no subject)', '', '   '])(
    'never puts the placeholder %s on the wire',
    (subject) => {
      expect(replySubject(subject)).toBe('Re:');
    },
  );

  it('removes CR and LF so a subject cannot inject a header', () => {
    expect(replySubject('Hi\r\nBcc: x@y.com')).not.toMatch(/[\r\n]/);
  });
});

describe('decodeMimeWords', () => {
  it('leaves plain ASCII alone', () => {
    expect(decodeMimeWords('Printer jam')).toBe('Printer jam');
  });

  it('decodes base64 encoded-words', () => {
    const encoded = `=?UTF-8?B?${Buffer.from('Rechnung fällig', 'utf8').toString('base64')}?=`;
    expect(decodeMimeWords(encoded)).toBe('Rechnung fällig');
  });

  it('decodes quoted-printable encoded-words', () => {
    expect(decodeMimeWords('=?UTF-8?Q?Facture_pay=C3=A9e?=')).toBe('Facture payée');
  });

  it('decodes an encoded display name inside a From header', () => {
    const encoded = `=?UTF-8?B?${Buffer.from('Ayesha Malik', 'utf8').toString('base64')}?= <a@b.com>`;
    expect(decodeMimeWords(encoded)).toBe('Ayesha Malik <a@b.com>');
  });

  it('returns the original when the encoding is unintelligible', () => {
    expect(decodeMimeWords('=?NOPE?X?zzz?=')).toContain('=?NOPE?X?zzz?=');
  });
});

describe('isPlaceholderSubject', () => {
  it('treats a real subject as real', async () => {
    const { isPlaceholderSubject } = await import('../modules/ai/safety');
    expect(isPlaceholderSubject('LaserJet keeps jamming')).toBe(false);
    expect(isPlaceholderSubject('Re: LaserJet keeps jamming')).toBe(false);
  });

  // The one that got through the first fix: once we had replied to a
  // subjectless email, the customer's reply came back as "Re: (no subject)",
  // which is not the bare placeholder string.
  it.each([
    '(no subject)',
    'Re: (no subject)',
    'RE: (No Subject)',
    'Fwd: (no subject)',
    'Re: Fwd: Re: (no subject)',
    'Re:',
    'Fwd:',
    '',
    '   ',
  ])('recognises the placeholder in %s', async (subject) => {
    const { isPlaceholderSubject } = await import('../modules/ai/safety');
    expect(isPlaceholderSubject(subject)).toBe(true);
  });

  it('handles the numbered prefix some clients add', async () => {
    const { isPlaceholderSubject } = await import('../modules/ai/safety');
    expect(isPlaceholderSubject('Re[2]: (no subject)')).toBe(true);
  });
});

describe('the offline stub never quotes the placeholder back', () => {
  it('drops the subject sentence entirely when there is no real subject', async () => {
    process.env.AI_MOCK = 'true';
    const { draftReply } = await import('../modules/ai/ai.service');
    const { DEFAULT_SETTINGS } = await import('../models/user.model');

    const draft = await draftReply({
      fromName: 'Hassan Siraj',
      fromEmail: 'hassan.siraj@client.com',
      subject: 'Re: (no subject)',
      body: 'Following up on the printer we discussed.',
      ownEmail: 'ops@compsi.com',
      settings: DEFAULT_SETTINGS,
    });

    expect(draft.reply).not.toContain('(no subject)');
    expect(draft.reply).toContain('Thank you for your email.');
    expect(draft.reply).toContain('Hello Hassan,');
  });
});
