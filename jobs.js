// Scheduled WhatsApp messages (Indian time). Each job runs at most once a day, even after a restart.
const cron = require("node-cron");
const db = require("./db");
const wa = require("./whatsapp");
const crm = require("./crm");
const { today, addDays, nowIso, fmtDay } = require("./util");

const TZ = process.env.TZ_NAME || "Asia/Kolkata";
const once = (job, fn) => async (force = false) => {
  const day = today();
  if (!force) {
    const r = db.prepare("INSERT OR IGNORE INTO job_runs (job, day) VALUES (?, ?)").run(job, day);
    if (!r.changes) return { skipped: true };
  }
  try { return await fn(); } catch (e) { console.error(`[jobs] ${job} failed:`, e); return { error: e.message }; }
};

/** 09:30 — each salesperson gets their due + overdue follow-ups. */
const staffReminders = once("staff_reminders", async () => {
  const t = today();
  const staff = db.prepare("SELECT * FROM users WHERE active = 1 AND role = 'sales'").all();
  let sent = 0;
  for (const u of staff) {
    const rows = db.prepare(`SELECT name, model, phone, next_follow_up FROM leads
      WHERE assignee_id = ? AND status NOT IN ('Sold','Lost') AND next_follow_up IS NOT NULL AND next_follow_up <= ?
      ORDER BY next_follow_up ASC, id ASC`).all(u.id, t);
    if (!rows.length) continue;
    const overdue = rows.filter((r) => r.next_follow_up < t).length;
    const due = rows.length - overdue;
    const top = rows.slice(0, 5).map((r) => `${r.name || r.phone}${r.model ? " (" + r.model + ")" : ""}`).join(", ") + (rows.length > 5 ? ` and ${rows.length - 5} more` : "");
    await wa.sendTemplate(u.phone, "staff_daily_followups", [u.name.split(" ")[0], String(due), String(overdue), top]);
    sent++;
  }
  return { sent };
});

/** 11:00 — automatic nudge to customers who went quiet after showing interest. */
const customerFollowups = once("customer_followups", async () => {
  const t = today();
  const gapDays = Number(process.env.AUTO_FOLLOWUP_GAP_DAYS || 3);
  const maxPerLead = Number(process.env.AUTO_FOLLOWUP_MAX || 2);
  const quietSince = new Date(Date.now() - 48 * 3600e3).toISOString();
  const lastAllowed = new Date(Date.now() - gapDays * 864e5).toISOString();
  const rows = db.prepare(`SELECT l.* FROM leads l
    WHERE l.status IN ('Interested','Price Shared','Negotiation','No Response')
      AND l.next_follow_up IS NOT NULL AND l.next_follow_up <= ?
      AND l.created_day < ?
      AND (l.last_inbound_at IS NULL OR l.last_inbound_at < ?)
      AND (l.last_auto_followup_at IS NULL OR l.last_auto_followup_at < ?)
      AND (SELECT COUNT(*) FROM messages m WHERE m.lead_id = l.id AND m.template = 'customer_followup' AND m.status != 'failed') < ?`)
    .all(t, t, quietSince, lastAllowed, maxPerLead);
  if (process.env.AUTO_CUSTOMER_FOLLOWUP === "0") return { sent: 0, disabled: true, eligible: rows.length };
  let sent = 0;
  for (const l of rows) {
    const staff = l.assignee_id ? crm.userName(l.assignee_id) : "our team";
    const first = l.name ? l.name.split(" ")[0] : "";
    const r = await wa.sendTemplate(l.phone, "customer_followup", [first || "there", staff, l.model || "phone you asked about"], l.id);
    if (r.ok) {
      crm.touch(l.id, { last_auto_followup_at: nowIso() });
      crm.log(l.id, "WhatsApp", "Automatic follow-up sent to customer");
      sent++;
    }
  }
  return { sent };
});

/** 20:30 — the manager's end-of-day summary for the whole store. */
const managerSummary = once("manager_summary", async () => {
  const t = today();
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  const enquiries = n("SELECT COUNT(*) n FROM leads WHERE created_day = ?", t);
  const sold = n("SELECT COUNT(*) n FROM leads WHERE status = 'Sold' AND closed_day = ?", t);
  const lost = n("SELECT COUNT(*) n FROM leads WHERE status = 'Lost' AND closed_day = ?", t);
  const overdue = n("SELECT COUNT(*) n FROM leads WHERE status NOT IN ('Sold','Lost') AND next_follow_up < ?", addDays(1));
  const team = db.prepare(`SELECT u.name,
      (SELECT COUNT(*) FROM leads l WHERE l.assignee_id = u.id AND l.created_day = ?) AS today_n,
      (SELECT COUNT(*) FROM leads l WHERE l.assignee_id = u.id AND l.status = 'Sold' AND l.closed_day = ?) AS sold_n,
      (SELECT COUNT(*) FROM leads l WHERE l.assignee_id = u.id AND l.status NOT IN ('Sold','Lost') AND l.next_follow_up < ?) AS over_n
    FROM users u WHERE u.role = 'sales' AND u.active = 1 ORDER BY over_n DESC, sold_n DESC, u.name`).all(t, t, addDays(1));
  const teamTxt = team.length
    ? team.map((r) => `${r.name.split(" ")[0]} ${r.today_n}/${r.sold_n}/${r.over_n}`).join("; ")
    : "no salespeople added";
  const managers = db.prepare("SELECT * FROM users WHERE active = 1 AND role = 'manager'").all();
  for (const m of managers) {
    await wa.sendTemplate(m.phone, "manager_daily_summary", [new Date().toLocaleDateString("en-IN", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }),
      String(enquiries), String(sold), String(lost), String(overdue), teamTxt]);
  }
  return { sent: managers.length, enquiries, sold, lost, overdue };
});

function start() {
  const at = (env, def) => process.env[env] || def;
  cron.schedule(at("CRON_STAFF_REMINDERS", "30 9 * * *"), () => staffReminders(), { timezone: TZ });
  cron.schedule(at("CRON_CUSTOMER_FOLLOWUPS", "0 11 * * *"), () => customerFollowups(), { timezone: TZ });
  cron.schedule(at("CRON_MANAGER_SUMMARY", "30 20 * * *"), () => managerSummary(), { timezone: TZ });
  console.log(`[jobs] scheduled (${TZ}): staff reminders, customer follow-ups, manager summary`);
}

module.exports = { start, staffReminders, customerFollowups, managerSummary };
