import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, ArrowLeft, ArrowRight, Building2, MapPin, Tag, FileText, Upload, Paperclip, XCircle, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import { getApiError } from '../../utils/api-error';
import toast from 'react-hot-toast';
import type { Company, Location, Category, CustomField } from '../../types';
import FieldHint from '../../components/FieldHint';
import { INPUT_LIMITS as LIMITS } from '../../types';
import { useEnumLabels } from '../../i18n/labels';

interface FormData {
  email: string;
  fullName: string;
  phone: string;
  department: string;
  companyId: string;
  locationId: string;
  categoryId: string;
  subject: string;
  description: string;
  priority: string;
  customFields: Record<string, string>;
}

interface TicketCreationResult {
  ticketNumber: string;
  accessToken: string;
}

export default function CreateTicketPage() {
  const { t, i18n } = useTranslation();
  const labels = useEnumLabels();
  const STEPS = [
    t('common.email'),
    t('common.company'),
    t('common.location'),
    t('common.category'),
    t('createTicket.steps.details'),
    t('createTicket.steps.confirm'),
  ];
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TicketCreationResult | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [form, setForm] = useState<FormData>({
    email: '', fullName: '', phone: '', department: '',
    companyId: '', locationId: '', categoryId: '',
    subject: '', description: '', priority: 'medium',
    customFields: {},
  });

  const update = (fields: Partial<FormData>) => setForm(prev => ({ ...prev, ...fields }));

  // Current portal hostname
  const currentHostname = useMemo(() => window.location.hostname.toLowerCase(), []);

  // Extract email domain
  const emailDomain = useMemo(() => {
    const parts = form.email.split('@');
    return parts.length === 2 ? parts[1].toLowerCase() : '';
  }, [form.email]);

  // Fetch all companies
  const { data: allCompanies } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: async () => (await axios.get('/api/companies')).data.data,
  });

  // Portal domain lock: check if current hostname is mapped to a specific company
  const portalCompany = useMemo(() => {
    if (!allCompanies) return null;
    return allCompanies.find(c => {
      const portals = c.portalDomains as string[] | undefined;
      if (!portals || portals.length === 0) return false;
      return portals.some(d => d.toLowerCase() === currentHostname);
    }) || null;
  }, [allCompanies, currentHostname]);

  const isPortalLocked = !!portalCompany;

  // Filter companies: portal locked → only that company, otherwise → email domain filter
  const companies = useMemo(() => {
    if (!allCompanies || !emailDomain) return [];

    if (isPortalLocked) {
      // Portal locked: only the matched company, still validate email domain
      const c = portalCompany!;
      const emailDomains = c.allowedDomains as string[] | undefined;
      if (emailDomains && emailDomains.length > 0) {
        const allowed = emailDomains.some(d => d.toLowerCase() === emailDomain);
        return allowed ? [c] : [];
      }
      return [c];
    }

    // General portal: filter by email domain
    return allCompanies.filter(c => {
      // Skip companies that have portal domains (they're only accessible from their own portals)
      const portals = c.portalDomains as string[] | undefined;
      if (portals && portals.length > 0) return false;

      const domains = c.allowedDomains as string[] | undefined;
      if (!domains || domains.length === 0) return true;
      return domains.some(d => d.toLowerCase() === emailDomain);
    });
  }, [allCompanies, emailDomain, isPortalLocked, portalCompany]);

  const hasAccessibleCompanies = companies.length > 0;

  // Fetch locations for selected company
  const { data: locations } = useQuery<Location[]>({
    queryKey: ['locations', form.companyId],
    queryFn: async () => (await axios.get(`/api/companies/${form.companyId}/locations`)).data.data,
    enabled: !!form.companyId,
  });

  // Auto-select company when portal locked or single company
  useEffect(() => {
    if (companies.length === 1 && !form.companyId) {
      update({ companyId: companies[0].id });
    }
  }, [companies, form.companyId]);

  // Auto-select single location
  useEffect(() => {
    if (locations && locations.length === 1 && !form.locationId) {
      update({ locationId: locations[0].id });
    }
  }, [locations, form.locationId]);

  // Fetch categories for selected company
  const { data: categories } = useQuery<Category[]>({
    queryKey: ['categories', form.companyId],
    queryFn: async () => (await axios.get(`/api/companies/${form.companyId}/categories`)).data.data,
    enabled: !!form.companyId,
  });

  // Fetch custom fields for selected company
  const { data: customFields } = useQuery<CustomField[]>({
    queryKey: ['customFields', form.companyId],
    queryFn: async () => (await axios.get(`/api/companies/${form.companyId}/custom-fields`)).data.data,
    enabled: !!form.companyId,
  });

  const selectedCompany = companies?.find(c => c.id === form.companyId);
  const selectedLocation = locations?.find(l => l.id === form.locationId);
  const selectedCategory = categories?.find(c => c.id === form.categoryId);

  const canNext = () => {
    switch (step) {
      case 0:
        return (
          !!form.email &&
          form.fullName.trim().length >= LIMITS.fullName.min &&
          !!emailDomain &&
          hasAccessibleCompanies
        );
      case 1: return !!form.companyId;
      case 2: return !!form.locationId;
      case 3: return !!form.categoryId;
      case 4:
        // Backend'in alt sınırlarıyla aynı ölçüt — yalnızca "dolu mu" bakılsaydı
        // tek karakterlik bir konu ilerler ve gönderimde 400 alırdı.
        // trim() de backend'le aynı: "   " boş sayılır.
        return (
          form.subject.trim().length >= LIMITS.subject.min &&
          form.description.trim().length >= LIMITS.description.min
        );
      default: return true;
    }
  };

  // Smart step navigation — skip company step if locked, skip location step if single
  const shouldSkipCompany = isPortalLocked || companies.length === 1;
  const shouldSkipLocation = locations && locations.length <= 1 && form.locationId;

  const handleNext = () => {
    let next = step + 1;
    if (next === 1 && shouldSkipCompany) next = 2;       // skip company
    if (next === 2 && shouldSkipLocation) next = 3;      // skip location
    setStep(next);
  };

  const handlePrev = () => {
    let prev = step - 1;
    if (prev === 2 && shouldSkipLocation) prev = 1;      // skip location back
    if (prev === 1 && shouldSkipCompany) prev = 0;       // skip company back
    setStep(prev);
  };

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...newFiles]);
    e.target.value = '';
  };

  const handleFileRemove = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        // Bildirim dili — talep sahibi e-posta/SMS'lerini portal diliyle alsın.
        locale: i18n.language?.startsWith('tr') ? 'tr' : 'en',
        customFields: Object.entries(form.customFields)
          .filter(([, v]) => v)
          .map(([fieldId, value]) => ({ fieldId, value })),
      };
      const res = await axios.post('/api/tickets', payload);
      const ticketData = res.data.data;

      // Upload files if any
      if (files.length > 0) {
        for (const file of files) {
          const formData = new FormData();
          formData.append('file', file);
          try {
            await axios.post(`/api/public/ticket/${ticketData.accessToken}/attachments`, formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });
          } catch {
            // Continue even if a file fails
          }
        }
      }

      setResult(ticketData);
      toast.success(t('createTicket.toast.created'));
    } catch (err: unknown) {
      toast.error(getApiError(err, t('common.error')));
    } finally {
      setSubmitting(false);
    }
  };

  // Success screen
  if (result) {
    return (
      <div className="max-w-lg mx-auto card text-center py-12">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">{t('createTicket.success.title')}</h2>
        <p className="text-muted mb-6">{t('createTicket.success.ticketNumberLabel')}</p>
        <div className="text-3xl font-mono font-bold text-primary-700 mb-6">
          {result.ticketNumber}
        </div>
        <p className="text-sm text-muted mb-4">
          {t('createTicket.success.info')}
        </p>
        <a
          href={`/ticket/${result.accessToken}`}
          className="btn-primary inline-block"
        >
          {t('createTicket.success.view')}
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-600 dark:text-primary-300">{t('createTicket.header.eyebrow')}</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight">{t('createTicket.header.title')}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted">{t('createTicket.header.subtitle')}</p>
      </div>
      {/* Step indicator */}
      <div className="mb-3 flex items-center justify-between sm:hidden"><span className="text-sm font-semibold">{STEPS[step]}</span><span className="text-xs text-muted">{t('createTicket.stepProgress', { current: step + 1, total: STEPS.length })}</span></div>
      <div className="mb-8 h-2 overflow-hidden rounded-full bg-gray-200 sm:hidden dark:bg-slate-800"><div className="h-full rounded-full bg-primary-600 transition-[width]" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
      <div className="mb-8 hidden items-center justify-between sm:flex" aria-label={t('createTicket.stepsAria')}>
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                i < step ? 'bg-green-500 text-white' :
                i === step ? 'bg-primary-600 text-white' :
                'bg-gray-200 text-gray-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
              aria-current={i === step ? 'step' : undefined}
            >
              {i < step ? '✓' : i + 1}
            </div>
            <span className={`ml-2 text-xs hidden sm:inline ${i === step ? 'text-primary-700 font-semibold dark:text-primary-300' : 'text-muted'}`}>
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-0.5 mx-2 ${i < step ? 'bg-green-500' : 'bg-gray-200 dark:bg-slate-700'}`} />
            )}
          </div>
        ))}
      </div>

      <div className="card overflow-hidden p-5 sm:p-8">
        {/* Step 0: Email */}
        {step === 0 && (
          <div className="space-y-4">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-300">{t('createTicket.step1.eyebrow')}</p><h3 className="mt-1 text-xl font-semibold">{t('createTicket.step1.title')}</h3></div>
            {isPortalLocked && portalCompany && (
              <div className="flex items-center gap-2 bg-primary-50 text-primary-700 px-3 py-2 rounded-inset text-sm">
                <Building2 className="w-4 h-4" />
                <span><strong>{portalCompany.name}</strong> {t('createTicket.step1.supportPortal')}</span>
              </div>
            )}
            <p className="text-sm text-muted">{t('createTicket.step1.emailInfo')}</p>
            <div>
              <label htmlFor="requester-email" className="block text-sm font-medium mb-1">{t('createTicket.step1.emailLabel')} *</label>
              <input
                id="requester-email"
                type="email"
                className="input-field"
                value={form.email}
                onChange={e => update({ email: e.target.value })}
                placeholder="email@company.com"
              />
              {/* Domain rejection — no detail about which domains are allowed */}
              {form.email && emailDomain && allCompanies && !hasAccessibleCompanies && (
                <div className="mt-2 flex items-start gap-2 text-red-700 bg-red-50 rounded-inset p-3 text-sm dark:bg-red-500/15 dark:text-red-300">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{t('createTicket.step1.domainRejected')}</span>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="requester-name" className="block text-sm font-medium mb-1">{t('common.fullName')} *</label>
              <input
                id="requester-name"
                type="text"
                className="input-field"
                value={form.fullName}
                onChange={e => update({ fullName: e.target.value })}
                minLength={LIMITS.fullName.min}
                maxLength={LIMITS.fullName.max}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="requester-phone" className="block text-sm font-medium mb-1">{t('common.phone')}</label>
                <input
                  id="requester-phone"
                  type="tel"
                  className="input-field"
                  value={form.phone}
                  onChange={e => update({ phone: e.target.value })}
                  placeholder="05XX XXX XX XX"
                />
              </div>
              <div>
                <label htmlFor="requester-department" className="block text-sm font-medium mb-1">{t('common.department')}</label>
                <input
                  id="requester-department"
                  type="text"
                  className="input-field"
                  value={form.department}
                  onChange={e => update({ department: e.target.value })}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Company (filtered by email domain) */}
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Building2 className="w-5 h-5" /> {t('createTicket.step2.title')}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {companies?.map(company => (
                <button
                  key={company.id}
                  onClick={() => update({ companyId: company.id, locationId: '', categoryId: '' })}
                  className={`p-4 rounded-inset border-2 text-left transition-[color,background-color,border-color,box-shadow] ${
                    form.companyId === company.id
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10'
                      : 'border-gray-200 hover:border-gray-300 dark:border-slate-700 dark:hover:border-slate-600'
                  }`}
                >
                  <span className="font-medium">{company.name}</span>
                  <span className="block text-xs text-muted mt-1">{labels.groupType(company.groupType)}</span>
                </button>
              ))}
            </div>
            {companies?.length === 0 && (
              <p className="text-center text-muted py-4">{t('createTicket.step2.empty')}</p>
            )}
          </div>
        )}

        {/* Step 2: Location (skipped if single) */}
        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <MapPin className="w-5 h-5" /> {t('createTicket.step3.title')}
            </h3>
            <p className="text-sm text-muted">{t('createTicket.step3.subtitle', { company: selectedCompany?.name })}</p>
            {locations && locations.length === 0 ? (
              <p className="text-center text-muted py-4">{t('createTicket.step3.empty')}</p>
            ) : (
              <div className="space-y-2">
                {locations?.map(loc => (
                  <button
                    key={loc.id}
                    onClick={() => update({ locationId: loc.id })}
                    className={`w-full p-4 rounded-inset border-2 text-left transition-[color,background-color,border-color,box-shadow] ${
                      form.locationId === loc.id
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10'
                        : 'border-gray-200 hover:border-gray-300 dark:border-slate-700 dark:hover:border-slate-600'
                    }`}
                  >
                    <span className="font-medium">{loc.name}</span>
                    {loc.address && <span className="block text-xs text-muted mt-1">{loc.address}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Category */}
        {step === 3 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Tag className="w-5 h-5" /> {t('createTicket.step4.title')}
            </h3>
            <div className="space-y-2">
              {categories?.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => update({ categoryId: cat.id })}
                  className={`w-full p-4 rounded-inset border-2 text-left transition-[color,background-color,border-color,box-shadow] ${
                    form.categoryId === cat.id
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10'
                      : 'border-gray-200 hover:border-gray-300 dark:border-slate-700 dark:hover:border-slate-600'
                  }`}
                >
                  <span className="font-medium">{cat.name}</span>
                  {cat.description && <span className="block text-xs text-muted mt-1">{cat.description}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Details + Custom Fields + File Upload */}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5" /> {t('createTicket.step5.title')}
            </h3>
            {/*
              maxLength ve sayaçlar backend kurallarıyla HİZALI olmalı
              (backend/src/utils/validation.ts → LIMITS). Hizalı değilse kullanıcı
              yazar, gönderir ve sunucudan 400 yer — hata formda değil ağda çıkar.
            */}
            <div>
              <label htmlFor="ticket-subject" className="block text-sm font-medium mb-1">{t('common.subject')} *</label>
              <input
                id="ticket-subject"
                type="text"
                className="input-field"
                value={form.subject}
                onChange={e => update({ subject: e.target.value })}
                placeholder={t('createTicket.step5.subjectPlaceholder')}
                minLength={LIMITS.subject.min}
                maxLength={LIMITS.subject.max}
                required
              />
              <FieldHint value={form.subject} {...LIMITS.subject} />
            </div>
            <div>
              <label htmlFor="ticket-description" className="block text-sm font-medium mb-1">{t('common.description')} *</label>
              <textarea
                id="ticket-description"
                className="input-field min-h-[120px]"
                value={form.description}
                onChange={e => update({ description: e.target.value })}
                placeholder={t('createTicket.step5.descriptionPlaceholder')}
                minLength={LIMITS.description.min}
                maxLength={LIMITS.description.max}
                required
              />
              <FieldHint value={form.description} {...LIMITS.description} />
            </div>
            <div>
              <label htmlFor="ticket-priority" className="block text-sm font-medium mb-1">{t('common.priority')}</label>
              <select
                id="ticket-priority"
                className="input-field"
                value={form.priority}
                onChange={e => update({ priority: e.target.value })}
              >
                <option value="low">{labels.priority('low')}</option>
                <option value="medium">{labels.priority('medium')}</option>
                <option value="high">{labels.priority('high')}</option>
                <option value="critical">{labels.priority('critical')}</option>
              </select>
            </div>

            {/* File upload */}
            <div>
              <span className="block text-sm font-medium mb-1">{t('createTicket.step5.attachFile')}</span>
              <label className="flex items-center gap-2 btn-secondary text-sm cursor-pointer w-fit">
                <Upload className="w-4 h-4" /> {t('createTicket.step5.chooseFile')}
                <input type="file" className="hidden" onChange={handleFileAdd} multiple />
              </label>
              {files.length > 0 && (
                <div className="mt-2 space-y-1">
                  {files.map((f, i) => (
                    <div key={i} className="sub-surface flex items-center gap-2 rounded-control px-3 py-2 text-sm">
                      <Paperclip className="w-3 h-3 text-muted" />
                      <span className="flex-1 truncate">{f.name}</span>
                      <span className="text-xs text-muted">{(f.size / 1024).toFixed(0)} KB</span>
                      <button onClick={() => handleFileRemove(i)} className="icon-button min-h-8 min-w-8 border-0 text-red-500" aria-label={t('createTicket.step5.removeFile', { name: f.name })}>
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Dynamic custom fields */}
            {customFields && customFields.length > 0 && (
              <div className="border-t pt-4 mt-4 space-y-4">
                <h4 className="text-sm font-semibold">{t('createTicket.step5.additionalInfo')}</h4>
                {customFields.map(field => (
                  <div key={field.id}>
                    <label htmlFor={`custom-field-${field.id}`} className="block text-sm font-medium mb-1">
                      {field.fieldLabel} {field.required && '*'}
                    </label>
                    {field.fieldType === 'select' ? (
                      <select
                        id={`custom-field-${field.id}`}
                        className="input-field"
                        value={form.customFields[field.id] || ''}
                        onChange={e => update({
                          customFields: { ...form.customFields, [field.id]: e.target.value }
                        })}
                      >
                        <option value="">{t('createTicket.step5.selectOption')}</option>
                        {(field.options as string[] || []).map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : field.fieldType === 'textarea' ? (
                      <textarea
                        id={`custom-field-${field.id}`}
                        className="input-field"
                        value={form.customFields[field.id] || ''}
                        onChange={e => update({
                          customFields: { ...form.customFields, [field.id]: e.target.value }
                        })}
                        placeholder={field.placeholder || ''}
                      />
                    ) : (
                      <input
                        id={`custom-field-${field.id}`}
                        type={field.fieldType === 'phone' ? 'tel' : field.fieldType === 'url' ? 'url' : field.fieldType === 'email' ? 'email' : field.fieldType === 'number' ? 'number' : 'text'}
                        className="input-field"
                        value={form.customFields[field.id] || ''}
                        onChange={e => update({
                          customFields: { ...form.customFields, [field.id]: e.target.value }
                        })}
                        placeholder={field.placeholder || ''}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 5: Confirm */}
        {step === 5 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t('createTicket.step6.title')}</h3>
            <div className="sub-surface p-4 space-y-3 text-sm sm:p-5">
              <div className="flex justify-between">
                <span className="text-muted">{t('common.email')}:</span>
                <span className="font-medium">{form.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('common.fullName')}:</span>
                <span className="font-medium">{form.fullName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('common.company')}:</span>
                <span className="font-medium">{selectedCompany?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('common.location')}:</span>
                <span className="font-medium">{selectedLocation?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('common.category')}:</span>
                <span className="font-medium">{selectedCategory?.name}</span>
              </div>
              <hr />
              <div className="flex justify-between">
                <span className="text-muted">{t('common.subject')}:</span>
                <span className="font-medium">{form.subject}</span>
              </div>
              <div>
                <span className="text-muted">{t('common.description')}:</span>
                <p className="mt-1 whitespace-pre-wrap">{form.description}</p>
              </div>
              {files.length > 0 && (
                <>
                  <hr />
                  <div>
                    <span className="text-muted">{t('createTicket.step6.filesLabel', { count: files.length })}</span>
                    <div className="mt-1 space-y-1">
                      {files.map((f, i) => (
                        <div key={i} className="text-muted flex items-center gap-1">
                          <Paperclip className="w-3 h-3" /> {f.name}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="sticky -bottom-5 -mx-5 mt-8 flex justify-between border-t border-subtle bg-white/95 px-5 pb-1 pt-4 backdrop-blur sm:-bottom-8 sm:-mx-8 sm:px-8 dark:bg-slate-900/95">
          <button
            onClick={handlePrev}
            disabled={step === 0}
            className="btn-secondary flex items-center gap-2 disabled:opacity-30"
          >
            <ArrowLeft className="w-4 h-4" /> {t('common.back')}
          </button>

          {step < STEPS.length - 1 ? (
            <button
              onClick={handleNext}
              disabled={!canNext()}
              className="btn-primary flex items-center gap-2"
            >
              {t('common.next')} <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn-primary flex items-center gap-2"
            >
              {submitting ? t('createTicket.submitting') : t('createTicket.submit')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
