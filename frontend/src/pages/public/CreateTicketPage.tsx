import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, ArrowLeft, ArrowRight, Building2, MapPin, Tag, FileText } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import type { Company, Location, Category, CustomField } from '../../types';

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
  const [form, setForm] = useState<FormData>({
    email: '', fullName: '', phone: '', department: '',
    companyId: '', locationId: '', categoryId: '',
    subject: '', description: '', priority: 'medium',
    customFields: {},
  });

  const update = (fields: Partial<FormData>) => setForm(prev => ({ ...prev, ...fields }));

  // Lookup user by email
  const lookupUser = async () => {
    if (!form.email) return;
    try {
      const res = await axios.post('/api/auth/lookup', { email: form.email });
      if (res.data.data) {
        const u = res.data.data;
        update({
          fullName: u.fullName || form.fullName,
          phone: u.phone || form.phone,
          department: u.department || form.department,
          companyId: u.companyId || form.companyId,
          locationId: u.locationId || form.locationId,
        });
        toast.success('Önceki bilgileriniz getirildi');
      }
    } catch { /* ignore */ }
  };

  // Fetch companies
  const { data: companies } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: async () => (await axios.get('/api/companies')).data.data,
  });

  // Fetch locations for selected company
  const { data: locations } = useQuery<Location[]>({
    queryKey: ['locations', form.companyId],
    queryFn: async () => (await axios.get(`/api/companies/${form.companyId}/locations`)).data.data,
    enabled: !!form.companyId,
  });

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
      case 0: return form.email && form.fullName;
      case 1: return !!form.companyId;
      case 2: return !!form.locationId;
      case 3: return !!form.categoryId;
      case 4: return form.subject && form.description;
      default: return true;
    }
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
      setResult(res.data.data);
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
            <p className="text-sm text-gray-500">Daha önce talep oluşturduysanız bilgileriniz otomatik getirilecektir.</p>
            <div>
              <label className="block text-sm font-medium mb-1">Email Adresiniz *</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  className="input-field flex-1"
                  value={form.email}
                  onChange={e => update({ email: e.target.value })}
                  placeholder="email@company.com"
                  onBlur={lookupUser}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Ad Soyad *</label>
              <input
                type="text"
                className="input-field"
                value={form.fullName}
                onChange={e => update({ fullName: e.target.value })}
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

        {/* Step 1: Company */}
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
          </div>
        )}

        {/* Step 2: Location */}
        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <MapPin className="w-5 h-5" /> Lokasyon Seçimi
            </h3>
            <p className="text-sm text-gray-500">{selectedCompany?.name} için lokasyon seçin</p>
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

        {/* Step 4: Details + Custom Fields */}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5" /> Detaylar
            </h3>
            <div>
              <label className="block text-sm font-medium mb-1">Konu *</label>
              <input
                type="text"
                className="input-field"
                value={form.subject}
                onChange={e => update({ subject: e.target.value })}
                placeholder="Sorunu kısaca tanımlayın"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Açıklama *</label>
              <textarea
                className="input-field min-h-[120px]"
                value={form.description}
                onChange={e => update({ description: e.target.value })}
                placeholder="Sorunu detaylı olarak açıklayın..."
              />
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
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-8 pt-4 border-t">
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={step === 0}
            className="btn-secondary flex items-center gap-2 disabled:opacity-30"
          >
            <ArrowLeft className="w-4 h-4" /> Geri
          </button>

          {step < STEPS.length - 1 ? (
            <button
              onClick={() => setStep(s => s + 1)}
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
