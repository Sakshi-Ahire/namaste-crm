const crypto = require("crypto");

// ---- dates: everything the store sees is Indian time (IST, UTC+5:30) ----
const TZ = process.env.TZ_NAME || "Asia/Kolkata";
function dayOf(d = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const today = () => dayOf(new Date());
function addDays(n, from = today()) {
  const d = new Date(from + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDay(s) {
  if (!s) return "-";
  if (s === today()) return "today";
  if (s === addDays(1)) return "tomorrow";
  return `${Number(s.slice(8))} ${MONTHS[Number(s.slice(5, 7)) - 1]}`;
}
const nowIso = () => new Date().toISOString();

// ---- phones: store 10-digit Indian mobiles; WhatsApp wants 91XXXXXXXXXX ----
function cleanPhone(p) {
  let d = String(p || "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  return d;
}
function waNumber(p) {
  const d = cleanPhone(p);
  return d.length === 10 ? "91" + d : d;
}

// ---- PINs and session tokens ----
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(pin), salt, 32).toString("hex");
  return `${salt}:${h}`;
}
function checkPin(pin, stored) {
  const [salt, h] = String(stored || "").split(":");
  if (!salt || !h) return false;
  const got = crypto.scryptSync(String(pin), salt, 32);
  const want = Buffer.from(h, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const SECRET = process.env.SESSION_SECRET || "change-me-in-env";
function signToken(userId, days = 30) {
  const body = Buffer.from(JSON.stringify({ u: userId, exp: Date.now() + days * 864e5 })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function readToken(tok) {
  if (!tok || !tok.includes(".")) return null;
  const [body, sig] = tok.split(".");
  const want = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp > Date.now() ? p.u : null;
  } catch { return null; }
}

// WhatsApp template parameters may not contain new lines, tabs or more than 4 spaces in a row
const tplSafe = (s, max = 900) => String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, max) || "-";

module.exports = { dayOf, today, addDays, fmtDay, nowIso, cleanPhone, waNumber, hashPin, checkPin, signToken, readToken, tplSafe };
