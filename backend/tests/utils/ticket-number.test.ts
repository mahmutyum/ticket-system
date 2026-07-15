import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Ticket numarası üretimi.
 *
 * İki gerçek risk:
 *
 * 1. **Yarış durumu.** Numara `INCR` ile üretiliyor. Eşzamanlı isteklerde aynı
 *    numaranın iki kez verilmesi `ticketNumber @unique` ihlaline ve 500'e yol
 *    açardı. INCR atomiktir; buradaki testler eşzamanlılıkta çakışma OLMADIĞINI
 *    doğrular.
 *
 * 2. **Soğuk başlangıç.** Redis silinirse sayaç 1'den başlar ve MEVCUT
 *    ticket'larla çakışır. Lua script'i, anahtar yoksa DB'deki en büyük numaradan
 *    tohumlar — ve bunu INCR ile TEK atomik adımda yapar (önce EXISTS sonra SET
 *    yapılsaydı iki istek arasında yarış olurdu).
 */

const evalMock = vi.fn();
const findFirstMock = vi.fn();

vi.mock('../../src/jobs/queue.js', () => ({
  redisConnection: { eval: (...a: unknown[]) => evalMock(...a) },
}));
vi.mock('../../src/db.js', () => ({
  prisma: { ticket: { findFirst: (...a: unknown[]) => findFirstMock(...a) } },
}));

beforeEach(() => {
  evalMock.mockReset();
  findFirstMock.mockReset();
});

async function subject() {
  return import('../../src/utils/ticket-number.js');
}

describe('generateTicketNumber', () => {
  it('numarayı 5 haneye sıfırla doldurur', async () => {
    findFirstMock.mockResolvedValue(null);
    evalMock.mockResolvedValue(7);
    const { generateTicketNumber } = await subject();
    const n = await generateTicketNumber();
    expect(n).toMatch(/^TKT-\d{4}-00007$/);
  });

  it('5 haneyi aşan numarayı kırpmaz', async () => {
    findFirstMock.mockResolvedValue(null);
    evalMock.mockResolvedValue(123456);
    const { generateTicketNumber } = await subject();
    expect(await generateTicketNumber()).toMatch(/-123456$/);
  });

  it('içinde bulunulan yılı kullanır', async () => {
    findFirstMock.mockResolvedValue(null);
    evalMock.mockResolvedValue(1);
    const { generateTicketNumber } = await subject();
    const n = await generateTicketNumber();
    expect(n.startsWith(`TKT-${new Date().getFullYear()}-`)).toBe(true);
  });

  it('DB boşsa tohum 0 — ilk INCR 1 döndürsün', async () => {
    findFirstMock.mockResolvedValue(null);
    evalMock.mockResolvedValue(1);
    const { generateTicketNumber } = await subject();
    await generateTicketNumber();
    // eval(script, numKeys, key, seed)
    expect(evalMock.mock.calls[0][3]).toBe('0');
  });

  it('soğuk başlangıçta tohumu DB\'deki EN BÜYÜK numaradan alır', async () => {
    // Redis silinmiş senaryosu: tohum yanlış hesaplanırsa mevcut ticket'larla
    // çakışır ve unique ihlali olur.
    findFirstMock.mockResolvedValue({ ticketNumber: `TKT-${new Date().getFullYear()}-00042` });
    evalMock.mockResolvedValue(43);
    const { generateTicketNumber } = await subject();
    const n = await generateTicketNumber();
    expect(evalMock.mock.calls[0][3]).toBe('42');
    expect(n).toMatch(/-00043$/);
  });

  it('bozuk numara tohumu çökertmez (0\'a düşer)', async () => {
    findFirstMock.mockResolvedValue({ ticketNumber: `TKT-${new Date().getFullYear()}-BOZUK` });
    evalMock.mockResolvedValue(1);
    const { generateTicketNumber } = await subject();
    await generateTicketNumber();
    expect(evalMock.mock.calls[0][3]).toBe('0');
  });

  it('tohumlama ve artırma TEK atomik çağrıdır', async () => {
    // Ayrı EXISTS + SET + INCR olsaydı iki istek arasında yarış olurdu.
    findFirstMock.mockResolvedValue(null);
    evalMock.mockResolvedValue(1);
    const { generateTicketNumber } = await subject();
    await generateTicketNumber();
    expect(evalMock).toHaveBeenCalledOnce();
    const script = String(evalMock.mock.calls[0][0]);
    expect(script).toContain('EXISTS');
    expect(script).toContain('INCR');
  });

  it('eşzamanlı çağrılar ÇAKIŞMAZ', async () => {
    findFirstMock.mockResolvedValue(null);
    // INCR'ın atomik davranışını taklit et.
    let counter = 0;
    evalMock.mockImplementation(async () => ++counter);

    const { generateTicketNumber } = await subject();
    const numbers = await Promise.all(Array.from({ length: 50 }, () => generateTicketNumber()));

    expect(new Set(numbers).size).toBe(50);
  });
});
