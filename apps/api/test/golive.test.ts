// Go-live: first-admin and demo guards, invitations and password reset by e-mail, bulk CSV import, readiness check.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const url = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = url;
process.env.MASTER_KEY = randomBytes(32).toString('base64');
process.env.DATA_DIR = mkdtempSync(`${tmpdir()}/baton-`);
process.env.NODE_ENV = 'test';
process.env.APP_URL = 'https://crm.jdj.local';

const outbox = vi.hoisted(() => [] as { to: string[]; subject: string; text: string }[]);
vi.mock('../src/notify', async (orig) => ({ ...(await orig<any>()), sendMail: async (to: string[], subject: string, text: string) => { outbox.push({ to, subject, text }); } }));

describe.skipIf(!url)('go-live (API + DB)', async () => {
  const { sql } = await import('../src/db');
  const { seed } = await import('../src/seed');
  const { buildApp } = await import('../src/app');
  const { heartbeat } = await import('../src/ops');
  let app: Awaited<ReturnType<typeof buildApp>>;
  let admin = '';
  const call = (method: string, u: string, payload?: object, cookie = admin) => app.inject({ method: method as any, url: u, payload, headers: cookie ? { cookie } : {} });
  const login = async (username: string, password: string) => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    return { status: r.statusCode, cookie: String(r.headers['set-cookie']).split(';')[0] };
  };
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const linkIn = (text: string) => /set-password\?token=([\w-]+)/.exec(text)![1];

  beforeAll(async () => {
    await sql.unsafe('drop schema public cascade; create schema public');
    delete process.env.ADMIN_PASSWORD;
  });
  afterAll(async () => {
    await app?.close();
    await sql.end();
  });

  it('a live install cannot create the first administrator without a strong, non-demo password', async () => {
    await expect(seed(false)).rejects.toThrow(/ADMIN_PASSWORD/);
    process.env.ADMIN_PASSWORD = 'ChangeMe!2026';
    await expect(seed(false)).rejects.toThrow(/ADMIN_PASSWORD/);
    process.env.ADMIN_PASSWORD = 'short';
    await expect(seed(false)).rejects.toThrow(/ADMIN_PASSWORD/);
    process.env.ADMIN_PASSWORD = 'Launch-Admin!2026';
    await seed(false);
    await seed(false); // idempotent once the admin exists (upgrades re-run it)
    app = await buildApp();
    const r = await login('admin@crm.local', 'Launch-Admin!2026');
    expect(r.status).toBe(200);
    admin = r.cookie;
    const { totp } = await import('../src/crypto');
    const { secret } = (await call('POST', '/api/auth/mfa/setup')).json(); // administrators must use two-factor
    expect((await call('POST', '/api/auth/mfa/verify', { code: totp(secret) })).statusCode).toBe(200);
  });

  it('demo data is refused once real accounts exist', async () => {
    await sql`insert into users (email, name, role, auth) values ('real.person@jdj.local', 'Real Person', 'cs_agent', 'ad')`;
    await expect(seed(true, false)).rejects.toThrow(/Refusing to load demo data/);
  });

  it('an admin invites a local user by e-mail; the link sets the password once, then expires', async () => {
    const lk = (await call('GET', '/api/lookups')).json();
    const cs = lk.departments.find((d: any) => d.code === 'CS');
    const r = await call('POST', '/api/admin/users', { email: 'nomsa@jdj.local', name: 'Nomsa Dube', role: 'cs_agent', department_id: cs.id, auth: 'local', active: true });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().invited).toBe(true);
    await tick();
    const mail = outbox.find((m) => m.to.includes('nomsa@jdj.local'))!;
    expect(mail.subject).toMatch(/invited to Pelo CRM/);
    expect(mail.text).toContain('https://crm.jdj.local/set-password?token=');
    const t = linkIn(mail.text);
    expect((await call('GET', `/api/auth/token/${t}`, undefined, '')).json()).toEqual({ valid: true, purpose: 'invite', name: 'Nomsa Dube' });
    expect((await login('nomsa@jdj.local', 'anything-at-all')).status).toBe(401); // no password until the link is used
    expect((await call('POST', '/api/auth/set-password', { token: t, password: 'short' }, '')).statusCode).toBe(400);
    expect((await call('POST', '/api/auth/set-password', { token: t, password: 'Nomsa-chooses-2026' }, '')).statusCode).toBe(200);
    expect((await call('POST', '/api/auth/set-password', { token: t, password: 'Second-try-2026!' }, '')).statusCode).toBe(410);
    expect((await call('GET', `/api/auth/token/${t}`, undefined, '')).json().valid).toBe(false);
    expect((await login('nomsa@jdj.local', 'Nomsa-chooses-2026')).status).toBe(200);
    const [{ n }] = await sql`select count(*)::int as n from audit_log where action in ('auth.invite_sent', 'auth.invite_accepted')`;
    expect(n).toBe(2);
  });

  it('forgot password: same answer for any address; a reset link works once and ends other sessions', async () => {
    const before = outbox.length;
    const s = await login('nomsa@jdj.local', 'Nomsa-chooses-2026');
    for (const email of ['nomsa@jdj.local', 'nobody@jdj.local', 'real.person@jdj.local']) {
      const r = await call('POST', '/api/auth/forgot', { email }, '');
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ ok: true });
    }
    await tick();
    const sent = outbox.slice(before);
    expect(sent.map((m) => m.to[0])).toEqual(['nomsa@jdj.local']); // unknown and AD addresses get nothing
    const t = linkIn(sent[0].text);
    await sql`update user_tokens set expires_at = now() - interval '1 second' where purpose = 'reset'`;
    expect((await call('POST', '/api/auth/set-password', { token: t, password: 'Nomsa-new-2026!' }, '')).statusCode).toBe(410); // expired
    await call('POST', '/api/auth/forgot', { email: 'nomsa@jdj.local' }, '');
    await tick();
    const t2 = linkIn(outbox[outbox.length - 1].text);
    expect((await call('POST', '/api/auth/set-password', { token: t2, password: 'Nomsa-new-2026!' }, '')).statusCode).toBe(200);
    expect((await call('GET', '/api/me', undefined, s.cookie)).statusCode).toBe(401);
    expect((await login('nomsa@jdj.local', 'Nomsa-new-2026!')).status).toBe(200);
    for (let i = 0; i < 3; i++) await call('POST', '/api/auth/forgot', { email: 'x@y.z' }, '');
    expect((await call('POST', '/api/auth/forgot', { email: 'x@y.z' }, '')).statusCode).toBe(429);
  });

  it('bulk import: every row is checked first, nothing is written unless all are valid, then upserts', async () => {
    const bad = 'kind,name,lat,lng,radius_m,site_code,nurse_email\nhospital,St Mary,-29.85,31.02,400,MAIN,\nhospital,No GPS,,,,,\npractice,"Dr Patel, Inc",,,,NOPE,\n';
    let r = (await call('POST', '/api/admin/import/organisations', { csv: bad, apply: true })).json();
    expect(r.applied).toBe(false);
    expect(r.errors).toEqual([{ line: 3, message: 'a hospital needs lat and lng for its geofence' }, { line: 4, message: 'unknown site_code "NOPE"' }]);
    expect((await sql`select count(*)::int as n from organisations`)[0].n).toBe(0);

    const good = '﻿kind,name,address,lat,lng,radius_m,site_code\r\nhospital,St Mary,"1 Main Rd, Durban",-29.85,31.02,400,MAIN\r\npractice,"Dr Patel, Inc",,,,,\r\n';
    r = (await call('POST', '/api/admin/import/organisations', { csv: good })).json();
    expect(r).toMatchObject({ applied: false, rows: 2, created: 2, updated: 0, errors: [] }); // a check writes nothing
    r = (await call('POST', '/api/admin/import/organisations', { csv: good, apply: true })).json();
    expect(r).toMatchObject({ applied: true, created: 2 });
    const [h] = await sql`select address, radius_m, lat from organisations where name = 'St Mary'`;
    expect(h).toMatchObject({ address: '1 Main Rd, Durban', radius_m: 400, lat: -29.85 });
    r = (await call('POST', '/api/admin/import/organisations', { csv: 'kind,name,radius_m\nhospital,St Mary,600\n'.replace('radius_m\n', 'lat,lng,radius_m\n').replace('St Mary,600', 'St Mary,-29.85,31.02,600'), apply: true })).json();
    expect(r).toMatchObject({ applied: true, created: 0, updated: 1 });

    const users = 'email,name,role,department_code,auth\nsister.a@jdj.local,Sister A,dept_responder,NUR,ad\nclerk@jdj.local,Clerk B,cs_agent,CS,local\nboss@jdj.local,Boss,management,CS,ad\n';
    r = (await call('POST', '/api/admin/import/users', { csv: users, apply: true })).json();
    expect(r.errors).toEqual([{ line: 4, message: 'admin and management have no department' }]);
    r = (await call('POST', '/api/admin/import/users', { csv: users.replace('management,CS', 'management,'), apply: true })).json();
    expect(r).toMatchObject({ applied: true, created: 3, invited: 1 });
    await tick();
    expect(outbox.some((m) => m.to.includes('clerk@jdj.local') && /invited/.test(m.subject))).toBe(true);
    expect((await call('GET', '/api/admin/import/users/template.csv')).body).toBe('email,name,role,department_code,site_code,auth,active\n');
    const agent = await login('nomsa@jdj.local', 'Nomsa-new-2026!');
    const { totp } = await import('../src/crypto');
    const { secret } = (await call('POST', '/api/auth/mfa/setup', undefined, agent.cookie)).json();
    await call('POST', '/api/auth/mfa/verify', { code: totp(secret) }, agent.cookie);
    expect((await call('POST', '/api/admin/import/users', { csv: users }, agent.cookie)).statusCode).toBe(403); // admins only
  });

  it('readiness check for external monitoring: 503 until the worker reports, then 200; flags only', async () => {
    let r = await call('GET', '/api/health/ready', undefined, '');
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ ok: false, database: true, worker: false });
    await heartbeat({ escalated: 0 });
    r = await call('GET', '/api/health/ready', undefined, '');
    expect(r.statusCode).toBe(200);
    expect(Object.keys(r.json()).sort()).toEqual(['database', 'disk', 'ok', 'version', 'worker']);
  });
});
