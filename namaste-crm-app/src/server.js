require("./env");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const db = require("./db");
const crm = require("./crm");
const wa = require("./whatsapp");
const jobs = require("./jobs");
const { waNumber, today, cleanPhone, hashPin, checkPin, signToken, readToken, nowIso, addDays } = require("./util");

const app = express();
app.set("trust proxy", 1);
// keep the raw body for the WhatsApp signature check
app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false }));
app.use((req, _res, next) => { if (!req.body) req.body = {}; next(); });
app.use(express.static(path.join(__dirname, "..", "public"), { index: "index.html" }));

// ---------------- helpers ----------------
const fail = (res, status, error) => res.status(status).json({ error });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); fail(res, e.status || 500, e.status ? e.message : "Something went wrong. Try again."); });
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((c) => c.trim().split("=").map(decodeURIComponent)).filter((p) => p[0]));
}
function setSession(res, userId) {
  const secure = process.env.COOKIE_SECURE === "0" ? "" : "; Secure";
  res.setHeader("Set-Cookie", `nm_session=${signToken(userId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secure}`);
}
function auth(req, res, next) {
  const uid = readToken(cookies(req).nm_session);
  const u = uid && db.prepare("SELECT id, name, phone, role, active FROM users WHERE id = ?").get(uid);
  if (!u || !u.active) return fail(res, 401, "Please log in");
  req.user = u; next();
}
const managerOnly = (req, res, next) => (req.user.role === "manager" ? next() : fail(res, 403, "Only the manager can do this"));
function leadFor(req) {
  const l = crm.getLead(Number(req.params.id));
  if (!l) throw Object.assign(new Error("Enquiry not found"), { status: 404 });
  if (req.user.role !== "manager" && l.assignee_id !== req.user.id) throw Object.assign(new Error("This enquiry belongs to another salesperson"), { status: 403 });
  return l;
}
const LEAD_FIELDS = "id, name, phone, source, model, budget, exchange, emi, notes, status, assignee_id, attempts, next_follow_up, created_at, created_day, closed_day, lost_reason, last_inbound_at, unread, updated_at";

// ---------------- setup & login ----------------
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/api/state", (req, res) => {
  const users = db.prepare("SELECT COUNT(*) n FROM users").get().n;
  const uid = readToken(cookies(req).nm_session);
  res.json({ needsSetup: users === 0, loggedIn: !!uid, store: process.env.STORE_NAME || "Namaste Mobile" });
});
app.post("/api/setup", wrap((req, res) => {
  if (db.prepare("SELECT COUNT(*) n FROM users").get().n) return fail(res, 409, "Setup is already done");
  const { name, phone, pin } = req.body;
  if (!name || cleanPhone(phone).length !== 10 || !/^\d{4,8}$/.test(String(pin))) return fail(res, 400, "Enter your name, 10-digit mobile and a 4–8 digit PIN");
  const r = db.prepare("INSERT INTO users (name, phone, role, pin_hash) VALUES (?, ?, 'manager', ?)").run(String(name).trim(), cleanPhone(phone), hashPin(pin));
  setSession(res, r.lastInsertRowid); res.json({ ok: true });
}));
const attempts = new Map();
app.post("/api/login", wrap((req, res) => {
  const phone = cleanPhone(req.body.phone);
  const key = phone + "|" + req.ip;
  const a = attempts.get(key) || { n: 0, t: Date.now() };
  if (a.n >= 8 && Date.now() - a.t < 15 * 60e3) return fail(res, 429, "Too many wrong PINs. Wait 15 minutes and try again.");
  const u = db.prepare("SELECT * FROM users WHERE phone = ? AND active = 1").get(phone);
  if (!u || !checkPin(req.body.pin, u.pin_hash)) { attempts.set(key, { n: a.n + 1, t: a.n ? a.t : Date.now() }); return fail(res, 401, "Wrong mobile number or PIN"); }
  attempts.delete(key); setSession(res, u.id); res.json({ ok: true });
}));
app.post("/api/logout", (_req, res) => { res.setHeader("Set-Cookie", "nm_session=; HttpOnly; Path=/; Max-Age=0"); res.json({ ok: true }); });

