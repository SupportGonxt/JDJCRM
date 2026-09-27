-- Easy, safe registration: e-mailed one-time links to set a password (invitation) or reset it.
-- Only a SHA-256 of the token is stored; links are single-use and expire.
create table user_tokens (
  id text primary key, -- sha256 of the token in the link
  user_id uuid not null references users on delete cascade,
  purpose text not null check (purpose in ('invite', 'reset')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index on user_tokens (user_id);
