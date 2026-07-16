/**
 * API yanıt mesajları sözlüğü (TR/EN).
 *
 * Her modül kendi mesajlarını `messages/<modül>.ts` içinde `{ tr, en }` olarak tutar
 * (anahtarlar `modül.` ile öneklenir, çakışma olmaz). Burada hepsi tek düz sözlüğe
 * birleştirilir. Yeni bir modül eklerken import + spread satırı eklenmeli.
 */
import { commonMessages } from './messages/common.js';
import { ticketsMessages } from './messages/tickets.js';
import { tasksMessages } from './messages/tasks.js';
import { companiesMessages } from './messages/companies.js';
import { authMessages } from './messages/auth.js';
import { credentialsMessages } from './messages/credentials.js';
import { attachmentsMessages } from './messages/attachments.js';
import { onsiteMessages } from './messages/onsite.js';
import { categoriesMessages } from './messages/categories.js';
import { notesMessages } from './messages/notes.js';
import { locationsMessages } from './messages/locations.js';
import { eventsMessages } from './messages/events.js';
import { customFieldsMessages } from './messages/customFields.js';
import { notificationsMessages } from './messages/notifications.js';
import { templatesMessages } from './messages/templates.js';
import { staffMessages } from './messages/staff.js';

export type AppLocale = 'tr' | 'en';

const modules = [
  commonMessages,
  ticketsMessages,
  tasksMessages,
  companiesMessages,
  authMessages,
  credentialsMessages,
  attachmentsMessages,
  onsiteMessages,
  categoriesMessages,
  notesMessages,
  locationsMessages,
  eventsMessages,
  customFieldsMessages,
  notificationsMessages,
  templatesMessages,
  staffMessages,
];

function merge(locale: AppLocale): Record<string, string> {
  return Object.assign({}, ...modules.map((m) => m[locale]));
}

export const messages: Record<AppLocale, Record<string, string>> = {
  tr: merge('tr'),
  en: merge('en'),
};
