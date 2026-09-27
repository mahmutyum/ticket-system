/**
 * Küçük, bağımlılıksız CSV ayrıştırıcı (RFC 4180): tırnaklı alanlar, çift tırnak
 * kaçışı, alan içinde satır sonu. Ayraç ilk satırdan tahmin edilir (`;` Excel TR,
 * aksi hâlde `,`). BOM atılır.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

/** İlk satırı başlık kabul edip satırları nesneye çevirir (başlıklar küçük harf, kırpılmış). */
export function csvRecords(input: string): Array<{ line: number; values: Record<string, string> }> {
  const [header, ...rows] = parseCsv(input);
  if (!header) return [];
  const keys = header.map(h => h.trim().toLowerCase());
  return rows.map((r, i) => ({
    line: i + 2,
    values: Object.fromEntries(keys.map((k, j) => [k, (r[j] ?? '').trim()])),
  }));
}
