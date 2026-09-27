// Bulk CSV import for go-live: practices & hospitals (with geofence) and users (AD, or local with an e-mailed invitation).
// Every row is validated first; nothing is written unless every row is valid (all or nothing).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLES } from '@baton/core';
import { audit, fail, sql, type Sql } from '../db';
import { sendLink } from '../invites';

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else f += c;
  }
  row.push(f);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export const TEMPLATES = {
  organisations: ['kind', 'name', 'address', 'phone', 'email', 'lat', 'lng', 'radius_m', 'site_code', 'nurse_email', 'active'],
  users: ['email', 'name', 'role', 'department_code', 'site_code', 'auth', 'active'],
} as const;
const REQUIRED = { organisations: ['kind', 'name'], users: ['email', 'name', 'role'] } as const;
type Kind = keyof typeof TEMPLATES;

const bool = (v: string) => (v === '' ? true : /^(1|y|yes|true|active)$/i.test(v) ? true : /^(0|n|no|false|inactive)$/i.test(v) ? false : null);
const num = (v: string) => (v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);

type Row = Record<string, string>;
type Planned = { line: number; key: string; data: Record<string, unknown>; existing: any };

async function plan(db: Sql, kind: Kind, rows: Row[]) {
  const errors: { line: number; message: string }[] = [];
  const out: Planned[] = [];
  const sites = new Map((await db`select id, code from sites`).map((s) => [s.code.toLowerCase(), s.id]));
  const seen = new Set<string>();
  if (kind === 'organisations') {
    const nurses = new Map((await db`select u.id, lower(u.email) as email from users u join departments d on d.id = u.department_id where d.code = 'NUR' and u.active`).map((n) => [n.email, n.id]));
    const existing = new Map((await db`select id, kind, lower(name) as k from organisations`).map((o) => [`${o.kind}|${o.k}`, o]));
    rows.forEach((r, i) => {
      const line = i + 2, err = (m: string) => errors.push({ line, message: m });
      const kindV = r.kind.toLowerCase();
      if (!['practice', 'hospital'].includes(kindV)) return err('kind must be "practice" or "hospital"');
      if (!r.name) return err('name is required');
      const lat = num(r.lat), lng = num(r.lng), radius = num(r.radius_m);
      if (Number.isNaN(lat) || Number.isNaN(lng) || (lat != null && Math.abs(lat) > 90) || (lng != null && Math.abs(lng) > 180)) return err('lat / lng must be decimal degrees');
      if (kindV === 'hospital' && (lat == null || lng == null)) return err('a hospital needs lat and lng for its geofence');
      if (Number.isNaN(radius) || (radius != null && (radius < 50 || radius > 5000))) return err('radius_m must be 50–5000');
      const site = r.site_code ? sites.get(r.site_code.toLowerCase()) : null;
      if (r.site_code && !site) return err(`unknown site_code "${r.site_code}"`);
      const nurse = r.nurse_email ? nurses.get(r.nurse_email.toLowerCase()) : null;
      if (r.nurse_email && kindV !== 'hospital') return err('nurse_email applies to hospitals only');
      if (r.nurse_email && !nurse) return err(`no active nursing user "${r.nurse_email}"`);
      const active = bool(r.active);
      if (active == null) return err('active must be yes or no');
      const key = `${kindV}|${r.name.toLowerCase()}`;
      if (seen.has(key)) return err('duplicate row in this file');
      seen.add(key);
      out.push({ line, key, existing: existing.get(key), data: {
        kind: kindV, name: r.name, address: r.address || null, phone: r.phone || null, email: r.email || null,
        lat, lng, radius_m: radius ?? 250, site_id: site ?? null, nurse_id: nurse ?? null, active,
      } });
    });
  } else {
    const depts = new Map((await db`select id, code from departments`).map((d) => [d.code.toLowerCase(), d.id]));
    const existing = new Map((await db`select id, lower(email) as email, auth from users`).map((u) => [u.email, u]));
    rows.forEach((r, i) => {
      const line = i + 2, err = (m: string) => errors.push({ line, message: m });
      const email = r.email.toLowerCase();
      if (!z.email().safeParse(email).success) return err('email is not valid');
      if (!r.name) return err('name is required');
      if (!(r.role in ROLES)) return err(`role must be one of ${Object.keys(ROLES).join(', ')}`);
      const dept = r.department_code ? depts.get(r.department_code.toLowerCase()) : null;
      if (r.department_code && !dept) return err(`unknown department_code "${r.department_code}"`);
      if (['dept_responder', 'dept_manager'].includes(r.role) && !dept) return err('department roles need a department_code');
      if (['admin', 'management'].includes(r.role) && dept) return err('admin and management have no department');
      const site = r.site_code ? sites.get(r.site_code.toLowerCase()) : null;
      if (r.site_code && !site) return err(`unknown site_code "${r.site_code}"`);
      const active = bool(r.active);
      if (active == null) return err('active must be yes or no');
      const auth = (r.auth || 'ad').toLowerCase();
      if (!['ad', 'local'].includes(auth)) return err('auth must be "ad" or "local"');
      const ex = existing.get(email);
      if (ex && ex.auth !== auth) return err(`exists with ${ex.auth === 'ad' ? 'AD' : 'a local'} sign-in; change it in Users`);
      if (seen.has(email)) return err('duplicate row in this file');
      seen.add(email);
      out.push({ line, key: email, existing: ex, data: { email, name: r.name, role: r.role, department_id: dept ?? null, site_id: site ?? null, auth, active } });
    });
  }
  return { errors, out };
}

