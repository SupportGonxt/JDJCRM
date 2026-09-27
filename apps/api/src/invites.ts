// Registration by e-mail: an invitation (72 h) or a password reset (1 h) is a single-use link to set a password.
import { BRAND } from '@baton/core';
import { hashPassword, sha256, token } from './crypto';
import { audit, fail, type Sql } from './db';
import { env } from './env';
import { sendMail } from './notify';

const TTL = { invite: '72 hours', reset: '1 hour' } as const;
export type Purpose = keyof typeof TTL;

/** Issue a link for a local account and e-mail it (link only, like every Pelo CRM e-mail). Older links for the same purpose stop working. */
export async function sendLink(db: Sql, user: { id: string; email: string; name: string }, purpose: Purpose, actor: string | null) {
  const t = token();
  await db`delete from user_tokens where user_id = ${user.id} and purpose = ${purpose} and used_at is null`;
  await db`insert into user_tokens (id, user_id, purpose, expires_at) values (${sha256(t)}, ${user.id}, ${purpose}, now() + ${TTL[purpose]}::interval)`;
  await audit(db, { actor, action: `auth.${purpose}_sent`, entity: 'user', id: user.id });
  const link = `${env.appUrl}/set-password?token=${t}`;
  const [subject, text] = purpose === 'invite'
    ? [`You're invited to ${BRAND.product}`, `Hello ${user.name},\n\nYou have been given an account on ${BRAND.product}. Choose your password here (the link works once, for 72 hours):\n\n${link}\n\nYour sign-in name is ${user.email}.`]
    : [`${BRAND.product} password reset`, `Hello ${user.name},\n\nUse this link to choose a new password (it works once, for 1 hour):\n\n${link}\n\nIf you did not ask for this, ignore this e-mail; your password is unchanged.`];
  setImmediate(() => sendMail([user.email], subject, text));
}

export async function peek(db: Sql, t: string) {
  const [r] = await db`select k.purpose, u.name from user_tokens k join users u on u.id = k.user_id
    where k.id = ${sha256(t)} and k.used_at is null and k.expires_at > now() and u.active and u.auth = 'local'`;
  return r ? { valid: true, purpose: r.purpose as Purpose, name: r.name as string } : { valid: false };
}

/** Redeem a link: set the password, unlock, end every session. */
export async function redeem(db: Sql, t: string, password: string, ip?: string) {
  const [k] = await db`update user_tokens k set used_at = now() from users u
    where k.id = ${sha256(t)} and k.used_at is null and k.expires_at > now() and u.id = k.user_id and u.active and u.auth = 'local'
    returning k.user_id, k.purpose`;
  if (!k) fail(410, 'This link has expired or was already used. Ask for a new one.');
  await db`update users set password_hash = ${hashPassword(password)}, failed_logins = 0, locked_until = null where id = ${k.user_id}`;
  await db`delete from sessions where user_id = ${k.user_id}`;
  await audit(db, { actor: k.user_id, action: k.purpose === 'invite' ? 'auth.invite_accepted' : 'auth.password_reset', entity: 'user', id: k.user_id, ip });
}