// ---------------- app data ----------------
app.get("/api/me", auth, (req, res) => {
  res.json({
    me: req.user,
    users: db.prepare("SELECT id, name, phone, role, active FROM users ORDER BY active DESC, name").all(),
    statuses: crm.STATUSES, sources: crm.SOURCES, lostReasons: crm.LOST_REASONS,
    whatsappLive: !wa.DRY_RUN, today: today(),
  });
});

app.get("/api/leads", auth, (req, res) => {
  // all open enquiries + everything from the last 120 days
  const since = addDays(-120);
  const mine = req.user.role === "manager" ? "" : "AND assignee_id = @uid";
  const rows = db.prepare(`SELECT ${LEAD_FIELDS} FROM leads WHERE (status NOT IN ('Sold','Lost') OR created_day >= @since OR closed_day >= @since) ${mine} ORDER BY id DESC`)
    .all({ since, uid: req.user.id });
  res.json({ leads: rows, today: today() });
});

app.get("/api/leads/:id", auth, wrap((req, res) => {
  const l = leadFor(req);
  res.json({
    lead: l,
    activity: db.prepare("SELECT at, by, text FROM activity WHERE lead_id = ? ORDER BY id DESC LIMIT 100").all(l.id),
    messages: db.prepare("SELECT direction, kind, template, body, status, error, at FROM messages WHERE lead_id = ? AND (direction = 'in' OR to_phone = ?) ORDER BY id ASC LIMIT 200").all(l.id, waNumber(l.phone)),
    windowOpen: !!wa.windowOpen(l),
  });
}));

app.post("/api/leads", auth, wrap(async (req, res) => {
  const b = req.body;
  if (req.user.role !== "manager") b.assignee_id = b.assignee_id || req.user.id;
  const lead = await crm.createLead(b, req.user.name, { greet: b.greet !== false });
  res.json({ lead });
}));

app.patch("/api/leads/:id", auth, wrap(async (req, res) => {
  const l = leadFor(req);
  const b = req.body, patch = {};
  for (const k of ["name", "model", "notes"]) if (k in b) patch[k] = String(b[k] || "").slice(0, k === "notes" ? 1000 : 80);
  if ("budget" in b) patch.budget = Number(b.budget) || 0;
  if ("exchange" in b) patch.exchange = b.exchange ? 1 : 0;
  if ("emi" in b) patch.emi = b.emi ? 1 : 0;
  if ("next_follow_up" in b && /^\d{4}-\d{2}-\d{2}$/.test(b.next_follow_up)) {
    patch.next_follow_up = b.next_follow_up; crm.log(l.id, req.user.name, `Next follow-up set for ${crm.fmtDay(b.next_follow_up)}`);
  }
  if ("assignee_id" in b && Number(b.assignee_id) !== l.assignee_id) {
    if (req.user.role !== "manager") return fail(res, 403, "Only the manager can reassign");
    const to = crm.getUser(Number(b.assignee_id));
    if (!to) return fail(res, 400, "Unknown salesperson");
    patch.assignee_id = to.id;
    crm.log(l.id, req.user.name, `Reassigned from ${crm.userName(l.assignee_id)} to ${to.name}`);
  }
  if ("unread" in b) patch.unread = 0;
  crm.touch(l.id, patch);
  if (patch.assignee_id) await crm.alertAssignee(crm.getLead(l.id), patch.assignee_id);
  res.json({ lead: crm.getLead(l.id) });
}));

