import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { TICKET_STATUSES, PRIORITIES, TASK_STATUSES, ONSITE_TYPES, ONSITE_STATUSES, COMPANY_GROUP_TYPES } from '../config/constants.js';

/**
 * Sözlük servis katmanı (v1.3) — dict_* tablolarının BELLEK + Redis önbekesi.
 *
 * Davranış kodu artık anahtar literal'lerine değil SINIFLARA ve bu servis
 * döndürdüğü anahtar kümelerine bakar:
 *   - SLA duraklatma  → keysWithClass('ticketStatus', 'waiting')
 *   - otomatik kapatma → keysWithClass('ticketStatus', 'resolved')
 *   - eskalasyon      → priorities weight sıralaması
 *   - Zod doğrulama   → activeKeys(kind) kümesi
 *
 * Önbellek: süreç içi Map (senkron okuma için) + Redis (çoklu replika).
 * `invalidateDictionaries()` panelden yapılan her değişiklikte çağrılır; diğer
 * replikalar Redis pub/sub yerine kısa TTL'e güvenir (5 dk — kabul edilebilir
 * yayılma süresi; replikalar arası anlık tutarlılık bu sürümde gerekmez).
 *
 * Açılışta `loadDictionaries()` çağrılır; DB erişilemezse SİSTEM VARSAYILANLARIYLA
 * (config/constants.ts shim'leri — enum değerlerinin karşılıkları) başlar ve
 * uyarı verir: bozuk DB'de sunucu düşmez, varsayılan sözlükle koşar.
 */

export type DictionaryKind =
  | 'ticketStatuses'
  | 'priorities'
  | 'taskStatuses'
  | 'onsiteTypes'
  | 'onsiteStatuses'
  | 'companyTypes';

export interface DictionaryEntry {
  key: string;
  labelTr: string;
  labelEn: string;
  color: string | null;
  sortOrder: number;
  statusClass?: string;
  weight?: number;
  isActive: boolean;
  isSystem: boolean;
}

interface DictionaryState {
  loaded: boolean;
  fromDb: boolean;
  entries: Record<DictionaryKind, DictionaryEntry[]>;
  activeKeys: Record<DictionaryKind, Set<string>>;
}

const CACHE_KEY = 'lookups:cache:v1';
const CACHE_TTL_SECONDS = 300;

/** DB erişimi dinamik: saf tüketenler (utils) redis/prisma yüklemadan kullanır. */
async function getDb(): Promise<Pick<PrismaClient, '$queryRaw'>> {
  const { prisma } = await import('../db.js');
  return prisma;
}

async function redis(): Promise<{ set: (...a: unknown[]) => Promise<unknown>; get: (...a: unknown[]) => Promise<string | null>; del: (...a: unknown[]) => Promise<unknown> }> {
  const { redisConnection } = await import('../jobs/queue.js');
  return redisConnection as unknown as { set: (...a: unknown[]) => Promise<unknown>; get: (...a: unknown[]) => Promise<string | null>; del: (...a: unknown[]) => Promise<unknown> };
}

const state: DictionaryState = {
  loaded: false,
  fromDb: false,
  entries: {
    ticketStatuses: [], priorities: [], taskStatuses: [], onsiteTypes: [], onsiteStatuses: [], companyTypes: [],
  },
  activeKeys: {
    ticketStatuses: new Set(), priorities: new Set(), taskStatuses: new Set(), onsiteTypes: new Set(), onsiteStatuses: new Set(), companyTypes: new Set(),
  },
};

