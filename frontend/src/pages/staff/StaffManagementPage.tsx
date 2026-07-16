import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, UserX, UserCheck, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { getApiError } from '../../utils/api-error';

const ROLES = [
  { value: 'admin', label: 'Sistem Yöneticisi' },
  { value: 'it_manager', label: 'IT Yöneticisi' },
  { value: 'it_staff', label: 'IT Personeli' },
];

interface StaffForm {
  email: string;
  fullName: string;
  password: string;
  role: string;
  department: string;
  phone: string;
}

const emptyForm: StaffForm = { email: '', fullName: '', password: '', role: 'it_staff', department: '', phone: '' };

export default function StaffManagementPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<StaffForm>(emptyForm);

  // Company assignment
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [companyStaffId, setCompanyStaffId] = useState('');
  const [companyStaffName, setCompanyStaffName] = useState('');
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);

  const { data: staffList } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => (await api.get('/staff')).data.data,
  });

  const { data: allCompanies } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => (await api.get('/companies')).data.data,
  });

  const update = (fields: Partial<StaffForm>) => setForm(prev => ({ ...prev, ...fields }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editId) {
        const payload: any = { ...form };
        if (!payload.password) delete payload.password;
        delete payload.email;
        await api.put(`/staff/${editId}`, payload);
        toast.success('Personel güncellendi');
      } else {
        await api.post('/staff', form);
        toast.success('Personel eklendi');
      }
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      setShowForm(false);
      setEditId(null);
      setForm(emptyForm);
    } catch (err: unknown) {
      toast.error(getApiError(err, 'İşlem başarısız'));
    }
  };

  const handleEdit = (staff: any) => {
    setEditId(staff.id);
    setForm({
      email: staff.email,
      fullName: staff.fullName,
      password: '',
      role: staff.role,
      department: staff.department || '',
      phone: staff.phone || '',
    });
    setShowForm(true);
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      if (isActive) {
        await api.delete(`/staff/${id}`);
        toast.success('Personel deaktif edildi');
      } else {
        await api.put(`/staff/${id}`, { isActive: true });
        toast.success('Personel aktif edildi');
      }
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    } catch {
      toast.error('İşlem başarısız');
    }
  };

  const openCompanyModal = (staff: any) => {
    setCompanyStaffId(staff.id);
    setCompanyStaffName(staff.fullName);
    setSelectedCompanyIds(
      (staff.assignedCompanies || []).map((ac: any) => ac.companyId)
    );
    setShowCompanyModal(true);
  };

  const handleSaveCompanies = async () => {
    try {
      await api.put(`/staff/${companyStaffId}/companies`, { companyIds: selectedCompanyIds });
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      setShowCompanyModal(false);
      toast.success('Şirket atamaları güncellendi');
    } catch {
      toast.error('Güncelleme başarısız');
    }
  };

  const toggleCompany = (id: string) => {
    setSelectedCompanyIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Personel Yönetimi</h1>
        <button
          onClick={() => { setShowForm(true); setEditId(null); setForm(emptyForm); }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Yeni Personel
        </button>
      </div>

      {/* Staff Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="card w-full max-w-md">
            <h2 className="text-lg font-bold mb-4">{editId ? 'Personel Düzenle' : 'Yeni Personel'}</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              {!editId && (
                <div>
                  <label className="block text-sm font-medium mb-1">Email *</label>
                  <input type="email" className="input-field" value={form.email} onChange={e => update({ email: e.target.value })} required />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">Ad Soyad *</label>
                <input type="text" className="input-field" value={form.fullName} onChange={e => update({ fullName: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{editId ? 'Yeni Şifre (boş = değişmez)' : 'Şifre *'}</label>
                <input type="password" className="input-field" value={form.password} onChange={e => update({ password: e.target.value })} required={!editId} minLength={8} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Rol *</label>
                <select className="input-field" value={form.role} onChange={e => update({ role: e.target.value })}>
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Departman</label>
                  <input type="text" className="input-field" value={form.department} onChange={e => update({ department: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Telefon</label>
                  <input type="tel" className="input-field" value={form.phone} onChange={e => update({ phone: e.target.value })} />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1">Kaydet</button>
                <button type="button" onClick={() => { setShowForm(false); setEditId(null); }} className="btn-secondary flex-1">İptal</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Company Assignment Modal */}
      {showCompanyModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="card w-full max-w-md">
            <h2 className="text-lg font-bold mb-2">Şirket Ataması</h2>
            <p className="text-sm text-gray-500 mb-4">
              <strong>{companyStaffName}</strong> hangi şirketlerin taleplerini görebilir?
            </p>
            <p className="text-xs text-gray-400 mb-3">
              Hiçbiri seçilmezse tüm şirketlere erişir. Admin ve IT Yöneticisi her zaman hepsini görür.
            </p>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {allCompanies?.map((c: any) => (
                <label
                  key={c.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedCompanyIds.includes(c.id) ? 'border-primary-500 bg-primary-50' : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedCompanyIds.includes(c.id)}
                    onChange={() => toggleCompany(c.id)}
                    className="rounded text-primary-600"
                  />
                  <div>
                    <span className="font-medium text-sm">{c.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{c.groupType}</span>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex gap-3 pt-4 mt-4 border-t">
              <button onClick={handleSaveCompanies} className="btn-primary flex-1">Kaydet</button>
              <button onClick={() => setShowCompanyModal(false)} className="btn-secondary flex-1">İptal</button>
            </div>
          </div>
        </div>
      )}

      {/* Staff table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-800/50 text-left text-gray-500">
              <th className="px-4 py-3 font-medium">Ad Soyad</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Rol</th>
              <th className="px-4 py-3 font-medium">Şirketler</th>
              <th className="px-4 py-3 font-medium">Ticket</th>
              <th className="px-4 py-3 font-medium">Durum</th>
              <th className="px-4 py-3 font-medium">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {staffList?.map((staff: any) => {
              const companyNames = (staff.assignedCompanies || []).map((ac: any) => ac.company?.name).filter(Boolean);
              return (
                <tr key={staff.id} className="border-t hover:bg-gray-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-medium">{staff.fullName}</td>
                  <td className="px-4 py-3 text-gray-500">{staff.email}</td>
                  <td className="px-4 py-3 text-xs">{ROLES.find(r => r.value === staff.role)?.label}</td>
                  <td className="px-4 py-3">
                    {staff.role === 'admin' || staff.role === 'it_manager' ? (
                      <span className="text-xs text-gray-400">Tümü</span>
                    ) : companyNames.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {companyNames.map((name: string) => (
                          <span key={name} className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{name}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">Tümü (kısıtsız)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{staff._count?.assignedTickets || 0}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${staff.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {staff.isActive ? 'Aktif' : 'Pasif'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => openCompanyModal(staff)} className="p-1 hover:bg-purple-100 rounded" title="Şirket ataması">
                        <Building2 className="w-4 h-4 text-purple-500" />
                      </button>
                      <button onClick={() => handleEdit(staff)} className="p-1 hover:bg-gray-200 rounded" title="Düzenle">
                        <Edit2 className="w-4 h-4 text-gray-500" />
                      </button>
                      <button onClick={() => handleToggleActive(staff.id, staff.isActive)} className="p-1 hover:bg-gray-200 rounded" title={staff.isActive ? 'Deaktif et' : 'Aktif et'}>
                        {staff.isActive ? <UserX className="w-4 h-4 text-red-500" /> : <UserCheck className="w-4 h-4 text-green-500" />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
