# Namaste Mobile CRM

A shared enquiry tracker for Namaste Mobile with WhatsApp built in. It runs as one small web app that the manager and every salesperson open on their phone or computer.

## What it does

**Enquiries**
- Every enquiry goes into one list: WhatsApp, walk-ins, calls, Instagram, Facebook and the website.
- Each new enquiry is auto-assigned to the active salesperson with the fewest open enquiries.
- Enquiries move through stages: New → Contacted → Interested → Price Shared → Negotiation → Booked → Sold / Lost, with No Response after 3 unanswered calls.
- Every open enquiry has a next follow-up date, so the overdue ones are flagged.
- The manager's dashboard shows today's enquiries, follow-ups due, overdue, no response, interested and converted, plus a table per salesperson.
- Salespeople log in with their mobile number and a PIN and see only their own enquiries. The manager sees everything.

**Automatic WhatsApp**

| When | Who gets it | What |
| --- | --- | --- |
| A customer messages your WhatsApp number | Customer + salesperson | The enquiry is created and assigned, the customer gets an instant greeting, and the salesperson gets an alert |
| A website / Instagram / Facebook form is filled | Customer + salesperson | Same as above |
| An enquiry is assigned or reassigned | Salesperson | "New enquiry for you…" with the customer's name, number and model |
| 9:30 am daily | Each salesperson | Their follow-ups due today and overdue |
| 11:00 am daily | Quiet customers | A follow-up for enquiries at Interested, Price Shared, Negotiation or No Response that have been silent for 2+ days (at most 2 per customer, 3 days apart) |
| Enquiry marked Sold | Customer | Thank-you message |
| 8:30 pm daily | Manager | The day's enquiries, sales, lost, pending follow-ups and each salesperson's numbers |

Salespeople can also read and answer customers' WhatsApp messages inside the enquiry screen. Replies go from the store's business number, and the chat history stays with the enquiry even if the salesperson leaves.

## 1. Try it on a computer (test mode, no WhatsApp needed)