/** Sistem varsayılanları — enum değerlerinin karşılıkları (shim'lerden üretilir). */
function systemDefaults(): Record<DictionaryKind, DictionaryEntry[]> {
  const colorOf: Record<string, string> = {
    open: 'blue', in_progress: 'yellow', resolved: 'green', closed: 'gray', done: 'green',
    cancelled: 'red', scheduled: 'blue', completed: 'green', call_center: 'blue',
    corporate: 'indigo', warehouse: 'gray', retail: 'orange',
    low: 'gray', medium: 'blue', high: 'orange', critical: 'red',
  };
  const classOf: Record<string, string> = {
    open: 'new', in_progress: 'active', topic_transferred: 'active',
    waiting_user_response: 'waiting', waiting_other_department: 'waiting',
    process_outside_it: 'waiting', on_hold: 'waiting', resolved: 'resolved', closed: 'closed',
  };
  const entry = (key: string, labelTr: string, labelEn: string, extra: Partial<DictionaryEntry> = {}): DictionaryEntry => ({
    key, labelTr, labelEn, color: colorOf[key] ?? 'gray', sortOrder: 0, isActive: true, isSystem: true, ...extra,
  });
  return {
    ticketStatuses: Object.keys(TICKET_STATUSES).map((key, i) =>
      entry(key, key, key, { sortOrder: i + 1, statusClass: classOf[key] ?? 'active' })),
    priorities: Object.keys(PRIORITIES).map((key, i) =>
      entry(key, key, key, { weight: i + 1, sortOrder: i + 1 })),
    taskStatuses: Object.keys(TASK_STATUSES).map((key, i) => entry(key, key, key, { sortOrder: i + 1 })),
    onsiteTypes: Object.keys(ONSITE_TYPES).map((key, i) => entry(key, key, key, { sortOrder: i + 1 })),
    onsiteStatuses: Object.keys(ONSITE_STATUSES).map((key, i) => entry(key, key, key, { sortOrder: i + 1 })),
    companyTypes: Object.keys(COMPANY_GROUP_TYPES).map((key, i) => entry(key, key, key, { sortOrder: i + 1 })),
  };
}

function applyEntries(entries: Record<DictionaryKind, DictionaryEntry[]>, fromDb: boolean): void {
  state.entries = entries;
  state.fromDb = fromDb;
  for (const kind of Object.keys(entries) as DictionaryKind[]) {
    state.activeKeys[kind] = new Set(entries[kind].filter((e) => e.isActive).map((e) => e.key));
  }
  state.loaded = true;
}

/** dict_* tablolarını okuyup bellek + Redis önbeline yazar. */
export async function loadDictionaries(db?: Pick<PrismaClient, '$queryRaw'>): Promise<void> {
  try {
    const database = db ?? (await getDb());
    const rows = await database.$queryRaw<Array<{
      kind: string; key: string; label_tr: string; label_en: string; color: string | null;
      sort_order: number; status_class: string | null; weight: number | null;
      is_active: boolean; is_system: boolean;
    }>>`
      SELECT 'ticketStatuses' AS kind, key, label_tr, label_en, color, sort_order,
             status_class::text AS status_class, NULL::int AS weight, is_active, is_system
        FROM dict_ticket_statuses
      UNION ALL
      SELECT 'priorities', key, label_tr, label_en, color, sort_order,
             NULL::text, weight, is_active, is_system
        FROM dict_priorities
      UNION ALL
      SELECT 'taskStatuses', key, label_tr, label_en, color, sort_order,
             NULL::text, NULL::int, is_active, is_system
        FROM dict_task_statuses
      UNION ALL
      SELECT 'onsiteTypes', key, label_tr, label_en, NULL, sort_order,
             NULL::text, NULL::int, is_active, is_system
        FROM dict_onsite_types
      UNION ALL
      SELECT 'onsiteStatuses', key, label_tr, label_en, color, sort_order,
             NULL::text, NULL::int, is_active, is_system
        FROM dict_onsite_statuses
      UNION ALL
      SELECT 'companyTypes', key, label_tr, label_en, color, sort_order,
             NULL::text, NULL::int, is_active, is_system
        FROM dict_company_types
    `;
    const entries: Record<DictionaryKind, DictionaryEntry[]> = {
      ticketStatuses: [], priorities: [], taskStatuses: [], onsiteTypes: [], onsiteStatuses: [], companyTypes: [],
    };
    for (const row of rows) {
      (entries[row.kind as DictionaryKind] ??= []).push({
        key: row.key, labelTr: row.label_tr, labelEn: row.label_en, color: row.color,
        sortOrder: row.sort_order, statusClass: row.status_class ?? undefined,
        weight: row.weight ?? undefined, isActive: row.is_active, isSystem: row.is_system,
      });
    }
    applyEntries(entries, true);
    // Çoklu replika: kısa TTL'li Redis kopyası (diğer replikalar bunu okur).
    await (await redis()).set(CACHE_KEY, JSON.stringify(entries), 'EX', CACHE_TTL_SECONDS).catch(() => {});
  } catch (err) {
    applyEntries(systemDefaults(), false);
    console.error('[Lookups] DB sözlükleri okunamadı — sistem varsayılanlarıyla başlandı', err);
  }
}

/** Panelden yapılan değişiklikten sonra çağrılır: bellek + Redis tazelenir. */
export async function invalidateDictionaries(db?: Pick<PrismaClient, '$queryRaw'>): Promise<void> {
  await loadDictionaries(db);
  await (await redis()).del(CACHE_KEY).catch(() => {});
}

