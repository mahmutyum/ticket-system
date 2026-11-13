export const lookupsMessages = {
  tr: {
    'lookups.key_required': 'Sözlük anahtarı zorunludur (küçük harf, rakam, alt çizgi)',
    'lookups.key_exists': 'Bu anahtar zaten kullanılıyor',
    'lookups.not_found': 'Sözlük girdisi bulunamadı',
    'lookups.missing_class': 'Girdide durum sınıfı tanımlı değil',
    'lookups.last_in_class': 'Bu sınıftaki son aktif durum pasifleştirilemez — sınıf davranışı bozulur',
    'lookups.merge_self': 'Girdi kendisiyle birleştirilemez',
    'lookups.merge_target_missing': 'Hedef anahtar bulunamadı veya aktif değil',
  } as Record<string, string>,
  en: {
    'lookups.key_required': 'Dictionary key is required (lowercase letters, digits, underscore)',
    'lookups.key_exists': 'This key is already in use',
    'lookups.not_found': 'Dictionary entry not found',
    'lookups.missing_class': 'Entry has no status class defined',
    'lookups.last_in_class': 'Cannot deactivate the last active status in this class — class behavior would break',
    'lookups.merge_self': 'Cannot merge an entry into itself',
    'lookups.merge_target_missing': 'Target key not found or not active',
  } as Record<string, string>,
};
