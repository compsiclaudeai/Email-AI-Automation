import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * HTTP-level tests for the middleware stack: auth, CORS, rate limiting, error
 * shape and route ordering. Mongoose is stubbed at the model boundary so this
 * runs without a database — the queries themselves are covered separately.
 */
process.env.AI_MOCK = 'true';
process.env.WEB_URL = 'http://localhost:3000';
process.env.JWT_SECRET = 'test_secret_not_the_dev_default_value_here';
process.env.SYNC_ENABLED = 'false';

vi.mock('../models/user.model', async () => {
  const actual = await vi.importActual<typeof import('../models/user.model')>(
    '../models/user.model',
  );
  return {
    ...actual,
    User: {
      findById: () => ({
        select: () => ({ lean: async () => null }),
        then: (r: (v: unknown) => void) => r(null),
      }),
    },
  };
});

let request: typeof import('supertest')['default'];
let app: import('express').Express;
let jwt: typeof import('jsonwebtoken');

beforeAll(async () => {
  request = (await import('supertest')).default;
  jwt = await import('jsonwebtoken');
  const { createApp } = await import('../app');
  app = createApp();
});

const token = () =>
  jwt.sign({ sub: '507f1f77bcf86cd799439011', email: 'a@b.com', provider: 'imap' }, process.env.JWT_SECRET!, {
    expiresIn: '1h',
  });

describe('health', () => {
  it('answers without a session', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('authentication', () => {
  it.each([
    '/api/emails',
    '/api/emails/counts',
    '/api/analytics/kpis',
    '/api/analytics/overview',
    '/api/settings',
    '/api/activity',
    '/api/automation/status',
    '/api/events/stream',
  ])('rejects %s with no session', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  it.each(['/api/automation/run', '/api/automation/sync', '/api/emails/retry-failed'])(
    'rejects POST %s with no session',
    async (path) => {
      const res = await request(app).post(path);
      expect(res.status).toBe(401);
    },
  );

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ sub: 'x', email: 'a@b.com', provider: 'imap' }, 'not-the-secret');
    const res = await request(app).get('/api/emails').set('Cookie', `ea_session=${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign(
      { sub: 'x', email: 'a@b.com', provider: 'imap' },
      process.env.JWT_SECRET!,
      { expiresIn: -10 },
    );
    const res = await request(app).get('/api/emails').set('Cookie', `ea_session=${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/sign in again/i);
  });

  it('rejects a structurally invalid token', async () => {
    const res = await request(app).get('/api/emails').set('Cookie', 'ea_session=not.a.jwt');
    expect(res.status).toBe(401);
  });
});

describe('input validation', () => {
  const auth = () => ({ Cookie: `ea_session=${token()}` });

  it('rejects a non-numeric ?days rather than throwing a 500', async () => {
    const res = await request(app).get('/api/analytics/overview?days=abc').set(auth());
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range ?days', async () => {
    const res = await request(app).get('/api/analytics/overview?days=9999').set(auth());
    expect(res.status).toBe(400);
  });

  it('rejects a non-numeric ?limit on activity', async () => {
    const res = await request(app).get('/api/activity?limit=oops').set(auth());
    expect(res.status).toBe(400);
  });

  it('rejects an unknown status filter', async () => {
    const res = await request(app).get('/api/emails?status=everything').set(auth());
    expect(res.status).toBe(400);
  });

  it('rejects a malformed email id with 400, not 500', async () => {
    const res = await request(app).get('/api/emails/not-an-object-id').set(auth());
    expect(res.status).toBe(400);
  });
});

describe('cross-origin policy', () => {
  it('allows the configured web origin', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('does not hand credentials to an unknown origin', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('errors', () => {
  it('returns a JSON body for an unknown route', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it('does not advertise the server framework', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sets the basic security headers', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('attachment access control', () => {
  const auth = () => ({ Cookie: `ea_session=${token()}` });

  it('refuses an attachment request with no session', async () => {
    const res = await request(app).get('/api/emails/507f1f77bcf86cd799439011/attachments/0');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed email id rather than throwing', async () => {
    const res = await request(app).get('/api/emails/not-an-id/attachments/0').set(auth());
    expect(res.status).toBe(400);
  });

  // The index is validated before it reaches any query, so nothing shaped like
  // a path or a negative offset can be used to reach another record.
  it.each(['-1', '..%2F..%2Fetc', 'abc', '9999'])('rejects the index %s', async (index) => {
    const res = await request(app)
      .get(`/api/emails/507f1f77bcf86cd799439011/attachments/${index}`)
      .set(auth());
    expect([400, 404]).toContain(res.status);
  });
});

describe('automation rules authorization', () => {
  const auth = () => ({ Cookie: `ea_session=${token()}` });

  it.each([
    ['get', '/api/automation/rules'],
    ['post', '/api/automation/rules'],
    ['post', '/api/automation/rules/test'],
  ] as const)('rejects %s %s with no session', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  it('rejects a rule with no actions', async () => {
    const res = await request(app)
      .post('/api/automation/rules')
      .set(auth())
      .send({ name: 'Empty', conditions: [], actions: [] });
    expect(res.status).toBe(400);
  });

  // A condition with no value silently never matches, which looks exactly like
  // a rule that is not running. It is rejected at write time instead.
  it('rejects a condition that could never match', async () => {
    const res = await request(app)
      .post('/api/automation/rules')
      .set(auth())
      .send({
        name: 'Broken',
        conditions: [{ field: 'subject', operator: 'contains', value: '' }],
        actions: [{ type: 'draft_reply' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/needs a value/i);
  });

  it('rejects a numeric condition with a non-numeric value', async () => {
    const res = await request(app)
      .post('/api/automation/rules')
      .set(auth())
      .send({
        name: 'Broken number',
        conditions: [{ field: 'confidence', operator: 'gte', value: 'high' }],
        actions: [{ type: 'draft_reply' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/never match/i);
  });

  it('rejects an unknown action type', async () => {
    const res = await request(app)
      .post('/api/automation/rules')
      .set(auth())
      .send({ name: 'Odd', conditions: [], actions: [{ type: 'delete_everything' }] });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed rule id', async () => {
    const res = await request(app).delete('/api/automation/rules/nope').set(auth());
    expect(res.status).toBe(400);
  });
});
