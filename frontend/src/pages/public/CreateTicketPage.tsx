import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, ArrowLeft, ArrowRight, Building2, MapPin, Tag, FileText, Upload, Paperclip, XCircle, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import type { Company, Location, Category, CustomField } from '../../types';
import FieldHint from '../../components/FieldHint';
import { INPUT_LIMITS as LIMITS } from '../../types';

const STEPS = ['Email', 'Şirket', 'Lokasyon', 'Kategori', 'Detay', 'Onay'];

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

export default function CreateTicketPage() {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
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
  }, [companies]);

  // Auto-select single location
  useEffect(() => {
    if (locations && locations.length === 1 && !form.locationId) {
      update({ locationId: locations[0].id });
    }
  }, [locations]);

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
      toast.success('Destek talebiniz oluşturuldu!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Bir hata oluştu');
    } finally {
      setSubmitting(false);
    }
  };

  // Success screen
  if (result) {
    return (
      <div className="max-w-lg mx-auto card text-center py-12">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Talebiniz Oluşturuldu!</h2>
        <p className="text-gray-600 mb-6">Talep numaranız:</p>
        <div className="text-3xl font-mono font-bold text-primary-700 mb-6">
          {result.ticketNumber}
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Bu numara ile talebinizi takip edebilirsiniz. Ayrıca email adresinize bilgilendirme gönderilecektir.
        </p>
        <a
          href={`/ticket/${result.accessToken}`}
          className="btn-primary inline-block"
        >
          Talebi Görüntüle
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center justify-between mb-8">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                i < step ? 'bg-green-500 text-white' :
                i === step ? 'bg-primary-600 text-white' :
                'bg-gray-200 text-gray-500'
              }`}
            >
              {i < step ? '✓' : i + 1}
            </div>
            <span className={`ml-2 text-xs hidden sm:inline ${i === step ? 'text-primary-700 font-medium' : 'text-gray-400'}`}>
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-0.5 mx-2 ${i < step ? 'bg-green-500' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </div>

      <div className="card">
        {/* Step 0: Email */}
        {step === 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Bilgileriniz</h3>
            {isPortalLocked && portalCompany && (
              <div className="flex items-center gap-2 bg-primary-50 text-primary-700 px-3 py-2 rounded-lg text-sm">
                <Building2 className="w-4 h-4" />
                <span><strong>{portalCompany.name}</strong> destek portalı</span>
              </div>
            )}
            <p className="text-sm text-gray-500">Daha önce talep oluşturduysanız bilgileriniz otomatik getirilecektir.</p>
            <div>
              <label className="block text-sm font-medium mb-1">Email Adresiniz *</label>
              <input
                type="email"
                className="input-field"
                value={form.email}
                onChange={e => update({ email: e.target.value })}
                placeholder="email@company.com"
              />
              {/* Domain rejection — no detail about which domains are allowed */}
              {form.email && emailDomain && allCompanies && !hasAccessibleCompanies && (
                <div className="mt-2 flex items-start gap-2 text-red-600 bg-red-50 rounded-lg p-3 text-sm">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>Bu email adresi ile destek talebi oluşturamazsınız. Lütfen kurumsal email adresinizi kullanın.</span>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Ad Soyad *</label>
              <input
                type="text"
                className="input-field"
                value={form.fullName}
                onChange={e => update({ fullName: e.target.value })}
                minLength={LIMITS.fullName.min}
                maxLength={LIMITS.fullName.max}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Telefon</label>
                <input
                  type="tel"
                  className="input-field"
                  value={form.phone}
                  onChange={e => update({ phone: e.target.value })}
                  placeholder="05XX XXX XX XX"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Departman</label>
                <input
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
              <Building2 className="w-5 h-5" /> Şirket Seçimi
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {companies?.map(company => (
                <button
                  key={company.id}
                  onClick={() => update({ companyId: company.id, locationId: '', categoryId: '' })}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    form.companyId === company.id
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="font-medium">{company.name}</span>
                  <span className="block text-xs text-gray-400 mt-1">{company.groupType}</span>
                </button>
              ))}
            </div>
            {companies?.length === 0 && (
              <p className="text-center text-gray-400 py-4">Kullanılabilir şirket bulunamadı.</p>
            )}
          </div>
        )}

        {/* Step 2: Location (skipped if single) */}
        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <MapPin className="w-5 h-5" /> Lokasyon Seçimi
            </h3>
            <p className="text-sm text-gray-500">{selectedCompany?.name} için lokasyon seçin</p>
            {locations && locations.length === 0 ? (
              <p className="text-center text-gray-400 py-4">Bu şirkete tanımlı lokasyon bulunamadı.</p>
            ) : (
              <div className="space-y-2">
                {locations?.map(loc => (
                  <button
                    key={loc.id}
                    onClick={() => update({ locationId: loc.id })}
                    className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                      form.locationId === loc.id
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className="font-medium">{loc.name}</span>
                    {loc.address && <span className="block text-xs text-gray-400 mt-1">{loc.address}</span>}
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
              <Tag className="w-5 h-5" /> Sorun Kategorisi
            </h3>
            <div className="space-y-2">
              {categories?.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => update({ categoryId: cat.id })}
                  className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                    form.categoryId === cat.id
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="font-medium">{cat.name}</span>
                  {cat.description && <span className="block text-xs text-gray-400 mt-1">{cat.description}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Details + Custom Fields + File Upload */}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5" /> Detaylar
            </h3>
            {/*
              maxLength ve sayaçlar backend kurallarıyla HİZALI olmalı
              (backend/src/utils/validation.ts → LIMITS). Hizalı değilse kullanıcı
              yazar, gönderir ve sunucudan 400 yer — hata formda değil ağda çıkar.
            */}
            <div>
              <label className="block text-sm font-medium mb-1">Konu *</label>
              <input
                type="text"
                className="input-field"
                value={form.subject}
                onChange={e => update({ subject: e.target.value })}
                placeholder="Sorunu kısaca tanımlayın"
                minLength={LIMITS.subject.min}
                maxLength={LIMITS.subject.max}
                required
              />
              <FieldHint value={form.subject} {...LIMITS.subject} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Açıklama *</label>
              <textarea
                className="input-field min-h-[120px]"
                value={form.description}
                onChange={e => update({ description: e.target.value })}
                placeholder="Sorunu detaylı olarak açıklayın..."
                minLength={LIMITS.description.min}
                maxLength={LIMITS.description.max}
                required
              />
              <FieldHint value={form.description} {...LIMITS.description} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Öncelik</label>
              <select
                className="input-field"
                value={form.priority}
                onChange={e => update({ priority: e.target.value })}
              >
                <option value="low">Düşük</option>
                <option value="medium">Orta</option>
                <option value="high">Yüksek</option>
                <option value="critical">Kritik</option>
              </select>
            </div>

            {/* File upload */}
            <div>
              <label className="block text-sm font-medium mb-1">Dosya Ekle</label>
              <label className="flex items-center gap-2 btn-secondary text-sm cursor-pointer w-fit">
                <Upload className="w-4 h-4" /> Dosya Seç
                <input type="file" className="hidden" onChange={handleFileAdd} multiple />
              </label>
              {files.length > 0 && (
                <div className="mt-2 space-y-1">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-1.5">
                      <Paperclip className="w-3 h-3 text-gray-400" />
                      <span className="flex-1 truncate">{f.name}</span>
                      <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                      <button onClick={() => handleFileRemove(i)} className="text-red-400 hover:text-red-600">
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
                <h4 className="text-sm font-medium text-gray-700">Ek Bilgiler</h4>
                {customFields.map(field => (
                  <div key={field.id}>
                    <label className="block text-sm font-medium mb-1">
                      {field.fieldLabel} {field.required && '*'}
                    </label>
                    {field.fieldType === 'select' ? (
                      <select
                        className="input-field"
                        value={form.customFields[field.id] || ''}
                        onChange={e => update({
                          customFields: { ...form.customFields, [field.id]: e.target.value }
                        })}
                      >
                        <option value="">Seçin...</option>
                        {(field.options as string[] || []).map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : field.fieldType === 'textarea' ? (
                      <textarea
                        className="input-field"
                        value={form.customFields[field.id] || ''}
                        onChange={e => update({
                          customFields: { ...form.customFields, [field.id]: e.target.value }
                        })}
                        placeholder={field.placeholder || ''}
                      />
                    ) : (
                      <input
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
            <h3 className="text-lg font-semibold">Talep Özeti</h3>
            <div className="bg-gray-50 rounded-lg p-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Email:</span>
                <span className="font-medium">{form.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Ad Soyad:</span>
                <span className="font-medium">{form.fullName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Şirket:</span>
                <span className="font-medium">{selectedCompany?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Lokasyon:</span>
                <span className="font-medium">{selectedLocation?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Kategori:</span>
                <span className="font-medium">{selectedCategory?.name}</span>
              </div>
              <hr />
              <div className="flex justify-between">
                <span className="text-gray-500">Konu:</span>
                <span className="font-medium">{form.subject}</span>
              </div>
              <div>
                <span className="text-gray-500">Açıklama:</span>
                <p className="mt-1 text-gray-800">{form.description}</p>
              </div>
              {files.length > 0 && (
                <>
                  <hr />
                  <div>
                    <span className="text-gray-500">Dosyalar ({files.length}):</span>
                    <div className="mt-1 space-y-1">
                      {files.map((f, i) => (
                        <div key={i} className="text-gray-600 flex items-center gap-1">
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
        <div className="flex justify-between mt-8 pt-4 border-t">
          <button
            onClick={handlePrev}
            disabled={step === 0}
            className="btn-secondary flex items-center gap-2 disabled:opacity-30"
          >
            <ArrowLeft className="w-4 h-4" /> Geri
          </button>

          {step < STEPS.length - 1 ? (
            <button
              onClick={handleNext}
              disabled={!canNext()}
              className="btn-primary flex items-center gap-2"
            >
              İleri <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn-primary flex items-center gap-2"
            >
              {submitting ? 'Gönderiliyor...' : 'Talebi Oluştur'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
