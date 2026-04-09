import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, MapPin, Building2, Mail, Trash2, CheckCircle2, XCircle, Settings } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';

const GROUP_TYPES = [
  { value: 'call_center', label: 'Çağrı Merkezi' },
  { value: 'corporate', label: 'Kurumsal' },
  { value: 'warehouse', label: 'Depo / Lojistik' },
  { value: 'retail', label: 'Mağaza / Perakende' },
];

const emptySmtpForm = { host: '', port: 587, secure: false, user: '', pass: '', fromName: '', fromEmail: '', isActive: true };

export default function CompanyManagementPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', groupType: 'corporate', allowedDomains: '', portalDomains: '', notificationEmail: '' });

  // Location form
  const [showLocForm, setShowLocForm] = useState(false);
  const [locCompanyId, setLocCompanyId] = useState('');
  const [locForm, setLocForm] = useState({ name: '', address: '', phone: '', floor: '', itRoom: '' });

  // SMTP form
  const [showSmtpForm, setShowSmtpForm] = useState(false);
  const [smtpCompanyId, setSmtpCompanyId] = useState('');
  const [smtpCompanyName, setSmtpCompanyName] = useState('');
  const [smtpForm, setSmtpForm] = useState(emptySmtpForm);
  const [smtpTesting, setSmtpTesting] = useState(false);

  const { data: companies } = useQuery({
    queryKey: ['companies-admin'],
    queryFn: async () => (await api.get('/companies/admin/all')).data.data,
  });

  const handleSubmitCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        allowedDomains: form.allowedDomains
          ? form.allowedDomains.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
          : [],
        portalDomains: form.portalDomains
          ? form.portalDomains.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
          : [],
        notificationEmail: form.notificationEmail || null,
      };
      if (editId) {
        await api.put(`/companies/${editId}`, payload);
        toast.success('Şirket güncellendi');
      } else {
        await api.post('/companies', payload);
        toast.success('Şirket eklendi');
      }
      queryClient.invalidateQueries({ queryKey: ['companies-admin'] });
      setShowForm(false);
      setEditId(null);
      setForm({ name: '', groupType: 'corporate', allowedDomains: '', portalDomains: '', notificationEmail: '' });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Hata');
    }
  };

  const handleSubmitLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/locations', { companyId: locCompanyId, ...locForm });
      toast.success('Lokasyon eklendi');
      queryClient.invalidateQueries({ queryKey: ['companies-admin'] });
      setShowLocForm(false);
      setLocForm({ name: '', address: '', phone: '', floor: '', itRoom: '' });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Hata');
    }
  };

  // SMTP handlers
  const openSmtpForm = async (companyId: string, companyName: string) => {
    setSmtpCompanyId(companyId);
    setSmtpCompanyName(companyName);
    try {
      const res = await api.get(`/companies/${companyId}/smtp`);
      if (res.data.data) {
        const s = res.data.data;
        setSmtpForm({ host: s.host, port: s.port, secure: s.secure, user: s.user, pass: '', fromName: s.fromName, fromEmail: s.fromEmail, isActive: s.isActive });
      } else {
        setSmtpForm(emptySmtpForm);
      }
    } catch {
      setSmtpForm(emptySmtpForm);
    }
    setShowSmtpForm(true);
  };

  const handleTestSmtp = async () => {
    if (!smtpForm.host || !smtpForm.user || !smtpForm.pass) {
      toast.error('Tüm SMTP alanları doldurulmalı');
      return;
    }
    setSmtpTesting(true);
    try {
      await api.post(`/companies/${smtpCompanyId}/smtp/test`, smtpForm);
      toast.success('SMTP bağlantısı başarılı!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Bağlantı başarısız');
    } finally {
      setSmtpTesting(false);
    }
  };

  const handleSaveSmtp = async () => {
    if (!smtpForm.host || !smtpForm.user || !smtpForm.fromEmail) {
      toast.error('Zorunlu alanları doldurun');
      return;
    }
    try {
      await api.put(`/companies/${smtpCompanyId}/smtp`, smtpForm);
      toast.success('SMTP ayarları kaydedildi');
      queryClient.invalidateQueries({ queryKey: ['companies-admin'] });
      setShowSmtpForm(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Kayıt başarısız');
    }
  };

  const handleDeleteSmtp = async () => {
    if (!confirm('SMTP ayarlarını kaldırmak istediğinize emin misiniz? Global SMTP kullanılacak.')) return;
    try {
      await api.delete(`/companies/${smtpCompanyId}/smtp`);
      toast.success('SMTP ayarları kaldırıldı');
      queryClient.invalidateQueries({ queryKey: ['companies-admin'] });
      setShowSmtpForm(false);
    } catch {
      toast.error('Silme başarısız');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Şirket & Lokasyon Yönetimi</h1>
        <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', groupType: 'corporate', allowedDomains: '', portalDomains: '', notificationEmail: '' }); }} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Yeni Şirket
        </button>
      </div>

      {/* Company Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold mb-4">{editId ? 'Şirket Düzenle' : 'Yeni Şirket'}</h2>
            <form onSubmit={handleSubmitCompany} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Şirket Adı *</label>
                <input type="text" className="input-field" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Grup Türü *</label>
                <select className="input-field" value={form.groupType} onChange={e => setForm({ ...form, groupType: e.target.value })}>
                  {GROUP_TYPES.map(gt => <option key={gt.value} value={gt.value}>{gt.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">İzinli Email Domainleri</label>
                <input type="text" className="input-field" value={form.allowedDomains} onChange={e => setForm({ ...form, allowedDomains: e.target.value })} placeholder="company.com, company.com.tr" />
                <p className="text-xs text-gray-400 mt-1">Virgülle ayırın. Boş bırakırsanız tüm email domainlerine açık olur.</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Portal Domain Kilidi</label>
                <input type="text" className="input-field" value={form.portalDomains} onChange={e => setForm({ ...form, portalDomains: e.target.value })} placeholder="ticket.abc.com.tr" />
                <p className="text-xs text-gray-400 mt-1">Bu domainlerden erişildiğinde sadece bu şirket için ticket açılabilir. Boş bırakırsanız genel portaldan erişilir.</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">IT Grup Email (Bildirim)</label>
                <input type="email" className="input-field" value={form.notificationEmail} onChange={e => setForm({ ...form, notificationEmail: e.target.value })} placeholder="it-destek@company.com" />
                <p className="text-xs text-gray-400 mt-1">Yeni ticket açıldığında bu adrese bildirim gönderilir.</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1">Kaydet</button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">İptal</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Location Form Modal */}
      {showLocForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold mb-4">Yeni Lokasyon</h2>
            <form onSubmit={handleSubmitLocation} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Lokasyon Adı *</label>
                <input type="text" className="input-field" value={locForm.name} onChange={e => setLocForm({ ...locForm, name: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Adres</label>
                <input type="text" className="input-field" value={locForm.address} onChange={e => setLocForm({ ...locForm, address: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Telefon</label>
                  <input type="tel" className="input-field" value={locForm.phone} onChange={e => setLocForm({ ...locForm, phone: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Kat</label>
                  <input type="text" className="input-field" value={locForm.floor} onChange={e => setLocForm({ ...locForm, floor: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">IT Odası</label>
                  <input type="text" className="input-field" value={locForm.itRoom} onChange={e => setLocForm({ ...locForm, itRoom: e.target.value })} />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1">Ekle</button>
                <button type="button" onClick={() => setShowLocForm(false)} className="btn-secondary flex-1">İptal</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SMTP Config Modal */}
      {showSmtpForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Mail className="w-5 h-5" /> SMTP Ayarları — {smtpCompanyName}
              </h2>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Boş bırakılırsa global SMTP ayarları kullanılır. Her şirket kendi SMTP sunucusuyla email gönderebilir.
            </p>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">SMTP Sunucu *</label>
                  <input type="text" className="input-field" value={smtpForm.host} onChange={e => setSmtpForm({ ...smtpForm, host: e.target.value })} placeholder="smtp.company.com" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">Port</label>
                    <input type="number" className="input-field" value={smtpForm.port} onChange={e => setSmtpForm({ ...smtpForm, port: parseInt(e.target.value) || 587 })} />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={smtpForm.secure} onChange={e => setSmtpForm({ ...smtpForm, secure: e.target.checked })} className="rounded" />
                      SSL/TLS
                    </label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Kullanıcı *</label>
                  <input type="text" className="input-field" value={smtpForm.user} onChange={e => setSmtpForm({ ...smtpForm, user: e.target.value })} placeholder="noreply@company.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Şifre *</label>
                  <input type="password" className="input-field" value={smtpForm.pass} onChange={e => setSmtpForm({ ...smtpForm, pass: e.target.value })} placeholder="••••••••" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Gönderen Adı *</label>
                  <input type="text" className="input-field" value={smtpForm.fromName} onChange={e => setSmtpForm({ ...smtpForm, fromName: e.target.value })} placeholder="ABC IT Destek" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Gönderen Email *</label>
                  <input type="email" className="input-field" value={smtpForm.fromEmail} onChange={e => setSmtpForm({ ...smtpForm, fromEmail: e.target.value })} placeholder="it@company.com" />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={smtpForm.isActive} onChange={e => setSmtpForm({ ...smtpForm, isActive: e.target.checked })} className="rounded" />
                  Aktif (pasifse global SMTP kullanılır)
                </label>
              </div>

              <div className="flex gap-2 pt-3 border-t">
                <button onClick={handleTestSmtp} disabled={smtpTesting} className="btn-secondary flex items-center gap-2 text-sm">
                  {smtpTesting ? 'Test ediliyor...' : 'Bağlantı Test Et'}
                </button>
                <div className="flex-1" />
                <button onClick={handleDeleteSmtp} className="btn-danger text-sm flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Kaldır
                </button>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={handleSaveSmtp} className="btn-primary flex-1">Kaydet</button>
                <button onClick={() => setShowSmtpForm(false)} className="btn-secondary flex-1">İptal</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Companies list */}
      <div className="space-y-4">
        {companies?.map((company: any) => (
          <div key={company.id} className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-primary-500" />
                <div>
                  <h3 className="font-semibold">{company.name}</h3>
                  <span className="text-xs text-gray-400">
                    {GROUP_TYPES.find(gt => gt.value === company.groupType)?.label} •
                    {company._count?.locations} lokasyon •
                    {company._count?.tickets} ticket
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => openSmtpForm(company.id, company.name)}
                  className={`btn-secondary text-xs flex items-center gap-1 ${company.smtpConfig ? 'ring-1 ring-green-300' : ''}`}
                  title={company.smtpConfig ? 'SMTP yapılandırılmış' : 'SMTP ayarla'}
                >
                  <Mail className="w-3 h-3" />
                  {company.smtpConfig ? (
                    <span className="flex items-center gap-1">
                      SMTP <CheckCircle2 className="w-3 h-3 text-green-500" />
                    </span>
                  ) : 'SMTP'}
                </button>
                <button
                  onClick={() => { setLocCompanyId(company.id); setShowLocForm(true); setLocForm({ name: '', address: '', phone: '', floor: '', itRoom: '' }); }}
                  className="btn-secondary text-xs flex items-center gap-1"
                >
                  <MapPin className="w-3 h-3" /> Lokasyon Ekle
                </button>
                <button
                  onClick={() => { setEditId(company.id); setForm({ name: company.name, groupType: company.groupType, allowedDomains: (company.allowedDomains as string[] || []).join(', '), portalDomains: (company.portalDomains as string[] || []).join(', '), notificationEmail: company.notificationEmail || '' }); setShowForm(true); }}
                  className="p-1.5 hover:bg-gray-100 rounded"
                >
                  <Edit2 className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            </div>

            {/* Domain restriction badges */}
            {company.allowedDomains && (company.allowedDomains as string[]).length > 0 && (
              <div className="mb-2 text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg">
                Email kısıtı: {(company.allowedDomains as string[]).join(', ')}
              </div>
            )}
            {company.portalDomains && (company.portalDomains as string[]).length > 0 && (
              <div className="mb-2 text-xs bg-purple-50 text-purple-700 px-3 py-1.5 rounded-lg">
                Portal kilidi: {(company.portalDomains as string[]).join(', ')}
              </div>
            )}

            {company.notificationEmail && (
              <div className="mb-2 text-xs bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg">
                IT Grup Email: {company.notificationEmail}
              </div>
            )}

            {/* SMTP Status Badge */}
            {company.smtpConfig && (
              <div className="mb-2 flex items-center gap-2 text-xs bg-green-50 text-green-700 px-3 py-1.5 rounded-lg">
                <Mail className="w-3 h-3" />
                <span>Özel SMTP: {company.smtpConfig.fromName} &lt;{company.smtpConfig.fromEmail}&gt; — {company.smtpConfig.host}:{company.smtpConfig.port}</span>
                {!company.smtpConfig.isActive && <span className="text-orange-600">(Pasif)</span>}
              </div>
            )}

            {company.locations?.length > 0 && (
              <div className="ml-8 space-y-1">
                {company.locations.map((loc: any) => (
                  <div key={loc.id} className="flex items-center gap-2 text-sm text-gray-600">
                    <MapPin className="w-3 h-3 text-gray-400" />
                    <span>{loc.name}</span>
                    {loc.address && <span className="text-gray-400">— {loc.address}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
