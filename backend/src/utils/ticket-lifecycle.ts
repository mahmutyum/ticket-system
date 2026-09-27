import { TicketStatus } from '@prisma/client';
import type { BusinessCalendar } from './business-hours.js';
import { isSlaMet, shiftAfterPause, slaMinutesBetween } from './sla.js';
import { SLA_FINAL_STATUSES, SLA_PAUSING_STATUSES, PUBLIC_ACCESS_RETENTION_DAYS } from '../config/constants.js';

/**
 * Ticket durum geçişlerinin SLA/yaşam döngüsü etkileri — TEK kaynak.
 *
 * Eskiden bu mantık yalnızca `PUT /tickets/:id` içindeydi; toplu güncelleme ve
 * public "kullanıcı yanıtı" akışı durumu doğrudan yazıyor, ilk yanıt/çözüm
 * zamanlarını, erişim linki süresini ve geçmiş kaydını atlıyordu. Tüm durum
 * değiştiren yollar artık bu planlayıcıdan geçer.
 *
 * SAF fonksiyon: mevcut durumu ve hedefi alır, uygulanacak alanları ve geçmiş
 * kayıtlarını döner. Veritabanına dokunmaz.
 */

export interface TicketLifecycleState {
  status: TicketStatus;
  firstRespondedAt: Date | null;
  resolvedAt: Date | null;
  slaResponseDue: Date | null;
  slaResolveDue: Date | null;
  slaResponseMet: boolean | null;
  slaResolveMet: boolean | null;
  slaResponseWarnAt: Date | null;
  slaResolveWarnAt: Date | null;
  slaPausedAt: Date | null;
  slaPausedMinutes: number;
}

export interface LifecycleUpdate {
  status?: TicketStatus;
  firstRespondedAt?: Date;
  resolvedAt?: Date;
  closedAt?: Date;
  slaResponseDue?: Date | null;
  slaResolveDue?: Date | null;
  slaResponseMet?: boolean | null;
  slaResolveMet?: boolean | null;
  slaResponseWarnAt?: Date | null;
  slaResolveWarnAt?: Date | null;
  slaPausedAt?: Date | null;
  slaPausedMinutes?: number;
  accessTokenExpiresAt?: Date | null;
  statusChangedAt?: Date;
  autoCloseReminderAt?: Date | null;
}

export interface LifecycleHistory {
  action: string;
  field?: string;
  oldValue?: string | null;
  newValue?: string | null;
  createdById?: string | null;
  createdByEmail?: string | null;
}

export interface Actor {
  id?: string | null;
  email?: string | null;
}

export interface LifecyclePlan {
  data: LifecycleUpdate;
  history: LifecycleHistory[];
}

const isPausing = (s: TicketStatus) => SLA_PAUSING_STATUSES.includes(s);
const isFinal = (s: TicketStatus) => SLA_FINAL_STATUSES.includes(s);

/**
 * İlk yanıtı işaretler (henüz işaretlenmemişse). Personelin durum değiştirmesi ya
 * da talep sahibine görünen bir not eklemesi "yanıt" sayılır.
 */
export function planFirstResponse(ticket: TicketLifecycleState, now: Date): LifecycleUpdate {
  if (ticket.firstRespondedAt) return {};
  return {
    firstRespondedAt: now,
    slaResponseMet: ticket.slaResponseMet ?? isSlaMet(ticket.slaResponseDue, now),
    slaResponseWarnAt: null,
  };
}

export function planStatusTransition(
  ticket: TicketLifecycleState,
  to: TicketStatus,
  now: Date,
  calendar: BusinessCalendar | null,
  actor: Actor = {},
): LifecyclePlan {
  const from = ticket.status;
  if (to === from) return { data: {}, history: [] };

  const who = { createdById: actor.id ?? null, createdByEmail: actor.email ?? null };
  // Otomatik kapatma süreleri son durum değişikliğinden sayılır; önceki durumun
  // hatırlatması yeni durumda geçersizdir.
  const data: LifecycleUpdate = { status: to, statusChangedAt: now, autoCloseReminderAt: null };
  const history: LifecycleHistory[] = [
    { action: 'status_changed', field: 'status', oldValue: from, newValue: to, ...who },
  ];

  // Geçerli son tarihler — duraklatmadan çıkılıyorsa önce ileri kaydırılır ki
  // aşağıdaki "tutturuldu mu" hesapları kaydırılmış tarihlere göre yapılsın.
  let responseDue = ticket.slaResponseDue;
  let resolveDue = ticket.slaResolveDue;

  if (ticket.slaPausedAt && !isPausing(to)) {
    const pausedAt = ticket.slaPausedAt;
    if (ticket.slaResponseMet === null && !ticket.firstRespondedAt) {
      responseDue = shiftAfterPause(responseDue, pausedAt, now, calendar);
      data.slaResponseDue = responseDue;
      data.slaResponseWarnAt = shiftAfterPause(ticket.slaResponseWarnAt, pausedAt, now, calendar);
    }
    if (ticket.slaResolveMet === null) {
      resolveDue = shiftAfterPause(resolveDue, pausedAt, now, calendar);
      data.slaResolveDue = resolveDue;
      data.slaResolveWarnAt = shiftAfterPause(ticket.slaResolveWarnAt, pausedAt, now, calendar);
    }
    const paused = slaMinutesBetween(pausedAt, now, calendar);
    data.slaPausedAt = null;
    data.slaPausedMinutes = ticket.slaPausedMinutes + paused;
    history.push({ action: 'sla_resumed', field: 'sla', newValue: String(paused), ...who });
  }

  // İlk yanıt: `open`'dan herhangi bir duruma geçiş (kullanıcıya soru sormak için
  // "yanıt bekleniyor"a almak da bir yanıttır).
  if (to !== TicketStatus.open && !ticket.firstRespondedAt) {
    Object.assign(data, planFirstResponse({ ...ticket, slaResponseDue: responseDue }, now));
  }

  if (to === TicketStatus.resolved || (to === TicketStatus.closed && !ticket.resolvedAt)) {
    data.resolvedAt = now;
    if (ticket.slaResolveMet === null) data.slaResolveMet = isSlaMet(resolveDue, now);
    data.slaResolveWarnAt = null;
  }
  if (to === TicketStatus.closed) data.closedAt = now;

  if (isPausing(to) && !ticket.slaPausedAt) {
    data.slaPausedAt = now;
    history.push({ action: 'sla_paused', field: 'sla', newValue: to, ...who });
  }

  // Public takip linkine SON VER / geri aç.
  //
  // Link nginx access_log'una, e-postalara ve tarayıcı geçmişine düşer;
  // süresiz kalırsa tek bir sızıntı o ticket'a kalıcı erişim demektir.
  // Talep eden kapanıştan sonra da bir süre sonucu görebilmeli — bu yüzden
  // iptal değil, saklama süreli sona erdirme.
  if (isFinal(to)) {
    data.accessTokenExpiresAt = new Date(now.getTime() + PUBLIC_ACCESS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  } else if (isFinal(from)) {
    // Yeniden açıldı → link tekrar süresiz.
    data.accessTokenExpiresAt = null;
  }

  return { data, history };
}