export function importRoutes(app: FastifyInstance) {
  // Under /api/admin: the admin preHandler (admin.configure) applies.
  app.get('/api/admin/import/:kind/template.csv', async (req, reply) => {
    const { kind } = z.object({ kind: z.enum(['organisations', 'users']) }).parse(req.params);
    reply.header('content-type', 'text/csv').header('content-disposition', `attachment; filename="${kind}-template.csv"`);
    return TEMPLATES[kind].join(',') + '\n';
  });

  app.post('/api/admin/import/:kind', async (req) => {
    const { kind } = z.object({ kind: z.enum(['organisations', 'users']) }).parse(req.params);
    const { csv, apply } = z.object({ csv: z.string().min(1).max(900_000), apply: z.boolean().default(false) }).parse(req.body);
    const [head, ...body] = parseCsv(csv.replace(/^﻿/, ''));
    const cols = head.map((h) => h.trim().toLowerCase());
    const missing = REQUIRED[kind].filter((c) => !cols.includes(c));
    if (missing.length) fail(400, `Missing column(s): ${missing.join(', ')}. Download the template for the expected header.`);
    if (body.length > 5000) fail(400, 'At most 5,000 rows per file');
    const rows: Row[] = body.map((r) => Object.fromEntries(TEMPLATES[kind].map((c) => [c, (r[cols.indexOf(c)] ?? '').trim()])));
    return sql.begin(async (tx) => {
      const { errors, out } = await plan(tx, kind, rows);
      const created = out.filter((p) => !p.existing).length, updated = out.length - created;
      if (errors.length || !apply) return { applied: false, rows: rows.length, created, updated, errors };
      let invited = 0;
      for (const p of out) {
        if (p.existing) await tx`update ${tx(kind)} set ${tx(p.data)} where id = ${p.existing.id}`;
        else {
          const [n] = await tx`insert into ${tx(kind)} ${tx(p.data)} returning id`;
          // New local users get an invitation to choose their own password.
          if (kind === 'users' && p.data.auth === 'local' && p.data.active) {
            await sendLink(tx, { id: n.id, email: String(p.data.email), name: String(p.data.name) }, 'invite', req.user.id);
            invited++;
          }
        }
      }
      await audit(tx, { actor: req.user.id, action: `admin.${kind}.imported`, entity: kind, data: { created, updated, invited }, ip: req.ip });
      return { applied: true, rows: rows.length, created, updated, invited, errors: [] };
    });
  });
}
