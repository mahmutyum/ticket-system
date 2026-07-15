const TR_TZ = 'Europe/Istanbul';

export function formatTrDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('tr-TR', {
    timeZone: TR_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTrDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('tr-TR', {
    timeZone: TR_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
