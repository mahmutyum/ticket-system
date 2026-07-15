# Takvim Düzeltmeleri + Şifreler Modülü Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Yerinde destek takviminde çoklu/kısa randevu gösterimini düzeltmek ve sadece `admin` rolünün eriştiği şifreli bir "Şifreler" (credential vault) modülü eklemek.

**Architecture:** Takvim tarafı tamamen frontend (randevu süresi `scheduledEnd` ile yazılır, takvim gerçek süreyle çizilir, çakışma uyarısı kalkar). Şifreler tarafı yeni Prisma modeli + AES-256-GCM şifreleme util'i + `requireRole('admin')` korumalı Fastify route modülü + admin'e özel React sayfası.

**Tech Stack:** Fastify + Prisma (PostgreSQL) + Zod (backend), React + React Query + Vite + Tailwind (frontend), Node `crypto` (AES-256-GCM), Vitest (sadece crypto util birim testi).

## Global Constraints

- Commit mesajlarında `Co-Authored-By` satırı **kullanılmaz** (kullanıcı tercihi).
- Yanıt/yorum dili Türkçe; Türkçe karakterler korunur.
- Backend ESM: import yollarında `.js` uzantısı kullanılır (mevcut desen).
- Şifre/not asla düz metin olarak DB'ye yazılmaz veya liste endpoint'inden dönmez.
- Şifreleme anahtarı yalnızca env'de (`CREDENTIALS_ENC_KEY`), repo/DB'de tutulmaz.
- Test altyapısı yok; doğrulama backend için `npm run build` (tsc typecheck) ve crypto için `npx vitest run`, frontend için `npm run build` ve tarayıcıda manuel kontrol ile yapılır.

---

## Bölüm 1 — Takvim Düzeltmeleri

### Task 1: Randevu oluştururken süre seçimi (scheduledEnd)

**Files:**
- Modify: `frontend/src/pages/staff/TicketDetailPage.tsx:23` (state), `:436-491` (form + create isteği)

**Interfaces:**
- Consumes: mevcut `POST /onsite-support` (backend `scheduledEnd` optional alanı zaten mevcut).
- Produces: Randevular artık `scheduledEnd` ile kaydedilir; Task 2 bunu okur.

- [ ] **Step 1: State'e durationMin ekle**

`TicketDetailPage.tsx:23` satırını değiştir:

```tsx
  const [onsiteForm, setOnsiteForm] = useState({ type: 'come_to_it_room', scheduledAt: '', durationMin: 15, roomInfo: '', notes: '' });
```

- [ ] **Step 2: Forma süre seçici ekle**