/**
 * Diğer replikaların önbelleğini tazeler: Redis kopyası varsa onu uygular,
 * yoksa DB'den yeniden yükler. Her istekte değil, yalnızca önbellek boşken
 * çağrılır (boot sonrası ilk erişim + TTL sonu).
 */
export async function refreshFromSharedCacheIfAny(): Promise<void> {
  const raw = await (await redis()).get(CACHE_KEY).catch(() => null);
  if (raw) {
    applyEntries(JSON.parse(raw) as Record<DictionaryKind, DictionaryEntry[]>, true);
  } else {
    await loadDictionaries();
  }
}

/**
 * Senkron erişim güvencesi: hiç yüklenmemişse SİSTEM VARSAYILANLARIYLA başlar
 * (async DB yüklemesi boot'ta `loadDictionaries()` ile gelir). Böylece saf
 * tüketenler (lifecycle, birim testleri) Redis/DB'siz çalışır ve sınıf
 * semantiği enum karşılıklarıyla birebir uyar.
 */
export function ensureLoaded(): void {
  if (!state.loaded) applyEntries(systemDefaults(), false);
}

/** Aktif anahtar kümesi — Zod doğrulama bunu kullanır (senkron). */
export function activeKeys(kind: DictionaryKind): Set<string> {
  ensureLoaded();
  return state.activeKeys[kind];
}

/** Sözlük girdileri (aktif + pasif; panel görseli için). */
export function entriesOf(kind: DictionaryKind): DictionaryEntry[] {
  ensureLoaded();
  return [...state.entries[kind]].sort((a, b) =>
    a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

/** Verilen davranış SINIFINA giren aktif anahtarlar (ör. 'waiting' → SLA durur). */
export function keysWithClass(kind: 'ticketStatuses', statusClass: string): string[] {
  ensureLoaded();
  return state.entries[kind]
    .filter((e) => e.isActive && e.statusClass === statusClass)
    .map((e) => e.key);
}

/**
 * Sözlük anahtarı için Zod doğrulayıcı: `z.nativeEnum(...)` yerine geçer.
 * Aktif anahtar kümesi bellekten okunur (senkron); bilinmeyen/pasif anahtar
 * 400 ile reddedilir. Pasifleştirme sonrası eski anahtarlarla yeni kayıt
 * oluşturulamaz, mevcut kayıtlar görünmeye devam eder.
 */
export type LookupKind =
  | 'ticketStatus' | 'priority' | 'taskStatus'
  | 'onsiteType' | 'onsiteStatus' | 'companyType';

const LOOKUP_TO_DICTIONARY: Record<LookupKind, DictionaryKind> = {
  ticketStatus: 'ticketStatuses',
  priority: 'priorities',
  taskStatus: 'taskStatuses',
  onsiteType: 'onsiteTypes',
  onsiteStatus: 'onsiteStatuses',
  companyType: 'companyTypes',
};

export function zLookupKey(kind: LookupKind): z.ZodType<string> {
  const dictionaryKind = LOOKUP_TO_DICTIONARY[kind];
  return z.string().min(1).max(64).refine((value) => activeKeys(dictionaryKind).has(value), {
    message: `Geçersiz ${kind} anahtarı`,
  });
}

/** Anahtar, verilen davranış sınıfında mı? (senkron — bellekten) */
export function isClassStatus(kind: 'ticketStatuses', key: string, statusClass: string): boolean {
  ensureLoaded();
  const entry = state.entries[kind].find((e) => e.key === key && e.isActive);
  return entry?.statusClass === statusClass;
}

/** SLA saatini durduran ('waiting' sınıfı) anahtar mı? */
export function isPausingStatus(key: string): boolean {
  return isClassStatus('ticketStatuses', key, 'waiting');
}

/** SLA'nın bittiği ('resolved' veya 'closed' sınıfı) anahtar mı? */
export function isFinalStatus(key: string): boolean {
  return isClassStatus('ticketStatuses', key, 'resolved') || isClassStatus('ticketStatuses', key, 'closed');
}

/** Öncelik ağırlığı — eskalasyon sıralaması için (bilinmeyen anahtar → 0). */
export function priorityWeight(key: string): number {
  ensureLoaded();
  return state.entries.priorities.find((e) => e.key === key && e.isActive)?.weight ?? 0;
}

/** Sözlük DB'den mi yüklenendi, yoksa sistem varsayılanları mı? (sağlık için) */
export function isFromDb(): boolean {
  return state.fromDb;
}
