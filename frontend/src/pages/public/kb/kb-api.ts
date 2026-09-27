import axios from 'axios';
import i18n from 'i18next';

export type KbSummary = { id: string; title: string; excerpt: string; categoryId: string | null };
export type KbArticle = { id: string; title: string; body: string; categoryId: string | null; updatedAt: string };

const lang = () => (i18n.language?.startsWith('en') ? 'en' : 'tr');

export async function searchKb(params: { q?: string; companyId?: string; categoryId?: string }): Promise<KbSummary[]> {
  const res = await axios.get('/api/public/kb', { params: { ...params, locale: lang() } });
  return res.data.data;
}

export async function getKbArticle(id: string, companyId?: string): Promise<KbArticle> {
  const res = await axios.get(`/api/public/kb/${id}`, { params: { companyId, locale: lang() } });
  return res.data.data;
}

export async function sendKbFeedback(id: string, helpful: boolean, deflected = false): Promise<void> {
  await axios.post(`/api/public/kb/${id}/feedback`, { helpful, deflected });
}
