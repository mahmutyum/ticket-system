import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, MapPin, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';

const GROUP_TYPES = [
  { value: 'call_center', label: 'Çağrı Merkezi' },
  { value: 'corporate', label: 'Kurumsal' },
  { value: 'warehouse', label: 'Depo / Lojistik' },
  { value: 'retail', label: 'Mağaza / Perakende' },
];

export default function CompanyManagementPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', groupType: 'corporate' });

  // Location form
  const [showLocForm, setShowLocForm] = useState(false);
  const [locCompanyId, setLocCompanyId] = useState('');
  const [locForm, setLocForm] = useState({ name: '', address: '', phone: '', floor: '', itRoom: '' });

  const { data: companies } = useQuery({
    queryKey: ['companies-admin'],
    queryFn: async () => (await api.get('/companies/admin/all')).data.data,
  });

  const handleSubmitCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editId) {
        await api.put(`/companies/${editId}`, form);
        toast.success('Şirket güncellendi');
      } else {
        await api.post('/companies', form);
        toast.success('Şirket eklendi');
      }
      queryClient.invalidateQueries({ queryKey: ['companies-admin'] });
      setShowForm(false);
      setEditId(null);
      setForm({ name: '', groupType: 'corporate' });
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Şirket & Lokasyon Yönetimi</h1>
        <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', groupType: 'corporate' }); }} className="btn-primary flex items-center gap-2">
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
                  onClick={() => { setLocCompanyId(company.id); setShowLocForm(true); setLocForm({ name: '', address: '', phone: '', floor: '', itRoom: '' }); }}
                  className="btn-secondary text-xs flex items-center gap-1"
                >
                  <MapPin className="w-3 h-3" /> Lokasyon Ekle
                </button>
                <button
                  onClick={() => { setEditId(company.id); setForm({ name: company.name, groupType: company.groupType }); setShowForm(true); }}
                  className="p-1.5 hover:bg-gray-100 rounded"
                >
                  <Edit2 className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            </div>
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
