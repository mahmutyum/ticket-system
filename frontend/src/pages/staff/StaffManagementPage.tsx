import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, UserX, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';

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

  const { data: staffList } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => (await api.get('/staff')).data.data,
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
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'İşlem başarısız');
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

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
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
                <label className="block text-sm font-medium mb-1">{editId ? 'Yeni Şifre (boş bırakılırsa değişmez)' : 'Şifre *'}</label>
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

      {/* Staff table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-gray-500">
              <th className="px-4 py-3 font-medium">Ad Soyad</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Rol</th>
              <th className="px-4 py-3 font-medium">Departman</th>
              <th className="px-4 py-3 font-medium">Ticket</th>
              <th className="px-4 py-3 font-medium">Durum</th>
              <th className="px-4 py-3 font-medium">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {staffList?.map((staff: any) => (
              <tr key={staff.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{staff.fullName}</td>
                <td className="px-4 py-3 text-gray-500">{staff.email}</td>
                <td className="px-4 py-3">{ROLES.find(r => r.value === staff.role)?.label}</td>
                <td className="px-4 py-3 text-gray-500">{staff.department || '-'}</td>
                <td className="px-4 py-3">{staff._count?.assignedTickets || 0}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${staff.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {staff.isActive ? 'Aktif' : 'Pasif'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => handleEdit(staff)} className="p-1 hover:bg-gray-200 rounded">
                      <Edit2 className="w-4 h-4 text-gray-500" />
                    </button>
                    <button onClick={() => handleToggleActive(staff.id, staff.isActive)} className="p-1 hover:bg-gray-200 rounded">
                      {staff.isActive ? <UserX className="w-4 h-4 text-red-500" /> : <UserCheck className="w-4 h-4 text-green-500" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
