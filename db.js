// SQLite storage. One file (data/crm.db), created on first start.
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "crm.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,          -- 10-digit Indian mobile, used for WhatsApp alerts and login
  role TEXT NOT NULL DEFAULT 'sales',  -- 'manager' | 'sales'
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'Walk-in',
  model TEXT NOT NULL DEFAULT '',
  budget INTEGER NOT NULL DEFAULT 0,
  exchange INTEGER NOT NULL DEFAULT 0,
  emi INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'New',
  assignee_id INTEGER REFERENCES users(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_follow_up TEXT,                 -- YYYY-MM-DD (IST)
  created_at TEXT NOT NULL,            -- ISO timestamp
  created_day TEXT NOT NULL,           -- YYYY-MM-DD (IST)
  closed_day TEXT,
  lost_reason TEXT,
  last_inbound_at TEXT,                -- last WhatsApp message FROM the customer (opens the 24h reply window)
  last_auto_followup_at TEXT,
  unread INTEGER NOT NULL DEFAULT 0,   -- customer WhatsApp messages not yet seen in the CRM
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS leads_assignee ON leads(assignee_id, status);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  by TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_lead ON activity(lead_id, at);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,             -- 'in' | 'out'
  to_phone TEXT,
  kind TEXT NOT NULL,                  -- 'text' | 'template'
  template TEXT,
  body TEXT NOT NULL,
  wa_id TEXT,                          -- WhatsApp message id
  status TEXT NOT NULL DEFAULT 'sent', -- sent | delivered | read | failed | dry-run | received
  error TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_lead ON messages(lead_id, at);
CREATE INDEX IF NOT EXISTS messages_wa ON messages(wa_id);
CREATE TABLE IF NOT EXISTS job_runs (
  job TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (job, day)
);
`);

module.exports = db;
