-- Dues: accounts-receivable follow-up. Every row belongs to one account (user_id); an account only ever sees its own rows.

create table if not exists users (
  id         text primary key,
  username   text not null unique,          -- lower-case
  name       text not null,
  pass_hash  text not null,                 -- PBKDF2-SHA256, base64url
  salt       text not null,
  created_at text not null
);

create table if not exists settings (
  user_id text primary key references users(id) on delete cascade,
  data    text not null                     -- JSON: business, upi, reminder steps, templates
);

create table if not exists clients (
  id         text primary key,
  user_id    text not null references users(id) on delete cascade,
  name       text not null,
  company    text not null default '',
  phone      text not null default '',      -- +91XXXXXXXXXX or empty
  email      text not null default '',
  notes      text not null default '',
  created_at text not null
);
create index if not exists clients_user on clients (user_id, name);

create table if not exists invoices (
  id           text primary key,
  user_id      text not null references users(id) on delete cascade,
  client_id    text not null references clients(id) on delete cascade,
  number       text not null,
  description  text not null default '',
  amount       real not null check (amount > 0),
  paid         real not null default 0,
  issued_on    text not null,               -- YYYY-MM-DD, India time
  due_on       text not null,
  status       text not null default 'open' check (status in ('open', 'paid', 'void')),
  promise_on   text,                        -- client promised to pay by this day: reminders pause until then
  promise_note text,
  pay_token    text not null unique,        -- public pay page /p/<token>
  rp_link      text,                        -- Razorpay payment link, when Razorpay is set up
  paid_on      text,
  created_at   text not null,
  updated_at   text not null,
  unique (user_id, number)
);
create index if not exists invoices_user on invoices (user_id, status, due_on);

create table if not exists payments (
  id         text primary key,
  user_id    text not null references users(id) on delete cascade,
  invoice_id text not null references invoices(id) on delete cascade,
  amount     real not null check (amount > 0),
  method     text not null default 'other',  -- upi, bank, cash, card, razorpay, other
  ref        text not null default '',
  paid_on    text not null,
  created_at text not null
);
create index if not exists payments_invoice on payments (invoice_id);
create index if not exists payments_user on payments (user_id, paid_on);

-- What happened to an invoice, newest first in the app: created, reminder sent, promise, payment, ...
create table if not exists events (
  id         integer primary key autoincrement,
  user_id    text not null references users(id) on delete cascade,
  invoice_id text references invoices(id) on delete cascade,
  kind       text not null,
  detail     text not null default '',
  created_at text not null
);
create index if not exists events_invoice on events (invoice_id, id);
create index if not exists events_user on events (user_id, id);

-- One reminder per invoice per step of the schedule.
create table if not exists followups (
  id         text primary key,
  user_id    text not null references users(id) on delete cascade,
  invoice_id text not null references invoices(id) on delete cascade,
  step       integer not null,              -- index into the reminder schedule
  tone       text not null,                 -- gentle, due, firm, final
  channel    text not null,                 -- whatsapp, email
  due_on     text not null,
  status     text not null default 'due' check (status in ('due', 'sent', 'skipped')),
  message    text not null,
  sent_at    text,
  created_at text not null,
  unique (invoice_id, step)
);
create index if not exists followups_user on followups (user_id, status, due_on);

create table if not exists login_attempts (
  key        text not null,                 -- hashed IP + username
  created_at text not null
);
create index if not exists login_attempts_key on login_attempts (key, created_at);
