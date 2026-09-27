export const assetsMessages = {
  tr: {
    'assets.not_found': 'Varlık bulunamadı',
    'assets.forbidden': 'Bu şirketin varlıkları için yetkiniz yok',
    'assets.invalid_location': 'Lokasyon bu şirkete ait değil',
    'assets.tag_exists': 'Bu etiket bu şirkette zaten kullanılıyor',
    'assets.company_immutable': 'Varlığın şirketi değiştirilemez',
    'assets.import_too_large': 'Tek seferde en fazla 5000 satır içe aktarılabilir',
    'assets.other_company': 'Varlık talebin şirketine ait değil',
  } as Record<string, string>,
  en: {
    'assets.not_found': 'Asset not found',
    'assets.forbidden': "You are not allowed to manage this company's assets",
    'assets.invalid_location': 'The location does not belong to this company',
    'assets.tag_exists': 'This tag is already used in this company',
    'assets.company_immutable': "An asset's company cannot be changed",
    'assets.import_too_large': 'At most 5000 rows can be imported at once',
    'assets.other_company': "The asset does not belong to the request's company",
  } as Record<string, string>,
};
