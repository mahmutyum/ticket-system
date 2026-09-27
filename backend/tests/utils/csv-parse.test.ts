import { describe, it, expect } from 'vitest';
import { csvRecords, parseCsv } from '../../src/utils/csv-parse.js';

describe('parseCsv', () => {
  it('tırnaklı alan, kaçış ve alan içi satır sonu', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nline2"\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nline2']]);
  });
  it('noktalı virgül ayracını ve BOM\'u tanır, boş satırları atar', () => {
    expect(parseCsv('\uFEFFtag;name\r\nLT-1;Laptop\r\n\r\n')).toEqual([['tag', 'name'], ['LT-1', 'Laptop']]);
  });
  it('başlıklı kayıtlar satır numarasıyla döner', () => {
    expect(csvRecords('Tag,Name\nLT-1 , Laptop\n')).toEqual([{ line: 2, values: { tag: 'LT-1', name: 'Laptop' } }]);
  });
});