app.post("/api/leads/:id/status", auth, wrap(async (req, res) => {
  const l = leadFor(req);
  res.json({ lead: await crm.setStatus(l.id, req.body.status, req.user.name, req.body.lostReason) });
}));
app.post("/api/leads/:id/action", auth, wrap(async (req, res) => {
  const l = leadFor(req);
  res.json({ lead: await crm.logAction(l.id, req.body.act, req.user.name) });
}));
app.post("/api/leads/:id/note", auth, wrap((req, res) => {
  const l = leadFor(req);
  const t = String(req.body.text || "").trim();
  if (!t) return fail(res, 400, "Write a note first");
  crm.log(l.id, req.user.name, t); crm.touch(l.id, {});
  res.json({ ok: true });
}));
app.post("/api/leads/:id/whatsapp", auth, wrap(async (req, res) => {
  const l = leadFor(req);
  const text = String(req.body.text || "").trim().slice(0, 4000);
  if (req.body.template === "customer_followup") {
    const first = l.name ? l.name.split(" ")[0] : "there";
    const r = await wa.sendTemplate(l.phone, "customer_followup", [first, req.user.name, l.model || "phone you asked about"], l.id);
    if (!r.ok) return fail(res, 502, "WhatsApp didn't accept the message: " + r.error);
    crm.log(l.id, req.user.name, "Sent follow-up template on WhatsApp");
    return res.json({ ok: true });
  }
  if (!text) return fail(res, 400, "Type a message first");
  if (!wa.windowOpen(l)) return fail(res, 409, "The customer hasn't messaged in the last 24 hours, so WhatsApp only allows the approved follow-up template.");
  const r = await wa.sendText(l.phone, text, l.id);
  if (!r.ok) return fail(res, 502, "WhatsApp didn't accept the message: " + r.error);
  crm.touch(l.id, { unread: 0, ...(l.status === "New" ? { status: "Contacted", next_follow_up: addDays(1) } : {}) });
  crm.log(l.id, req.user.name, "WhatsApp reply sent");
  res.json({ ok: true });
}));

// ---------------- team (manager) ----------------
app.post("/api/users", auth, managerOnly, wrap((req, res) => {
  const { name, phone, pin, role } = req.body;
  if (!name || cleanPhone(phone).length !== 10 || !/^\d{4,8}$/.test(String(pin))) return fail(res, 400, "Enter a name, 10-digit mobile and a 4–8 digit PIN");
  if (db.prepare("SELECT 1 FROM users WHERE phone = ?").get(cleanPhone(phone))) return fail(res, 409, "Someone with this mobile number already exists");
  db.prepare("INSERT INTO users (name, phone, role, pin_hash) VALUES (?, ?, ?, ?)").run(String(name).trim().slice(0, 60), cleanPhone(phone), role === "manager" ? "manager" : "sales", hashPin(pin));
  res.json({ ok: true });
}));
app.patch("/api/users/:id", auth, managerOnly, wrap((req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(req.params.id));
  if (!u) return fail(res, 404, "Not found");
  const b = req.body;
  if ("active" in b) {
    if (u.id === req.user.id && !b.active) return fail(res, 400, "You can't turn off your own account");
    db.prepare("UPDATE users SET active = ? WHERE id = ?").run(b.active ? 1 : 0, u.id);
  }
  if (b.pin) {
    if (!/^\d{4,8}$/.test(String(b.pin))) return fail(res, 400, "PIN must be 4–8 digits");
    db.prepare("UPDATE users SET pin_hash = ? WHERE id = ?").run(hashPin(b.pin), u.id);
  }
  if (b.name) db.prepare("UPDATE users SET name = ? WHERE id = ?").run(String(b.name).trim().slice(0, 60), u.id);
  res.json({ ok: true });
}));
app.post("/api/users/:id/reassign", auth, managerOnly, wrap(async (req, res) => {
  const from = Number(req.params.id);
  const open = db.prepare("SELECT id FROM leads WHERE assignee_id = ? AND status NOT IN ('Sold','Lost')").all(from);
  db.prepare("UPDATE users SET active = 0 WHERE id = ? AND id != ?").run(from, req.user.id); // stop new ones going to them
  let n = 0;
  for (const { id } of open) {
    const to = crm.pickAssignee();
    if (!to || to === from) break;
    crm.touch(id, { assignee_id: to });
    crm.log(id, req.user.name, `Reassigned from ${crm.userName(from)} to ${crm.userName(to)}`);
    await crm.alertAssignee(crm.getLead(id), to);
    n++;
  }
  res.json({ moved: n });
}));

