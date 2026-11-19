# Usage Guide

🇬🇧 **English** · [🇹🇷 Türkçe](usage.tr.md)

This document describes **how to use** the system. For setup see
[installation.md](installation.md); for technical details [architecture.md](architecture.md).

- [Who can do what](#who-can-do-what)
- [Requester — public portal](#requester--public-portal)
- [IT team — admin panel](#it-team--admin-panel)
- [Administrator operations](#administrator-operations)
- [Credential vault](#credential-vault)
- [After the initial setup](#after-the-initial-setup)

---

## Who can do what

The system has two kinds of users: **requesters** (passwordless, no sign-up) and **staff**
(password sign-in, role-based).

| Page | Requester | `it_staff` | `it_manager` | `admin` |
|---|:--:|:--:|:--:|:--:|
| Create / track a ticket (public) | ✅ | ✅ | ✅ | ✅ |
| Dashboard, ticket management, calendar, tasks | — | ✅ | ✅ | ✅ |
| Company / location / category / custom field management | — | — | ✅ | ✅ |
| Reports, templates | — | — | ✅ | ✅ |
| Credential vault | — | — | ✅ | ✅ |
| Staff management and company assignment | — | — | — | ✅ |

Roles: `admin` (System Administrator), `it_manager` (IT Manager), `it_staff` (IT Staff).

### Company scope — the most important concept

| Role | What they see |
|---|---|
| `admin` | **Everything.** All companies, including records not tied to a company ("global"). |
| `it_manager` | **Only the companies they are assigned to.** A company-scoped manager. |
| `it_staff` | **Only the companies they are assigned to.** |

Staff are assigned to companies from the `Personel Yönetimi` (Staff Management) screen. Only
**`admin`** can do this — company assignment is an authorization decision.

> ⚠️ **Scope is fail-closed:** an `it_manager` or `it_staff` account that is not assigned to any
> company **sees nothing** — empty dashboard, empty ticket list. This is not a bug, it is a
> deliberate choice: if you forget to make the assignment, the account does not gain
> unrestricted access.
>
> **Do not forget the company assignment when adding new staff.** If a user says "I can't see
> anything", this is the first place to check.

Within their own companies an `it_manager` can: manage tickets, define locations/categories/custom
fields, and use reports and the credential vault. They cannot access another company's data through
any path — they cannot move records to that company or assign a company to themselves.

---

## Requester — public portal

No sign-in, no sign-up. The requester only provides an email address.

### Creating a ticket — `/create`

1. Pick the **company** → the **locations** and **categories** defined for it are loaded.
2. Pick a **category** → the SLA targets and auto-assignment attached to the category kick in.
3. Company-specific **dynamic fields** are filled in (text, number, select, phone, URL, email and
   long-text types are supported — defined by an administrator).
4. Title, description, priority and optional **file attachments** (default limit 25 MB).
5. On submission the ticket receives a **number** and an unpredictable **access link**.

> If the company has an `allowedDomains` setting, the requester's email domain must be in that list.

### Knowledge base — `/kb`

Published solution articles are searchable in the portal. When a category is selected in the
request wizard, that category's articles are suggested; if the user answers "Evet, sorunum
çözüldü" ("Yes, my issue is resolved"), the wizard exits without opening a ticket (the article's
"prevented tickets" counter is incremented). Company-specific articles are visible only from that
company's portal.

**Management — `/staff/kb`:** articles are written in Markdown (raw HTML is not processed), TR is
required, EN is optional (TR is shown when EN is missing). Global articles can only be edited by
`admin`, company-specific articles by the `it_manager` in scope; all staff can read them and attach
an article link to a ticket note via "Bilgi bankasından ekle" (Add from knowledge base). View,
👍/👎 and prevented-ticket counts are visible in the list.

### Satisfaction survey (CSAT)

When a ticket is resolved/closed, the requester receives a one-time survey email (this can be
turned off from the company's **"SLA & Mesai" (SLA & Business Hours)** screen). The stars in the
email pre-select the rating on the tracking page; the rating is saved only when the user presses
**"Gönder" (Send)** (so that security scanners automatically opening links in emails cannot fake
a vote). The rating is 1–5 with an optional comment; once per ticket. Results are in the
**"Raporlar → Memnuniyet" (Reports → Satisfaction)** tab: average, response rate, distribution,
breakdowns by staff/category/company and recent comments.

### Status tracking — the access link

The link given after creation (and in notification emails):
`https://<site>/ticket/<accessToken>`

On this page the requester:
- Sees the ticket's **live** status (updated in real time via SSE).
- **Writes replies** and **sends attachments**.
- Reads the IT team's public notes. **Internal notes are never shown here.**

> ⚠️ **Anyone** who has the link can view that ticket — the link itself is the password. Remind
> requesters not to share their personal link.

### Past tickets — `/track`

### All tickets — `/my` (v1.3)

Enter your email address; a short-lived (15 min) link arrives in your inbox and shows every ticket
for that address in a single list. There is no password — email ownership is verified. If you are
looking for a passwordless "ticket history", this is the fastest way.

Look up a ticket by number + email. Alternatively, email alone lists all tickets for that address
(limited to 10 requests per minute).

### Ticket statuses

| Status | Meaning |
|---|---|
| `open` | Open — not yet taken up |
| `in_progress` | In progress |
| `waiting_user_response` | Waiting for the user's response |
| `waiting_other_department` | Waiting for support from another department |
| `topic_transferred` | Topic transferred |
| `process_outside_it` | Process continuing outside IT |
| `on_hold` | On hold |
| `resolved` | Resolved |
| `closed` | Closed |

Priorities: `low`, `medium`, `high`, `critical`.

---

## IT team — admin panel

Sign-in: `/staff/login`. The session is managed with a 15-minute access token + a 7-day refresh
cookie; closing and reopening the tab keeps you signed in, and signing out via "Çıkış" (Sign out)
actually revokes the session server-side.

After signing in, authenticator-based two-factor authentication can be enabled from the
**"Hesap ve Güvenlik" (Account & Security)** screen. The setup key is valid for 10 minutes; the
first 6-digit code generated by the app is verified to activate. On subsequent sign-ins this code
is requested after the password.

### Dashboard — `/staff`

Open/in-progress/resolved ticket counts, SLA status (approaching and breached), tickets assigned
to you.

### Ticket management — `/staff/tickets`

- **List:** filter by status, priority, company, category, assignee; free-text search.
- **Bulk actions:** select multiple tickets and change status/assignment.
- **Detail** (`/staff/tickets/:id`):
  - Change status and priority, assign to a staff member.
  - **Public reply** — visible to the requester, sends an email notification.
  - **Internal note** — visible to staff only, **never** shown to the requester.
  - File attachments, ticket history (who changed what and when), SLA timer.
  - **Relations and watchers:**
    - **Merge** (`admin`, `it_manager`) — merges a duplicate ticket about the same issue into
      another ticket: notes and files are moved to the target, the source is closed, and the
      source's requester is added as CC on the target and notified. Email replies to the source
      land on the target.
    - **Parent/child tickets** — during a widespread incident, affected tickets are linked under a
      single parent ticket (one level). When changing the parent's status, "alt taleplere de
      uygula" (apply to child tickets) resolves/closes all of them together.
    - **Watchers** — CC (requester side: receives the notifications sent to the requester and can
      reply by email; subject to the company's allowed-domain rule) and staff watchers ("İzle"
      (Watch): gets notified of user replies). When a ticket is opened in the portal, and for new
      tickets arriving by email, people in To/Cc are automatically CC'd.
  - An **on-site support appointment** can be created from here.

### Assets — `/staff/assets`

A lightweight inventory: tag (unique within the company), name, type, serial number, location,
assignee email, notes. All staff can view; `admin` and the in-scope `it_manager` can edit.
**CSV import** matches on the tag (updates if present, adds otherwise); columns are `tag, name,
type, serial, location, assigned_to, notes` (`;` or `,` delimited, location by name). Faulty rows
are reported with their line numbers. From the **"İlgili cihaz" (Related device)** card in the
ticket detail a ticket can be linked to an asset (devices assigned to the requester are suggested
first); the asset's page shows its ticket history.

### On-site support calendar — `/staff/onsite`

Appointment types: **"IT Odasına Gelin" (Come to the IT Room)**, **"Toplantı Odası" (Meeting
Room)**, **"Yerinde Müdahale" (On-site Intervention)**.

When creating an appointment you pick a **duration**, and it is drawn on the calendar proportional
to its actual length. Because appointments are not assigned to staff, **parallel appointments at
the same time are normal** — the overlap warning was deliberately removed.

### Task management — `/staff/tasks`

Internal tasks independent of tickets. They can be assigned to multiple people, commented on and
given due dates.

Task statuses: `open`, `in_progress`, `done`, `cancelled`.
Task priorities: `low`, `medium`, `high`, `critical` — **the same as ticket priorities**.

In the list view, tasks can be filtered by assignee, priority, status and text, and sorted by due
date, priority, creation date or title. The counter boxes at the top are clickable filter
shortcuts (e.g. "Süresi Geçen" (Overdue)). Status can be changed directly from the list.

---

## Administrator operations

### Company management — `/staff/companies` (`admin`, `it_manager`)

- **Company:** name, group type (`call_center`, `corporate`, `warehouse`, `retail`), logo, theme
  color.
- **`allowedDomains`:** email domains allowed to open tickets. Empty means no restriction.
- **`portalDomains`:** which FQDN represents the company. When a user arrives from that domain,
  the company's logo and color are applied automatically (branding).
- **`notificationEmail`:** the IT group mailbox where new tickets land.
- **Locations:** address, floor information.
- **Categories:** hierarchical (subcategories), sortable, **per-category SLA** (response and
  resolution time, in minutes) and **auto-assignment**.
- **Custom fields:** company-specific form fields — type, required flag, options.
- **Per-company SMTP:** each company can send email through its own SMTP. If none is defined, the
  global SMTP is used. A **test email** can be sent from the admin panel.
- **SLA & Business Hours** (`admin`, `it_manager` in their own companies):
  - **Business hours calendar** — per-day working intervals (including split intervals such as a
    lunch break) and time zone. When enabled, SLA time only runs within business hours; when
    disabled, 24/7.
  - **Holidays** — while the calendar is enabled, SLA pauses on these days. Fixed-date holidays
    are copied to the next year with a single click; floating days such as religious holidays are
    adjusted manually.
  - **24/7 priorities** — for the selected priorities (e.g. `critical`) the calendar is ignored.
  - **Pre-breach warning threshold** — when the elapsed time reaches this percentage (default
    80%), an email + admin panel notification is sent to the assignee, or to the company's IT
    managers if the ticket is unassigned.
  - **Escalation** — notification to managers on breach; optionally, the priority is raised one
    step when the resolution SLA is exceeded.
  - **Auto-close** (days, 0 = off) — a ticket in `Çözüldü` (Resolved) status that has not been
    reopened for N days is closed (default 7). For `Kullanıcı Yanıtı Bekleniyor` (Waiting for User
    Response), a reminder interval first and then a closing interval can be defined (default
    off). The requester receives a bilingual notification; the action is logged in the ticket
    history as a system entry.

- **Inbound Email** (`admin` only) — the company's support mailbox. Notifications sent to the
  requester use this address as **Reply-To**; replies sent by email land on the ticket as user
  replies (quoted older messages are trimmed, attachments go through the same rules as portal
  uploads). The mailbox is checked every 2 minutes.
  - **Providers:** IMAP (your own server or Gmail with an app password), **Microsoft 365** (Entra
    ID app registration, `Mail.ReadWrite` *Application* permission + admin consent; restrict the
    app to just this mailbox with an Exchange *Application Access Policy*), **Gmail / Google
    Workspace** (a *Web application* OAuth client in Google Cloud; add the redirect URL shown on
    the screen and click "Google ile bağlan" (Connect with Google)).
  - **Matching:** the ticket number in the subject (`TKT-YYYY-NNNNN`) **and** sender = requester
    **and** the same company. Someone else writing the number cannot add a note.
  - **Unmatched emails:** if the setting is enabled, a new ticket is opened with the default
    category/location (the company's allowed-domain restriction applies). A reply to a closed
    ticket becomes a new ticket referencing the previous number; a reply to a resolved ticket
    reopens it.
  - **Safeguards:** auto-replies / newsletters / delivery reports, the mailbox's own address and
    more than 30 messages per sender per hour are not processed. Each message is processed once;
    the outcome of the last 20 messages (reply added / ticket opened / skipped + reason) is
    visible on the screen.
  - Secrets (password, client secret, Google grant) are stored encrypted and never returned to
    the UI.

> **SLA pausing:** while a ticket is in `Kullanıcı Yanıtı Bekleniyor`, `Diğer Birimden Destek
> Bekleniyor` (Waiting for Support from Another Department), `Süreç IT Dışında İlerliyor`
> (Process Continuing Outside IT) or `Beklemede` (On Hold) status, the SLA clock stops; when it
> returns to an active status, due dates shift forward by the time spent waiting. When the user
> replies, the ticket automatically returns to `Açık` (Open) and the clock runs again. The staff
> member's first status change or first note visible to the requester counts as the "first
> response".

> Company SMTP passwords are encrypted with AES-256-GCM. A one-time migration step for older
> installations is documented in [SECURITY.md](../SECURITY.md).

### Templates — `/staff/templates` (`admin`, `it_manager`)

- **Email templates:** ticket created, status changed, assigned, note added, appointment
  scheduled, SLA breach, SLA approaching, SLA escalation.
- **SMS templates:** available when an SMS gateway is configured.
- **Canned responses:** boilerplate text added with one click in the ticket detail.

### "Sözlükler" (dictionaries) — `/staff/dictionaries` (v1.3, `admin` only)

Statuses, priorities, task statuses, on-site support types/statuses and company types are managed
from the admin panel: bilingual labels, color tokens, ordering, deactivation and merging.
Behavior depends on the status CLASS (new/active/waiting/resolved/closed) — add a new waiting
status and SLA pauses on it automatically; no deploy needed.

### Scheduled jobs and backups (v1.2, `admin` only)

- **`/staff/scheduled-jobs`** — all periodic jobs (SLA checks, auto-close, email fetching,
  retention checks, backups, restore drills) in one list: cron / time zone editing, pausing,
  manual triggering, run history and error notifications.
- **`/staff/backups`** — remote backup targets (rclone): definition, connection test, GFS
  retention counts, list of backups on the target. **Restore is deliberately not possible from
  the web** — `scripts/restore.sh` + operator approval is required.

### Reports — `/staff/reports` (`admin`, `it_manager`)

Ticket distribution, staff performance, category breakdown, overview, SLA trends and
**CSV export**.

### Staff management — `/staff/staff-management` (`admin` only)

Add/edit/delete staff, assign roles and set **company scope**. All actions are written to the
audit log.

#### SSO / Directory — identity providers

**OpenID Connect** (Entra ID, Keycloak, Google Workspace…), **SAML 2.0** (ADFS etc.) and
**LDAP / Active Directory** can be defined for staff sign-in. Each active provider gets a button
on the login screen.

- **OIDC:** create a *Web* application in the IdP and add the **redirect URI** shown on the screen
  (`https://<domain>/api/auth/sso/<short-name>/callback`). For group info, enable the IdP's
  `groups` claim (group or app role in Entra). The issuer must be HTTPS.
- **SAML:** register the **ACS** (`…/acs`) and **metadata** (`…/metadata`) URLs with the IdP;
  paste the IdP's signing certificate. Unsigned and unsolicited (IdP-initiated) responses are
  rejected.
- **LDAP/AD:** the user is searched with a service account and then a bind is performed with the
  user's own password. `ldaps://` is recommended (or `ldap://` + StartTLS).
- **Group → role mapping:** when defined, the role is determined from the groups at every sign-in
  (highest role when multiple match); a user who matches no group cannot sign in — someone
  removed from the group in the directory loses access. When **group → company mapping** is
  defined, company assignments are refreshed at every sign-in.
- **JIT:** when enabled, a staff record is created on first sign-in for a user who holds a role
  group but has no record in the system. An existing account with the same email is linked on its
  first SSO sign-in.
- **Disable local password sign-in:** staff sign in only via SSO; **admin accounts keep local
  sign-in for emergencies** (the "Yönetici girişi" (Administrator login) link on the login
  screen). The second factor (MFA) for SSO sign-ins is enforced at the identity provider.
- On-premise IdP / directory servers require `ALLOW_PRIVATE_INTEGRATION_HOSTS=true` in `.env`
  (connections to internal network addresses are blocked by default).

---

### Integrations — `/staff/integrations` (`admin` only)

Forwards ticket events to external channels: **Microsoft Teams** (the URL obtained via
*Workflows → "Post to a channel when a webhook request is received"* in the channel), **Slack**
(Incoming Webhook) and a **generic webhook** (n8n, Power Automate, your own service).

- **Events:** ticket created, status/priority/assignment changed, IT public reply, user reply,
  SLA approaching, SLA breach. An integration can target all companies or a single company.
- **Internal notes and the requester's tracking link are never sent to any channel**; messages
  contain a staff link (requires a session).
- **Generic webhook signature:** the body is JSON; the headers `X-Ticket-Event`,
  `X-Ticket-Delivery`, `X-Ticket-Timestamp` and `X-Ticket-Signature:
  sha256=<HMAC-SHA256(secret, "timestamp.body")>` are sent. The secret is shown **once** after
  saving; it can be rotated. The receiver should reject requests with an old timestamp (e.g.
  older than 5 minutes).
- **Delivery:** queued, 5 attempts with exponential backoff; redirects are not followed, and the
  target passes an SSRF check on every delivery. The last 30 deliveries, errors and "yeniden dene"
  (retry) are visible on the page. On-premise targets require
  `ALLOW_PRIVATE_INTEGRATION_HOSTS=true`.

## Credential vault

`/staff/passwords` — **`admin` and `it_manager`**.

- **`admin`** sees all records.
- **`it_manager`** sees only the records of the **companies they are assigned to** and can add
  new records only for those companies.
- **Records not tied to a company ("global") are visible to `admin` only.** Global records (domain
  admin, root passwords and the like) tend to be cross-company secrets; therefore an `it_manager`
  can neither see nor create them.

For storing corporate passwords (servers, licenses, service accounts). They are not hashed,
because the passwords must be viewable again; instead they are encrypted with **AES-256-GCM**.

- Only the **password** and **notes** fields are encrypted. Title, category, URL and username are
  plain text (so search works).
- The list view **never** returns passwords — they are shown masked.
- Clicking "Göster" (Reveal) decrypts the password on the server, it is automatically hidden on
  screen after a few seconds and **every reveal is written to the audit log**.
- Copy to clipboard, search and filtering are supported.

> **Critical:** The encryption key lives in the `CREDENTIALS_ENC_KEY` environment variable and is
> **not stored** in the database. If you lose or change the key, every record in the vault becomes
> permanently undecryptable. Back up the key somewhere safe alongside the database backup — but
> **not in the same place**.

---

## After the initial setup

1. **Change the seed passwords.** `admin123` / `staff123` are for the demo. If you ran the seed
   in production, change them immediately; if you did not, create the first admin manually.
2. **Define your companies** — locations, categories and per-category SLA targets.
3. **Set up custom fields** — decide what extra information each company's ticket form should ask
   for.
4. **Test SMTP** — verify the global SMTP, define per-company SMTP if needed and send a test
   email from the admin panel. If email does not work, requesters cannot receive their access
   links.
5. **Add staff and assign company scopes** — without a scope, staff **see nothing**
   (fail-closed): the list stays empty until you assign the scope from the `Şirketler`
   (Companies) tab.
6. **Edit the email templates** — the defaults work, but review them for your organization's
   language.
7. **Back up `CREDENTIALS_ENC_KEY`** — if you will use the credential vault.
