import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Clock, Copy, Plus, Trash2, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { useEnumLabels } from '../../i18n/labels';
import { getApiError } from '../../utils/api-error';
import { PRIORITY_VALUES, WEEKDAYS, type SlaSettings, type TimeWindow, type Weekday } from './sla-settings';

type Holiday = { id: string; date: string; name: string };
type SlaData = { settings: SlaSettings; defaultWeek: Partial<Record<Weekday, TimeWindow[]>>; holidays: Holiday[] };

/** Tarayıcının saat dilimi — yeni takvim için makul varsayılan. */
const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Istanbul';

export function SlaSettingsModal({ companyId, companyName, onClose }: {
  companyId: string;
  companyName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const labels = useEnumLabels();
  const queryClient = useQueryClient();
  const queryKey = ['company-sla', companyId];

  const { data, isLoading } = useQuery<SlaData>({
    queryKey,
    queryFn: async () => (await api.get(`/companies/${companyId}/sla`)).data.data,
  });

  // Sunucudan gelen ayar düzenlenene kadar taslak yok; ilk değişiklikte kopyalanır.
  const [draft, setDraft] = useState<SlaSettings | null>(null);
  const settings = draft ?? data?.settings ?? null;
  const [saving, setSaving] = useState(false);
  const [holidayForm, setHolidayForm] = useState({ date: '', name: '' });
  const currentYear = new Date().getFullYear();

  const update = (patch: Partial<SlaSettings>) => settings && setDraft({ ...settings, ...patch });
  // Backend ile aynı kural: hatırlatma kapatmadan önce gelmeli (ikisi de açıksa).
  const reminderInvalid = !!settings
    && settings.autoClose.waitingReminderAfterDays > 0
    && settings.autoClose.waitingCloseAfterDays > 0
    && settings.autoClose.waitingReminderAfterDays >= settings.autoClose.waitingCloseAfterDays;

  const businessHours = settings?.businessHours ?? null;
  const toggleBusinessHours = (enabled: boolean) => {
    if (!settings) return;
    update({
      businessHours: businessHours
        ? { ...businessHours, enabled }
        : { enabled, timezone: browserTimezone(), week: data?.defaultWeek ?? {} },
    });
  };
  const setWeekday = (day: Weekday, windows: TimeWindow[]) => {
    if (!businessHours) return;
    update({ businessHours: { ...businessHours, week: { ...businessHours.week, [day]: windows } } });
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await api.put(`/companies/${companyId}/sla`, settings);
      queryClient.setQueryData(queryKey, res.data.data);
      setDraft(null);
      toast.success(t('companyMgmt.sla.saved'));
    } catch (err) {
      toast.error(getApiError(err, t('companyMgmt.sla.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleAddHoliday = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api.post(`/companies/${companyId}/holidays`, holidayForm);
      setHolidayForm({ date: '', name: '' });
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error(getApiError(err, t('companyMgmt.sla.holidayFailed')));
    }
  };

  const handleDeleteHoliday = async (holiday: Holiday) => {
    try {
      await api.delete(`/companies/${companyId}/holidays/${holiday.id}`);
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error(getApiError(err, t('companyMgmt.sla.holidayFailed')));
    }
  };

  const handleCopyYear = async () => {
    try {
      const res = await api.post(`/companies/${companyId}/holidays/copy-year`, { fromYear: currentYear, toYear: currentYear + 1 });
      toast.success(t('companyMgmt.sla.copied', { count: res.data.data.created, year: currentYear + 1 }));
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error(getApiError(err, t('companyMgmt.sla.holidayFailed')));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('companyMgmt.sla.title')} className="card max-h-[92vh] w-full max-w-4xl overflow-y-auto !p-0" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-subtle px-6 py-5">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Clock className="h-5 w-5 text-primary-500" /> {t('companyMgmt.sla.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('companyMgmt.sla.subtitle', { name: companyName })}</p>
          </div>
          <button className="icon-button border-0" onClick={onClose} aria-label={t('common.close')}><X className="h-5 w-5" /></button>
        </div>

        {isLoading || !settings ? (
          <p className="p-6 text-sm text-muted">{t('common.loading')}</p>
        ) : (
          <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-6">
              {/* Mesai takvimi */}
              <section className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={!!businessHours?.enabled} onChange={(event) => toggleBusinessHours(event.target.checked)} />
                  {t('companyMgmt.sla.businessHoursEnabled')}
                </label>
                <p className="text-xs text-muted">{t('companyMgmt.sla.businessHoursHint')}</p>

                {businessHours?.enabled && (
                  <div className="space-y-3 rounded-inset border border-subtle p-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium" htmlFor="sla-timezone">{t('companyMgmt.sla.timezone')}</label>
                      <input id="sla-timezone" className="input-field font-mono" value={businessHours.timezone} onChange={(event) => update({ businessHours: { ...businessHours, timezone: event.target.value } })} placeholder="Europe/Istanbul" />
                    </div>
                    <div className="space-y-2">
                      {WEEKDAYS.map((day) => {
                        const windows = businessHours.week[day] ?? [];
                        return (
                          <div key={day} className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="w-24 font-medium">{t(`companyMgmt.sla.weekdays.${day}`)}</span>
                            {windows.length === 0 && <span className="text-xs text-muted">{t('companyMgmt.sla.closed')}</span>}
                            {windows.map((window, index) => (
                              <span key={index} className="flex items-center gap-1">
                                <input type="time" className="input-field !w-auto !py-1" value={window.start} aria-label={t('companyMgmt.sla.start')}
                                  onChange={(event) => setWeekday(day, windows.map((w, i) => (i === index ? { ...w, start: event.target.value } : w)))} />
                                –
                                <input type="time" className="input-field !w-auto !py-1" value={window.end === '24:00' ? '23:59' : window.end} aria-label={t('companyMgmt.sla.end')}
                                  onChange={(event) => setWeekday(day, windows.map((w, i) => (i === index ? { ...w, end: event.target.value } : w)))} />
                                <button type="button" className="icon-button border-0" aria-label={t('common.delete')} onClick={() => setWeekday(day, windows.filter((_, i) => i !== index))}>
                                  <Trash2 className="h-4 w-4 text-red-500" />
                                </button>
                              </span>
                            ))}
                            {windows.length < 4 && (
                              <button type="button" className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setWeekday(day, [...windows, { start: '09:00', end: '18:00' }])}>
                                <Plus className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>

              {/* 7/24 öncelikler */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t('companyMgmt.sla.alwaysOnTitle')}</h3>
                <p className="text-xs text-muted">{t('companyMgmt.sla.alwaysOnHint')}</p>
                <div className="flex flex-wrap gap-3">
                  {PRIORITY_VALUES.map((priority) => (
                    <label key={priority} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={settings.alwaysOnPriorities.includes(priority)}
                        onChange={(event) => update({
                          alwaysOnPriorities: event.target.checked
                            ? [...settings.alwaysOnPriorities, priority]
                            : settings.alwaysOnPriorities.filter((p) => p !== priority),
                        })} />
                      {labels.priority(priority)}
                    </label>
                  ))}
                </div>
              </section>

              {/* Uyarı + eskalasyon */}
              <section className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-semibold" htmlFor="sla-warning">{t('companyMgmt.sla.warningPercent')}</label>
                  <div className="flex items-center gap-2">
                    <input id="sla-warning" type="number" min={0} max={99} className="input-field !w-24" value={settings.warningPercent}
                      onChange={(event) => update({ warningPercent: Math.max(0, Math.min(99, Number(event.target.value) || 0)) })} />
                    <span className="text-sm text-muted">%</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{t('companyMgmt.sla.warningHint')}</p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={settings.escalation.notifyManagers}
                    onChange={(event) => update({ escalation: { ...settings.escalation, notifyManagers: event.target.checked } })} />
                  {t('companyMgmt.sla.notifyManagers')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={settings.escalation.bumpPriority}
                    onChange={(event) => update({ escalation: { ...settings.escalation, bumpPriority: event.target.checked } })} />
                  {t('companyMgmt.sla.bumpPriority')}
                </label>
              </section>

              {/* Otomatik kapatma */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t('companyMgmt.sla.autoCloseTitle')}</h3>
                <p className="text-xs text-muted">{t('companyMgmt.sla.autoCloseHint')}</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {(['resolvedAfterDays', 'waitingReminderAfterDays', 'waitingCloseAfterDays'] as const).map((key) => (
                    <div key={key}>
                      <label className="mb-1 block text-xs font-medium" htmlFor={`auto-close-${key}`}>{t(`companyMgmt.sla.${key}`)}</label>
                      <input id={`auto-close-${key}`} type="number" min={0} max={365} className="input-field" value={settings.autoClose[key]}
                        onChange={(event) => update({ autoClose: { ...settings.autoClose, [key]: Math.max(0, Math.min(365, Number(event.target.value) || 0)) } })} />
                    </div>
                  ))}
                </div>
                {reminderInvalid && <p className="text-xs text-red-600">{t('companyMgmt.sla.reminderBeforeClose')}</p>}
              </section>

              <div className="flex justify-end gap-2 border-t border-subtle pt-4">
                {draft && <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>{t('common.cancel')}</button>}
                <button type="button" className="btn-primary" disabled={!draft || saving || reminderInvalid} onClick={() => void handleSave()}>
                  {saving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>

            {/* Tatiller */}
            <aside className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4" /> {t('companyMgmt.sla.holidays')}</h3>
              <p className="text-xs text-muted">{t('companyMgmt.sla.holidaysHint')}</p>
              <form onSubmit={(event) => void handleAddHoliday(event)} className="space-y-2">
                <input type="date" className="input-field" required value={holidayForm.date} onChange={(event) => setHolidayForm({ ...holidayForm, date: event.target.value })} aria-label={t('companyMgmt.sla.holidayDate')} />
                <input type="text" className="input-field" required maxLength={120} value={holidayForm.name} onChange={(event) => setHolidayForm({ ...holidayForm, name: event.target.value })} placeholder={t('companyMgmt.sla.holidayName')} />
                <button type="submit" className="btn-secondary w-full text-sm"><Plus className="mr-1 inline h-4 w-4" />{t('companyMgmt.sla.addHoliday')}</button>
              </form>
              <ul className="divide-y divide-gray-100 text-sm dark:divide-slate-800">
                {data?.holidays.length === 0 && <li className="py-2 text-xs text-muted">{t('companyMgmt.sla.noHolidays')}</li>}
                {data?.holidays.map((holiday) => (
                  <li key={holiday.id} className="flex items-center justify-between gap-2 py-2">
                    <span><span className="font-mono text-xs text-muted">{holiday.date}</span> {holiday.name}</span>
                    <button type="button" className="icon-button border-0" aria-label={t('common.delete')} onClick={() => void handleDeleteHoliday(holiday)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn-secondary w-full text-xs" onClick={() => void handleCopyYear()}>
                <Copy className="mr-1 inline h-3 w-3" />{t('companyMgmt.sla.copyYear', { from: currentYear, to: currentYear + 1 })}
              </button>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
