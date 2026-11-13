/**
 * TanStack Query anahtarları için tek kaynak.
 *
 * Aynı kaynak eskiden farklı anahtar adlarıyla sorgulanıyordu (ör. şirketler:
 * `['companies']`, `['companies-admin']`, `['companies-list']`,
 * `['companies-scoped']`…). TanStack önek (prefix) eşleşmesiyle geçersiz
 * kılar; bu adlar ortak bir köke sahip olmadığı için bir sayfada yapılan
 * yazma, diğer sayfaların görünümünü eskitiyordu.
 *
 * Kural: her kaynak TEK kök altında hiyerarşik anahtarlar kullanır
 * (`['companies', 'admin']` gibi); yazma işlemleri KÖKÜ geçersiz kılar
 * (`qk.companies.all`) — böylece o kaynağın tüm görünümleri tazelenir.
 * Sorgu tarafları mümkün olduğunca en spesifik yaprak anahtarı kullanır.
 */
export const qk = {
  companies: {
    /** Geçersizleme kökü — tüm şirket görünümlerini tazeler. */
    all: ['companies'] as const,
    /** GET /companies — aktif şirketler (portal, görev, rapor seçicileri). */
    active: ['companies', 'active'] as const,
    /** GET /companies/admin/all — yönetim listesi (admin panelleri). */
    admin: ['companies', 'admin'] as const,
  },
  staff: {
    /** Geçersizleme kökü. */
    all: ['staff'] as const,
    /** GET /staff — personel seçicileri ve yönetim listesi. */
    list: ['staff', 'list'] as const,
    /** Atanan personel listesi; companyId filtresi anahtarın parçası. */
    listFor: (companyId?: string | null) =>
      companyId ? (['staff', 'list', companyId] as const) : (['staff', 'list'] as const),
  },
  categories: {
    /** Geçersizleme kökü. */
    all: ['categories'] as const,
    /** GET /categories — global liste (raporlar). */
    global: ['categories', 'global'] as const,
    /** GET /companies/:companyId/categories — şirketin kategorileri. */
    forCompany: (companyId?: string | null) => ['categories', 'company', companyId] as const,
    /** GET /categories/admin?companyId= — yönetim görünümü. */
    adminFor: (companyId: string) => ['categories', 'admin', companyId] as const,
  },
};