app.get("/api/export.csv", auth, managerOnly, (req, res) => {
  const rows = db.prepare(`SELECT l.*, u.name AS salesperson FROM leads l LEFT JOIN users u ON u.id = l.assignee_id ORDER BY l.id DESC`).all();
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Created", "Name", "Mobile", "Source", "Model", "Budget", "Exchange", "EMI", "Salesperson", "Stage", "Next follow-up", "Closed", "Lost reason", "Notes"];
  const body = rows.map((l) => [l.created_day, l.name, l.phone, l.source, l.model, l.budget || "", l.exchange ? "Yes" : "", l.emi ? "Yes" : "", l.salesperson, l.status, l.next_follow_up, l.closed_day, l.lost_reason, l.notes].map(q).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="namaste-enquiries-${today()}.csv"`);
  res.send("﻿" + [head.map(q).join(","), ...body].join("\r\n"));
});

app.post("/api/jobs/:name/run", auth, managerOnly, wrap(async (req, res) => {
  const fn = { reminders: jobs.staffReminders, followups: jobs.customerFollowups, summary: jobs.managerSummary }[req.params.name];
  if (!fn) return fail(res, 404, "Unknown job");
  res.json(await fn(true));
}));

// ---------------- website / Instagram / Facebook forms ----------------
app.use("/api/public", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.PUBLIC_FORM_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.post("/api/public/enquiry", wrap(async (req, res) => {
  const key = req.headers["x-api-key"] || req.body.key;
  if (!process.env.PUBLIC_FORM_KEY || key !== process.env.PUBLIC_FORM_KEY) return fail(res, 401, "Invalid key");
  if (req.body.website) return res.json({ ok: true }); // honeypot field for bots
  const phone = cleanPhone(req.body.phone);
  if (phone.length !== 10) return fail(res, 400, "Enter a valid 10-digit mobile number");
  const existing = crm.findOpenByPhone(phone);
  if (existing) {
    crm.log(existing.id, "Website", `Enquired again${req.body.model ? " about " + req.body.model : ""}${req.body.message ? ": " + req.body.message : ""}`);
    return res.json({ ok: true });
  }
  const source = crm.SOURCES.includes(req.body.source) ? req.body.source : "Website";
  await crm.createLead({ name: req.body.name, phone, model: req.body.model, notes: req.body.message || "", source }, source, { greet: true });
  if (req.body.redirect && /^https?:\/\//.test(req.body.redirect)) return res.redirect(303, req.body.redirect);
  res.json({ ok: true });
}));

// ---------------- WhatsApp webhook ----------------
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.WA_VERIFY_TOKEN) return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});
app.post("/webhook", wrap(async (req, res) => {
  const secret = process.env.WA_APP_SECRET;
  if (secret) {
    const sig = String(req.headers["x-hub-signature-256"] || "");
    const want = "sha256=" + crypto.createHmac("sha256", secret).update(req.rawBody || "").digest("hex");
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return res.sendStatus(401);
  }
  res.sendStatus(200); // answer Meta fast, then process
  for (const entry of req.body.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || ""]));
      for (const m of v.messages || []) {
        if (db.prepare("SELECT 1 FROM messages WHERE wa_id = ? AND direction = 'in'").get(m.id)) continue; // Meta retries
        const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title
          || (m.image ? "[photo]" + (m.image.caption ? " " + m.image.caption : "") : "") || (m.type ? `[${m.type}]` : "");
        try { await crm.handleInbound({ from: m.from, name: names[m.from], text, waId: m.id }); }
        catch (e) { console.error("[webhook] inbound failed", e); }
      }
      for (const s of v.statuses || []) {
        const err = s.errors?.[0] ? `${s.errors[0].code}: ${s.errors[0].title}` : null;
        db.prepare("UPDATE messages SET status = ?, error = COALESCE(?, error) WHERE wa_id = ?").run(s.status, err, s.id);
      }
    }
  }
}));

app.get(/^\/(?!api\/|webhook).*/, (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

const PORT = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Namaste Mobile CRM on http://localhost:${PORT}  (WhatsApp: ${wa.DRY_RUN ? "DRY RUN, messages are recorded but not sent" : "LIVE"})`);
    if (process.env.JOBS !== "0") jobs.start();
  });
}
module.exports = app;
