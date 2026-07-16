import type { Dispatch, FormEventHandler, SetStateAction } from 'react';
import type { LocationForm } from './company-management';

type LocationFormModalProps = {
  editId: string | null;
  form: LocationForm;
  setForm: Dispatch<SetStateAction<LocationForm>>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onClose: () => void;
};

export function LocationFormModal({
  editId,
  form,
  setForm,
  onSubmit,
  onClose,
}: LocationFormModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-strong rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">{editId ? 'Lokasyon Düzenle' : 'Yeni Lokasyon'}</h2>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Lokasyon Adı *</label>
            <input type="text" className="input-field" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Adres</label>
            <input type="text" className="input-field" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Telefon</label>
              <input type="tel" className="input-field" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Kat</label>
              <input type="text" className="input-field" value={form.floor} onChange={(event) => setForm({ ...form, floor: event.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">IT Odası</label>
              <input type="text" className="input-field" value={form.itRoom} onChange={(event) => setForm({ ...form, itRoom: event.target.value })} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1">{editId ? 'Güncelle' : 'Ekle'}</button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1">İptal</button>
          </div>
        </form>
      </div>
    </div>
  );
}