`:451` ile `:452` arasına (datetime-local input'undan hemen sonra) ekle:

```tsx
                <select
                  className="input-field text-sm"
                  value={onsiteForm.durationMin}
                  onChange={e => setOnsiteForm({ ...onsiteForm, durationMin: Number(e.target.value) })}
                >
                  <option value={10}>10 dakika</option>
                  <option value={15}>15 dakika</option>
                  <option value={30}>30 dakika</option>
                  <option value={60}>60 dakika</option>
                </select>
```

- [ ] **Step 3: Create isteğine scheduledEnd ekle**

`:473-480` arasındaki `api.post` gövdesini değiştir (scheduledEnd ekle):

```tsx
                        await api.post('/onsite-support', {
                          ticketId: id,
                          locationId: ticket.locationId,
                          type: onsiteForm.type,
                          scheduledAt: new Date(onsiteForm.scheduledAt).toISOString(),
                          scheduledEnd: new Date(
                            new Date(onsiteForm.scheduledAt).getTime() + onsiteForm.durationMin * 60000,
                          ).toISOString(),
                          roomInfo: onsiteForm.roomInfo || undefined,
                          notes: onsiteForm.notes || undefined,
                        });
```

- [ ] **Step 4: Form reset'ine durationMin ekle**

`:483` satırını değiştir:

```tsx
                        setOnsiteForm({ type: 'come_to_it_room', scheduledAt: '', durationMin: 15, roomInfo: '', notes: '' });
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npm run build`
Expected: Build başarılı, TS hatası yok.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/staff/TicketDetailPage.tsx
git commit -m "feat(takvim): randevu oluştururken süre seçimi (scheduledEnd)"
```

---

### Task 2: Takvim layout — gerçek süre + çakışma uyarısının kaldırılması

**Files:**
- Modify: `frontend/src/pages/staff/OnsiteSupportPage.tsx` (sabitler, `computeLayout`, `hasDayConflict`, event render)

**Interfaces:**
- Consumes: `event.scheduledAt`, `event.scheduledEnd` (Task 1'de yazılır; eski kayıtlarda `null` olabilir).
- Produces: Yok (sayfa terminal görünüm).

- [ ] **Step 1: Sabitleri güncelle**

`OnsiteSupportPage.tsx:36` (`HOUR_HEIGHT`) değerini 80 yap:

```tsx
const HOUR_HEIGHT = 80; // px
```

- [ ] **Step 2: LayoutItem tipinden conflict'i çıkar**

`:40` satırını değiştir:

```tsx
type LayoutItem = { event: any; col: number; cols: number };
```

- [ ] **Step 3: computeLayout'u gerçek süreyle ve conflict'siz yeniden yaz**

`:43-95` arasındaki `computeLayout` fonksiyonunu tümüyle şununla değiştir:

```tsx
// Bir event'in dakika cinsinden süresi: scheduledEnd varsa ondan, yoksa varsayılan.
function eventDurationMin(e: any, fallback = DEFAULT_DURATION_MIN): number {
  if (!e.scheduledEnd) return fallback;
  const ms = new Date(e.scheduledEnd).getTime() - new Date(e.scheduledAt).getTime();
  const min = Math.round(ms / 60000);
  return min > 0 ? min : fallback;
}

// Interval-overlap lane atama: aynı anda örtüşen event'leri ayrı kolonlara yerleştirir.
// Paralel randevular normaldir; çakışma uyarısı yok.
function computeLayout(events: any[]): LayoutItem[] {
  if (events.length === 0) return [];
  const items = events
    .map((e) => {
      const start = new Date(e.scheduledAt).getTime();
      return { e, start, end: start + eventDurationMin(e) * 60 * 1000 };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const result: LayoutItem[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -Infinity;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const lanes: number[] = []; // her lane'in son bitiş zamanı
    const assignments: number[] = [];
    cluster.forEach((it) => {
      let placed = -1;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] <= it.start) {
          lanes[i] = it.end;
          placed = i;
          break;
        }
      }
      if (placed === -1) {
        lanes.push(it.end);
        placed = lanes.length - 1;
      }
      assignments.push(placed);
    });
    const cols = lanes.length;
    cluster.forEach((it, idx) => {
      result.push({ event: it.e, col: assignments[idx], cols });
    });
  };

  items.forEach((it) => {
    if (cluster.length === 0 || it.start < clusterEnd) {
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.end);
    } else {
      flushCluster();
      cluster = [it];
      clusterEnd = it.end;
    }
  });
  flushCluster();
  return result;
}
```

- [ ] **Step 4: hasDayConflict'i kaldır**

`:97-101` arasındaki `hasDayConflict` fonksiyonunu tamamen sil.

- [ ] **Step 5: Hafta şeridinde conflict kullanımını kaldır**

`:249` satırındaki `const conflict = hasDayConflict(active);` satırını sil. `:283-285` arasındaki `{conflict && (<AlertTriangle ... />)}` bloğunu sil. (Adet rozeti `count` korunur.)

- [ ] **Step 6: Event render'da gerçek yükseklik, conflict stillerini kaldır**

`:356` satırındaki destructuring'i değiştir:

```tsx
              {layout.map(({ event, col, cols }) => {
```

`:362` satırından sonra (widthPct/leftPct hesabının ardından) yükseklik hesabı ekle:

```tsx
                const durationMin = eventDurationMin(event);
                const height = Math.max((durationMin / 60) * HOUR_HEIGHT, 28);
```

`:368-374` arasındaki className koşulundan `conflict` dalını çıkar:

```tsx
                    className={`group absolute rounded-lg p-2 text-xs overflow-hidden border shadow-sm transition-all hover:shadow-lg hover:z-30 hover:overflow-visible ${
                      cancelled
                        ? 'bg-gray-50 dark:bg-slate-800/40 border-gray-200 dark:border-slate-700 opacity-60'
                        : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700'
                    }`}
```

`:375-381` arasındaki `style` nesnesinde `minHeight: 64` yerine `height` kullan:

```tsx
                    style={{
                      top,
                      left: `calc(${leftPct}% + 4px)`,
                      width: `calc(${widthPct}% - 8px)`,
                      height: height - 4,
                      zIndex: 2,
                    }}
```

- [ ] **Step 7: Event içindeki conflict AlertTriangle'ı kaldır**

`:397-402` arasındaki `{conflict && !cancelled && (<AlertTriangle ... />)}` bloğunu sil.

- [ ] **Step 8: Kullanılmayan AlertTriangle importunu temizle**

`:3` import satırından `AlertTriangle`'ı çıkar (başka kullanım kalmadıysa). Build hatası verirse import'tan kaldır.

- [ ] **Step 9: Typecheck**

Run: `cd frontend && npm run build`
Expected: Build başarılı, TS hatası yok.

- [ ] **Step 10: Manuel doğrulama**

Bir ticket'ta aynı saate 10/15/30 dk üç randevu oluştur, `/staff/onsite` aç:
- Üç randevu yan yana üç kolonda, kırmızı uyarı yok.
- Kısa randevu sonraki saate görsel taşmıyor; 30 dk kart 15 dk karttan yüksek.
- Eski (`scheduledEnd` null) kayıt 15 dk yüksekliğiyle bozulmadan görünüyor.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/pages/staff/OnsiteSupportPage.tsx
git commit -m "fix(takvim): gerçek süreyle çizim, paralel randevular için çakışma uyarısını kaldır"
```

---

## Bölüm 2 — Şifreler Modülü

### Task 3: Prisma modeli + config env

**Files:**
- Modify: `backend/prisma/schema.prisma:12-35` (Company ilişkisi), şema sonu (yeni model)
- Modify: `backend/src/config/index.ts:3-29`
- Migration: `prisma migrate dev` ile üretilir

**Interfaces:**
- Produces: `prisma.credentialEntry` modeli; `config.CREDENTIALS_ENC_KEY: string`.

- [ ] **Step 1: Company modeline ters ilişki ekle**

`schema.prisma`'da `model Company` içinde, `assignedStaff  StaffCompany[]` satırının altına ekle:

```prisma
  credentialEntries CredentialEntry[]
```

- [ ] **Step 2: CredentialEntry modelini ekle**

`schema.prisma` dosyasının sonuna (AuditLog'dan sonra) ekle:

```prisma
// ==================== ŞİFRELER (CREDENTIAL VAULT) ====================

model CredentialEntry {
  id          String   @id @default(cuid())
  companyId   String?  @map("company_id")
  title       String
  category    String?
  url         String?
  username    String?
  passwordEnc String   @map("password_enc")
  notesEnc    String?  @map("notes_enc")
  createdById String   @map("created_by_id")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  company Company? @relation(fields: [companyId], references: [id])

  @@index([companyId])
  @@map("credential_entries")
}
```

- [ ] **Step 3: Config'e env değişkeni ekle**

`backend/src/config/index.ts` `envSchema` içine (`UPLOAD_DIR` satırından sonra) ekle:

```ts
  CREDENTIALS_ENC_KEY: z.string().length(64, 'CREDENTIALS_ENC_KEY 64 karakterlik hex olmalı (32 byte)'),
```

- [ ] **Step 4: Geliştirme env'ine anahtar ekle**

`backend/.env` (varsa) içine 32 byte rastgele hex ekle. Anahtar üret:

Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
Çıktıyı `backend/.env` içine `CREDENTIALS_ENC_KEY=<çıktı>` olarak ekle. `docker-compose.yml`'deki backend `environment` bloğuna da `CREDENTIALS_ENC_KEY: ${CREDENTIALS_ENC_KEY}` satırını ekle (gerçek değer host env'inden gelir).

- [ ] **Step 5: Migration üret + client generate**

Run: `cd backend && npx prisma migrate dev --name credential_entries && npm run db:generate`
Expected: `credential_entries` tablosu oluşur, Prisma client güncellenir.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/config/index.ts docker-compose.yml
git commit -m "feat(sifreler): CredentialEntry modeli, migration ve şifreleme env anahtarı"
```

---

### Task 4: AES-256-GCM şifreleme util'i (TDD)

**Files:**
- Create: `backend/src/utils/crypto.ts`
- Create: `backend/tests/utils/crypto.test.ts`

**Interfaces:**
- Consumes: `process.env.CREDENTIALS_ENC_KEY` (Task 3 config'de de doğrulanır). `crypto.ts` `config`'i import ETMEZ — anahtarı lazy olarak `process.env`'den okur; böylece util DB/Redis env'leri olmadan test edilebilir.
- Produces: `encrypt(plain: string): string`, `decrypt(payload: string): string`. Saklanan format `iv:authTag:ciphertext` (her parça base64).

- [ ] **Step 1: Failing test yaz**

`backend/tests/utils/crypto.test.ts` oluştur:

```ts
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.CREDENTIALS_ENC_KEY = '0'.repeat(64); // 32 byte hex
});

describe('crypto util', () => {
  it('encrypt sonra decrypt orijinal metni döndürür', async () => {
    const { encrypt, decrypt } = await import('../../src/utils/crypto.js');
    const plain = 'S3cr3t!Şifre';
    const enc = encrypt(plain);
    expect(enc).not.toContain(plain);
    expect(enc.split(':')).toHaveLength(3);
    expect(decrypt(enc)).toBe(plain);
  });

  it('aynı girdi için farklı IV ile farklı ciphertext üretir', async () => {
    const { encrypt } = await import('../../src/utils/crypto.js');
    expect(encrypt('aynı')).not.toBe(encrypt('aynı'));
  });

  it('bozuk payload decrypt edilince hata fırlatır', async () => {
    const { decrypt } = await import('../../src/utils/crypto.js');
    expect(() => decrypt('bozuk:veri:burada')).toThrow();
  });
});
```

- [ ] **Step 2: Testi çalıştır, fail olduğunu gör**

Run: `cd backend && npx vitest run tests/utils/crypto.test.ts`
Expected: FAIL — `src/utils/crypto.js` bulunamadı.

- [ ] **Step 3: crypto.ts implement et**

`backend/src/utils/crypto.ts` oluştur:

```ts
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';

/** Anahtarı çağrı anında process.env'den okur (config'e bağımlı değil — test edilebilir). */
function getKey(): Buffer {
  const hex = process.env.CREDENTIALS_ENC_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('CREDENTIALS_ENC_KEY 64 karakterlik hex (32 byte) olmalı');
  }
  return Buffer.from(hex, 'hex');
}

