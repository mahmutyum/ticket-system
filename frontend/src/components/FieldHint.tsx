/**
 * Alan altındaki karakter sayacı / alt sınır uyarısı.
 *
 * Amaç: kuralı kullanıcıya GÖNDERMEDEN ÖNCE göstermek. Sınırlar backend'de zaten
 * zorlanıyor; burada görünür olmazsa kullanıcı yazıp 400 yiyor ve nedenini
 * anlamıyor.
 */
export default function FieldHint({
  value,
  min,
  max,
}: {
  value: string;
  min?: number;
  max: number;
}) {
  const length = value.trim().length;
  const tooShort = min !== undefined && length > 0 && length < min;
  const nearMax = length > max * 0.9;

  return (
    <div className="flex items-center justify-between mt-1 text-xs">
      <span className={tooShort ? 'text-red-600' : 'text-muted'}>
        {tooShort ? `En az ${min} karakter gerekli` : min ? `En az ${min} karakter` : ''}
      </span>
      <span className={nearMax ? 'text-orange-600' : 'text-muted'}>
        {length}/{max}
      </span>
    </div>
  );
}
