import api from '../api/client';

/**
 * Kimlik doğrulamalı ek indirme.
 *
 * Ekler artık `/attachments/:id` üzerinden, yetki kontrolüyle servis ediliyor
 * (eskiden `/uploads/*` altından kimliksiz statik dosyalardı). Personel yetkisi
 * `Authorization: Bearer` header'ına dayanır ve düz bir `<a href>` header
 * gönderemez — bu yüzden dosya axios ile çekilip blob olarak indirilir.
 *
 * Talep edenler (public) bu yola girmez: onlar linke `?token=<accessToken>`
 * ekler, çünkü ellerinde Bearer token yoktur.
 */
export async function downloadAttachment(id: string, fileName: string): Promise<void> {
  const res = await api.get(`/attachments/${id}`, { responseType: 'blob' });

  const url = URL.createObjectURL(res.data as Blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Blob URL'i serbest bırak — yoksa dosya sekme kapanana dek bellekte kalır.
    URL.revokeObjectURL(url);
  }
}

/** Talep edenin (public) ek linki — Bearer yok, ticket'ın accessToken'ı var. */
export function publicAttachmentUrl(id: string, accessToken: string): string {
  return `/api/attachments/${id}?token=${encodeURIComponent(accessToken)}`;
}
