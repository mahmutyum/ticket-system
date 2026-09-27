export const kbMessages = {
  tr: {
    'kb.not_found': 'Makale bulunamadı',
    'kb.forbidden': 'Bu şirketin makalelerini düzenleme yetkiniz yok',
    'kb.global_admin_only': 'Tüm şirketlerde görünen makaleleri yalnızca sistem yöneticisi düzenleyebilir',
    'kb.invalid_category': 'Kategori bu makalenin şirketine ait değil',
  } as Record<string, string>,
  en: {
    'kb.not_found': 'Article not found',
    'kb.forbidden': "You are not allowed to edit this company's articles",
    'kb.global_admin_only': 'Only a system administrator can edit articles shown to all companies',
    'kb.invalid_category': "The category does not belong to this article's company",
  } as Record<string, string>,
};