/** Düz metni AES-256-GCM ile şifreler. Çıktı: "iv:authTag:ciphertext" (base64). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** "iv:authTag:ciphertext" formatındaki payload'ı çözer. Bozuksa hata fırlatır. */
export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Geçersiz şifreli veri formatı');
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4: Testi çalıştır, pass olduğunu gör**

Run: `cd backend && npx vitest run tests/utils/crypto.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/crypto.ts backend/tests/utils/crypto.test.ts
git commit -m "feat(sifreler): AES-256-GCM şifreleme util + birim testleri"
```

---

### Task 5: Credentials backend route modülü

**Files:**
- Create: `backend/src/modules/credentials/credentials.routes.ts`
- Modify: `backend/src/app.ts:29` (import), `:108` (register)

**Interfaces:**
- Consumes: `encrypt`/`decrypt` (Task 4), `app.requireRole` (auth plugin), `createAuditLog` (`middleware/audit.ts`).
- Produces: `/credentials` REST uçları. Liste şifre döndürmez; `/:id/reveal` çözülmüş `{ password, notes }` döner.

- [ ] **Step 1: Route modülünü oluştur**

`backend/src/modules/credentials/credentials.routes.ts`:

```ts
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { createAuditLog } from '../../middleware/audit.js';

const createSchema = z.object({
  title: z.string().min(1),
  category: z.string().optional(),
  url: z.string().optional(),
  username: z.string().optional(),
  password: z.string().min(1),
  notes: z.string().optional(),
  companyId: z.string().cuid().optional(),
});

const updateSchema = createSchema.partial();

export const credentialRoutes: FastifyPluginAsync = async (app) => {
  // Liste — şifre/not DÖNMEZ
  app.get('/', { preHandler: [app.requireRole('admin')] }, async (request, reply) => {
    const { companyId } = request.query as { companyId?: string };
    const entries = await app.prisma.credentialEntry.findMany({
      where: companyId ? { companyId } : {},
      orderBy: { title: 'asc' },
      select: {
        id: true, title: true, category: true, url: true, username: true,
        companyId: true, createdAt: true, updatedAt: true,
        company: { select: { name: true } },
      },
    });
    reply.send({ success: true, data: entries });
  });

  // Reveal — çözülmüş şifre + not, audit log'lanır
  app.get('/:id/reveal', { preHandler: [app.requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await app.prisma.credentialEntry.findUnique({ where: { id } });
    if (!entry) return reply.status(404).send({ success: false, error: 'Kayıt bulunamadı' });

    await createAuditLog({
      entityType: 'credential',
      entityId: id,
      action: 'credential_reveal',
      changes: { title: entry.title },
      performedBy: request.staffUser!.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });

    reply.send({
      success: true,
      data: { password: decrypt(entry.passwordEnc), notes: entry.notesEnc ? decrypt(entry.notesEnc) : null },
    });
  });

  // Oluştur
  app.post('/', { preHandler: [app.requireRole('admin')] }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const entry = await app.prisma.credentialEntry.create({
      data: {
        title: body.title,
        category: body.category,
        url: body.url,
        username: body.username,
        passwordEnc: encrypt(body.password),
        notesEnc: body.notes ? encrypt(body.notes) : undefined,
        companyId: body.companyId,
        createdById: request.staffUser!.id,
      },
      select: { id: true, title: true },
    });
    await createAuditLog({
      entityType: 'credential', entityId: entry.id, action: 'create',
      changes: { title: body.title }, performedBy: request.staffUser!.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });
    reply.status(201).send({ success: true, data: entry });
  });

  // Güncelle
  app.put('/:id', { preHandler: [app.requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateSchema.parse(request.body);
    const data: any = {
      title: body.title, category: body.category, url: body.url,
      username: body.username, companyId: body.companyId,
    };
    if (body.password !== undefined) data.passwordEnc = encrypt(body.password);
    if (body.notes !== undefined) data.notesEnc = body.notes ? encrypt(body.notes) : null;

    const entry = await app.prisma.credentialEntry.update({
      where: { id }, data, select: { id: true, title: true },
    });
    await createAuditLog({
      entityType: 'credential', entityId: id, action: 'update',
      changes: { title: entry.title }, performedBy: request.staffUser!.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });
    reply.send({ success: true, data: entry });
  });

  // Sil
  app.delete('/:id', { preHandler: [app.requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.prisma.credentialEntry.delete({ where: { id } });
    await createAuditLog({
      entityType: 'credential', entityId: id, action: 'delete',
      changes: {}, performedBy: request.staffUser!.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });
    reply.send({ success: true });
  });
};
```

