import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, BarChart3, Clock, CheckCircle2, Users, Tag } from 'lucide-react';
import api from '../../api/client';

export default function ReportsPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const dateParams = `${dateFrom ? `&dateFrom=${dateFrom}` : ''}${dateTo ? `&dateTo=${dateTo}` : ''}`;

  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => (await api.get('/dashboard/stats')).data.data,
  });

  const { data: sla } = useQuery({
    queryKey: ['sla-report'],
    queryFn: async () => (await api.get('/dashboard/sla')).data.data,
  });

  const { data: staffPerf } = useQuery({
    queryKey: ['staff-performance', dateFrom, dateTo],
    queryFn: async () => (await api.get(`/reports/staff-performance?${dateParams.replace('&', '')}`)).data.data,
  });

  const { data: categoryBreakdown } = useQuery({
    queryKey: ['category-breakdown', dateFrom, dateTo],
    queryFn: async () => (await api.get(`/reports/categories?${dateParams.replace('&', '')}`)).data.data,
  });

  const handleExport = () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    // Use backend CSV export endpoint — opens download directly
    window.open(`/api/reports/export/csv?${params.toString()}`, '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Raporlar & İstatistikler</h1>
        <button onClick={handleExport} className="btn-primary flex items-center gap-2">
          <Download className="w-4 h-4" /> CSV İndir
        </button>
      </div>

      {/* Date filters */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Başlangıç</label>
            <input type="date" className="input-field" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Bitiş</label>
            <input type="date" className="input-field" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="btn-secondary text-sm">
              Filtreyi Temizle
            </button>
          )}
        </div>
      </div>

      {/* SLA Report */}
      {sla && (
        <div className="grid md:grid-cols-3 gap-4">
          <div className="card text-center">
            <BarChart3 className="w-8 h-8 text-primary-500 mx-auto mb-2" />
            <p className="text-3xl font-bold">{sla.totalWithSla}</p>
            <p className="text-sm text-gray-500">SLA Tanımlı Talep</p>
          </div>
          <div className="card text-center">
            <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
            <p className="text-3xl font-bold text-green-600">{sla.response.complianceRate}%</p>
            <p className="text-sm text-gray-500">Yanıt SLA Uyumu</p>
            <p className="text-xs text-gray-400 mt-1">{sla.response.met} başarılı / {sla.response.violated} ihlal</p>
          </div>
          <div className="card text-center">
            <Clock className="w-8 h-8 text-blue-500 mx-auto mb-2" />
            <p className="text-3xl font-bold text-blue-600">{sla.resolution.complianceRate}%</p>
            <p className="text-sm text-gray-500">Çözüm SLA Uyumu</p>
            <p className="text-xs text-gray-400 mt-1">{sla.resolution.met} başarılı / {sla.resolution.violated} ihlal</p>
          </div>
        </div>
      )}

      {/* Staff Performance */}
      {staffPerf && staffPerf.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Users className="w-5 h-5" /> Personel Performansı
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 font-medium">Personel</th>
                  <th className="pb-2 font-medium text-center">Toplam</th>
                  <th className="pb-2 font-medium text-center">Çözülen</th>
                  <th className="pb-2 font-medium text-center">Açık</th>
                  <th className="pb-2 font-medium text-center">Yanıt SLA</th>
                  <th className="pb-2 font-medium text-center">Çözüm SLA</th>
                  <th className="pb-2 font-medium text-center">Ort. Çözüm (saat)</th>
                </tr>
              </thead>
              <tbody>
                {staffPerf.map((s: any) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">{s.fullName}</td>
                    <td className="py-2 text-center">{s.totalAssigned}</td>
                    <td className="py-2 text-center text-green-600">{s.resolved}</td>
                    <td className="py-2 text-center text-orange-600">{s.open}</td>
                    <td className="py-2 text-center">
                      {s.slaResponseRate !== null ? (
                        <span className={s.slaResponseRate >= 80 ? 'text-green-600' : 'text-red-600'}>
                          {s.slaResponseRate}%
                        </span>
                      ) : '-'}
                    </td>
                    <td className="py-2 text-center">
                      {s.slaResolveRate !== null ? (
                        <span className={s.slaResolveRate >= 80 ? 'text-green-600' : 'text-red-600'}>
                          {s.slaResolveRate}%
                        </span>
                      ) : '-'}
                    </td>
                    <td className="py-2 text-center">
                      {s.avgResolutionHours !== null ? `${s.avgResolutionHours}h` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Category breakdown */}
      {categoryBreakdown && categoryBreakdown.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Tag className="w-5 h-5" /> Kategoriye Göre Dağılım
          </h3>
          <div className="space-y-2">
            {categoryBreakdown.map((item: any) => {
              const total = categoryBreakdown.reduce((s: number, i: any) => s + i.count, 0);
              const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
              return (
                <div key={item.categoryId} className="flex items-center gap-3">
                  <span className="text-sm w-48 truncate">{item.categoryName}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3">
                    <div className="bg-primary-500 h-3 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm font-bold w-12 text-right">{item.count}</span>
                  <span className="text-xs text-gray-400 w-10 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Status & Priority */}
      {stats && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="font-semibold mb-4">Duruma Göre</h3>
            <div className="space-y-2">
              {stats.byStatus.map((item: any) => {
                const total = stats.byStatus.reduce((s: number, i: any) => s + i.count, 0);
                const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                return (
                  <div key={item.status} className="flex items-center gap-3">
                    <span className="text-sm w-40 truncate">{item.status}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-3">
                      <div className="bg-primary-500 h-3 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-sm font-bold w-12 text-right">{item.count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold mb-4">Şirkete Göre</h3>
            <div className="space-y-2">
              {stats.byCompany.map((item: any) => (
                <div key={item.companyId} className="flex items-center justify-between py-1">
                  <span className="text-sm">{item.companyName}</span>
                  <span className="text-sm font-bold">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