You need [Node.js 20 or newer](https://nodejs.org).

```bash
npm install
cp .env.example .env        # then open .env and set SESSION_SECRET and COOKIE_SECURE=0
npm start
```

Open http://localhost:3000. The first screen creates the manager login. Then add salespeople in **Team & WhatsApp**.

In test mode, every WhatsApp message is saved in the enquiry's chat marked "test mode, not sent", so you can check the wording and timing before going live.

## 2. Put it online

The app must run on a server with an HTTPS address, because WhatsApp delivers incoming messages to it. Any of these works:

- **Railway or Render:** connect this folder from GitHub. Add a persistent disk/volume mounted at `/data`, set `DATA_DIR=/data`, and add the settings from `.env.example`. The included `Dockerfile` is picked up automatically.
- **A small VPS** (any provider with 1 GB RAM): install Node 22, copy the folder, `npm ci --omit=dev`, run it with `pm2` or systemd, and put Caddy or Nginx in front for HTTPS.

Point a subdomain such as `crm.namastemobile.in` at it.

## 3. Connect WhatsApp (Meta WhatsApp Cloud API)

This uses Meta's own API directly, so there's no monthly provider fee. You pay Meta only per message (see costs below).

1. **Meta Business account:** at [business.facebook.com](https://business.facebook.com), create or use your business portfolio for Namaste Mobile. Verify the business (GST certificate or shop licence) to lift the starting messaging limits.
2. **App:** at [developers.facebook.com](https://developers.facebook.com), create an app of type *Business* and add the **WhatsApp** product.
3. **Phone number:** in WhatsApp → API Setup, add the number customers will message. A number that is already active in the WhatsApp or WhatsApp Business app normally has to be removed from the app first. Meta may also offer to connect an existing Business-app number during setup; if so, follow its steps. Otherwise, a fresh SIM for the API is the simplest option. Copy the **Phone number ID**.
4. **Permanent token:** in Business settings → Users → System users, create a system user. Give it the app and your WhatsApp account, then generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`. The temporary token on the API Setup page expires in 24 hours, so don't use it.
5. **App secret:** App settings → Basic → App secret.
6. **Webhook:** WhatsApp → Configuration → Webhook. Set the callback URL to `https://<your-domain>/webhook` and the verify token to the same text as `WA_VERIFY_TOKEN`. Then subscribe to the **messages** field.
7. **Templates:** create the 6 templates in [TEMPLATES.md](TEMPLATES.md) in WhatsApp Manager and wait for approval.
8. **Settings:** set `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET` and `WA_VERIFY_TOKEN`, then restart. The top bar changes from "WhatsApp test mode" to "WhatsApp live".

Check it works: message the business number from a phone that isn't saved as staff. The enquiry should appear within seconds, with the greeting in its chat. In **Team & WhatsApp**, "Send now" runs each daily message on demand.

Each salesperson's mobile number in the Team list is where their alerts go. Templates reach them any time; they don't need to message the business number first.

## 4. Website, Instagram and Facebook enquiries

**Website form:** set `PUBLIC_FORM_KEY` and `PUBLIC_FORM_ORIGIN`, then add this to your website:

```html
<form action="https://crm.namastemobile.in/api/public/enquiry" method="post">
  <input type="hidden" name="key" value="YOUR_PUBLIC_FORM_KEY">
  <input type="hidden" name="redirect" value="https://namastemobile.in/thank-you">
  <input name="name" placeholder="Your name" required>
  <input name="phone" placeholder="Mobile number" required>
  <input name="model" placeholder="Which phone?">
  <textarea name="message" placeholder="Message"></textarea>
  <input name="website" style="display:none" tabindex="-1" autocomplete="off"><!-- spam trap, keep hidden -->
  <button>Send enquiry</button>
</form>
```

The key appears in your website's page source, so it only filters out random spam; it is not a password. To tag the source, add `<input type="hidden" name="source" value="Instagram">` (or `Facebook`).

**Instagram and Facebook:** the simplest route is **Click-to-WhatsApp** ads and a WhatsApp button on your profiles. The customer lands in WhatsApp, and the CRM creates the enquiry by itself. Lead-form ads can be sent to the same endpoint through Zapier or Make with a JSON POST containing `name`, `phone`, `model`, `source` and the `X-Api-Key` header.

## 5. Costs

- **Meta per-message charges in India** (rates from October 2026; Meta changes them from time to time):
  - Utility templates (greeting, alerts, reminders, summary, thank-you): about ₹0.12 each.
  - Marketing templates (customer follow-up): about ₹0.86 each.
  - Replies within 24 hours of the customer's last message: the first 1,000 a month per number are free, then about ₹0.12 each.
  - Rough monthly estimate, at 50 enquiries a day with 30 salespeople: about 3,000 utility messages (≈ ₹350), plus up to about 1,000 customer follow-ups (≈ ₹860). That's roughly **₹1,000–1,500 a month**. Set `AUTO_CUSTOMER_FOLLOWUP=0` to drop the second part.
- **Hosting:** roughly ₹400–1,000 a month for a small server or Railway/Render plan.
- **No per-user licence.**

## 6. Day to day

- **Backups:** the whole CRM is one file, `data/crm.db` (or `/data/crm.db`). Copy it daily. The manager can also use **Export CSV** on the Enquiries tab.
- **Leavers:** in Team & WhatsApp, tap "Turn off & move N open". Their open enquiries are shared out to the others and they can no longer log in.
- **Change times or turn off automatic messages:** edit the `CRON_…` and `AUTO_…` settings and restart.

## Files

| File | What it is |
| --- | --- |
| `src/server.js` | Web server, login, API, WhatsApp webhook, website form |
| `src/crm.js` | Assignment, stages and follow-up rules, and which messages they trigger |
| `src/whatsapp.js` | Sending through the WhatsApp Cloud API; template wording |
| `src/jobs.js` | The 9:30 am, 11:00 am and 8:30 pm messages |
| `src/db.js` | Database tables (SQLite) |
| `public/` | The app screens |
| `TEMPLATES.md` | Templates to submit to Meta |