- [ ] **Step 2: createAuditLog imzasını doğrula**

Run: `grep -n "export.*createAuditLog\|function createAuditLog\|interface" backend/src/middleware/audit.ts`
Expected: `createAuditLog`'un parametre alanları (`entityType, entityId, action, changes, performedBy, ipAddress`) yukarıdaki çağrılarla eşleşmeli. Farklıysa çağrıları gerçek imzaya uyarla.

- [ ] **Step 3: app.ts'e import ve register ekle**

`backend/src/app.ts:29` civarına (taskRoutes importundan sonra) ekle:

```ts
import { credentialRoutes } from './modules/credentials/credentials.routes.js';
```

`:108` civarına (taskRoutes register'ından sonra) ekle:

```ts
  await app.register(credentialRoutes, { prefix: '/credentials' });
```

- [ ] **Step 4: Typecheck**

Run: `cd backend && npm run build`
Expected: Build başarılı, TS hatası yok.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/credentials backend/src/app.ts
git commit -m "feat(sifreler): admin korumalı credentials REST modülü (reveal audit log'lu)"
```

---

### Task 6: Frontend Şifreler sayfası

**Files:**
- Create: `frontend/src/pages/staff/PasswordsPage.tsx`
- Modify: `frontend/src/App.tsx:107` (route + import)
- Modify: `frontend/src/components/layout/StaffLayout.tsx:16,22-31,71` (nav linki + rol filtresi)

**Interfaces:**
- Consumes: `/credentials` REST uçları (Task 5), `api` client, `useAuthStore` (rol).
- Produces: Yok (terminal sayfa).

- [ ] **Step 1: PasswordsPage oluştur**

`frontend/src/pages/staff/PasswordsPage.tsx`:

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Eye, Copy, Trash2, Pencil, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';

type Entry = {
  id: string; title: string; category?: string | null; url?: string | null;
  username?: string | null; companyId?: string | null; company?: { name: string } | null;
};

const empty = { title: '', category: '', url: '', username: '', password: '', notes: '', companyId: '' };

export default function PasswordsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const { data: entries } = useQuery<Entry[]>({
    queryKey: ['credentials'],
    queryFn: async () => (await api.get('/credentials')).data.data,
  });
  const { data: companies } = useQuery<any[]>({
    queryKey: ['companies-min'],
    queryFn: async () => (await api.get('/companies')).data.data,
  });

  const filtered = (entries || []).filter((e) =>
    [e.title, e.category, e.username, e.company?.name].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase()),
  );

  const reveal = async (id: string) => {
    try {
      const { password } = (await api.get(`/credentials/${id}/reveal`)).data.data;
      setRevealed((r) => ({ ...r, [id]: password }));
      setTimeout(() => setRevealed((r) => { const { [id]: _, ...rest } = r; return rest; }), 8000);
    } catch { toast.error('Şifre alınamadı'); }
  };

  const copy = async (id: string) => {
    try {
      const { password } = (await api.get(`/credentials/${id}/reveal`)).data.data;
      await navigator.clipboard.writeText(password);
      toast.success('Şifre kopyalandı');
    } catch { toast.error('Kopyalanamadı'); }
  };

  const openCreate = () => { setEditId(null); setForm({ ...empty }); setShowForm(true); };
  const openEdit = (e: Entry) => {
    setEditId(e.id);
    setForm({ title: e.title, category: e.category || '', url: e.url || '', username: e.username || '', password: '', notes: '', companyId: e.companyId || '' });
    setShowForm(true);
  };

  const save = async () => {
    const payload: any = {
      title: form.title, category: form.category || undefined, url: form.url || undefined,
      username: form.username || undefined, notes: form.notes || undefined,
      companyId: form.companyId || undefined,
    };
    if (form.password) payload.password = form.password;
    try {
      if (editId) await api.put(`/credentials/${editId}`, payload);
      else await api.post('/credentials', { ...payload, password: form.password });
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      setShowForm(false);
      toast.success('Kaydedildi');
    } catch { toast.error('Kaydedilemedi'); }
  };

  const remove = async (id: string) => {
    if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/credentials/${id}`);
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      toast.success('Silindi');
    } catch { toast.error('Silinemedi'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Şifreler</h1>
        <button onClick={openCreate} className="btn-primary text-sm flex items-center gap-1">
          <Plus className="w-4 h-4" /> Yeni Kayıt
        </button>
      </div>

      <label className="relative block max-w-sm">
        <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input-field !pl-8 text-sm" placeholder="Ara..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted border-b border-gray-200 dark:border-slate-800">
            <tr>
              <th className="px-4 py-2">Başlık</th>
              <th className="px-4 py-2">Kategori</th>
              <th className="px-4 py-2">Kullanıcı Adı</th>
              <th className="px-4 py-2">Şifre</th>
              <th className="px-4 py-2">Şirket</th>
              <th className="px-4 py-2 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-b border-gray-100 dark:border-slate-800/60">
                <td className="px-4 py-2 font-medium">{e.title}</td>
                <td className="px-4 py-2 text-muted">{e.category || '-'}</td>
                <td className="px-4 py-2">{e.username || '-'}</td>
                <td className="px-4 py-2 font-mono">
                  {revealed[e.id] ? (
                    <span>{revealed[e.id]}</span>
                  ) : (
                    <button onClick={() => reveal(e.id)} className="inline-flex items-center gap-1 text-primary-600 hover:underline">
                      <Eye className="w-3.5 h-3.5" /> Göster
                    </button>
                  )}
                </td>
                <td className="px-4 py-2 text-muted">{e.company?.name || '-'}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => copy(e.id)} title="Kopyala" className="text-gray-500 hover:text-primary-600"><Copy className="w-4 h-4" /></button>
                    <button onClick={() => openEdit(e)} title="Düzenle" className="text-gray-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => remove(e.id)} title="Sil" className="text-gray-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">Kayıt yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{editId ? 'Kaydı Düzenle' : 'Yeni Kayıt'}</h3>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5" /></button>
            </div>
            <input className="input-field text-sm" placeholder="Başlık (hizmet/servis adı)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input className="input-field text-sm" placeholder="Kategori" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <select className="input-field text-sm" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
              <option value="">Şirket (opsiyonel)</option>
              {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className="input-field text-sm" placeholder="URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <input className="input-field text-sm" placeholder="Kullanıcı adı" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <input className="input-field text-sm" type="text" placeholder={editId ? 'Şifre (değiştirmek için doldurun)' : 'Şifre'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <textarea className="input-field text-sm" rows={2} placeholder="Not" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="flex gap-2">
              <button className="btn-primary text-sm flex-1" onClick={save} disabled={!form.title || (!editId && !form.password)}>Kaydet</button>
              <button className="btn-secondary text-sm flex-1" onClick={() => setShowForm(false)}>İptal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: App.tsx'e route ekle**

`frontend/src/App.tsx` import bölümüne (diğer sayfa importları yanına) ekle:

```tsx
import PasswordsPage from './pages/staff/PasswordsPage';
```

`:107` civarına (`tasks` route'undan sonra) ekle:

```tsx
          <Route
            path="passwords"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <PasswordsPage />
              </ProtectedRoute>
            }
          />
```

- [ ] **Step 3: StaffLayout nav'a rol filtreli link ekle**

`StaffLayout.tsx:16` import'una `KeyRound` ekle:

```tsx
  Moon,
  Sun,
  KeyRound,
```

`navItems` dizisine (`:30` templates satırından sonra) ekle:

```tsx
  { path: '/staff/passwords', label: 'Şifreler', icon: KeyRound, roles: ['admin'] },
```

`navItems.map`'i rol filtresiyle sar — `:71` satırını değiştir:

```tsx
          {navItems.filter((item) => !(item as any).roles || (item as any).roles.includes(user?.role)).map((item) => {
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run build`
Expected: Build başarılı, TS hatası yok.

- [ ] **Step 5: Manuel doğrulama**

- `admin` ile giriş: sol menüde "Şifreler" görünür, `/staff/passwords` açılır, kayıt eklenip "Göster"/Kopyala çalışır.
- `it_staff`/`it_manager` ile: menüde link yok; `/staff/passwords`'a gidince ana sayfaya yönlenir.
- DB'de `prisma studio` ile `credential_entries.password_enc` okunabilir düz metin değil.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/staff/PasswordsPage.tsx frontend/src/App.tsx frontend/src/components/layout/StaffLayout.tsx
git commit -m "feat(sifreler): admin'e özel Şifreler sayfası, route ve menü linki"
```

---

## Self-Review Notları

- **Spec kapsamı:** Bölüm 1 (süre seçimi + layout düzeltme) → Task 1-2. Bölüm 2 (model+config → Task 3, crypto → Task 4, backend → Task 5, frontend → Task 6). Tüm spec gereksinimleri karşılandı.
- **Tip tutarlılığı:** `encrypt/decrypt` imzaları Task 4 ↔ Task 5'te tutarlı; `eventDurationMin`/`computeLayout` Task 2 içinde tutarlı; `scheduledEnd` Task 1 (yazma) ↔ Task 2 (okuma) tutarlı.
- **Belirsizlik:** `createAuditLog` imzası Task 5 Step 2'de doğrulanır (mevcut `onsite.routes.ts` aynı alanları kullanıyor — büyük olasılıkla birebir uyumlu).
- **Doğrulama:** TDD yalnızca DB'siz çalışan crypto util'inde (gerçek vitest); route/frontend için typecheck + manuel — mevcut kod tabanında test altyapısı olmadığından bilinçli tercih.
