import { describe, it, expect } from 'vitest';
import {
  renderHtmlTemplate,
  renderTextTemplate,
  renderSubjectTemplate,
} from '../../src/services/email.service.js';

/**
 * E-posta şablon render'ı.
 *
 * Şablon gövdeleri HTML'dir ve doldurulan değerlerin çoğu KİMLİKSİZ kullanıcıdan
 * gelir: ticket konusu, ad soyad, public yanıt metni. Kaçışlama yokken saldırgan
 * IT grup mailine, şirketin kendi SMTP'sinden DKIM imzalı, meşru görünen bir
 * phishing bloğu enjekte edebiliyordu.
 */

describe('renderHtmlTemplate — HTML kaçışlama', () => {
  it('yer tutucuyu doldurur', () => {
    expect(renderHtmlTemplate('<p>Merhaba {{ad}}</p>', { ad: 'Ali' })).toBe('<p>Merhaba Ali</p>');
  });

  it('gerçek phishing payloadını zararsızlaştırır', () => {
    // Ajanın bildirdiği exploit: konu alanından <li> kapatıp kendi bloğunu açmak.
    const payload =
      'Yazıcı arızası</li></ul><h2>ACİL: Parolanızı doğrulayın</h2>' +
      '<p><a href="https://evil.tld/login">IT Portalına giriş yapın</a></p><ul><li>';
    const out = renderHtmlTemplate('<ul><li><strong>Konu:</strong> {{subject}}</li></ul>', {
      subject: payload,
    });

    // Saldırganın enjekte ettiği hiçbir etiket ÇALIŞMAZ hale gelmeli.
    expect(out).not.toContain('<h2>');
    expect(out).not.toContain('<a href=');
    // Şablonun KENDİ yapısı bozulmamalı: payload'ın </li></ul>'si kaçışlanır,
    // geriye yalnızca şablonun tek bir kapanışı kalır.
    expect(out.match(/<\/li><\/ul>/g)).toHaveLength(1);
    // Metin olarak görünmeye devam eder.
    expect(out).toContain('&lt;h2&gt;');
    expect(out).toContain('Yazıcı arızası');
  });

  it('script etiketini kaçışlar', () => {
    const out = renderHtmlTemplate('<div>{{x}}</div>', { x: '<script>alert(1)</script>' });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('attribute kırılmasını engeller', () => {
    const out = renderHtmlTemplate('<a title="{{x}}">l</a>', { x: '" onmouseover="alert(1)' });
    expect(out).not.toContain('onmouseover="alert(1)"');
    expect(out).toContain('&quot;');
  });

  it('& karakterini bir kez kaçışlar (çift kaçışlama yok)', () => {
    expect(renderHtmlTemplate('{{x}}', { x: 'A & B' })).toBe('A &amp; B');
  });

  it("replacement string tuzağı: $` şablon metnini yansıtmaz", () => {
    // String.replace replacement'ında $` "eşleşmeden önceki metin" demektir.
    // Değer doğrudan verilseydi çıktı 'ÖNCEsonra' olurdu.
    const out = renderHtmlTemplate('ÖNCE{{x}}SONRA', { x: '$`' });
    expect(out).toBe('ÖNCE$`SONRA');
  });

  it("replacement string tuzağı: $& eşleşmeyi yansıtmaz", () => {
    // & HTML'de kaçışlanır (doğru davranış); önemli olan $&'in YORUMLANMAMASI —
    // yorumlansaydı çıktıda '{{x}}' görünürdü.
    expect(renderHtmlTemplate('a{{x}}b', { x: '$&' })).toBe('a$&amp;b');
    expect(renderHtmlTemplate('a{{x}}b', { x: '$&' })).not.toContain('{{x}}');
  });

  it('değer içindeki {{...}} genişletilMEZ (tek geçiş)', () => {
    // Regresyon: döngülü render'da 'a' değerindeki {{b}} sonraki turda
    // genişliyordu — kullanıcı girdisi başka bir şablon değişkenini tetikliyordu.
    const out = renderHtmlTemplate('{{a}}|{{b}}', { a: '{{b}}', b: 'GİZLİ' });
    expect(out).toBe('{{b}}|GİZLİ');
  });

  it('bilinmeyen yer tutucu olduğu gibi kalır', () => {
    expect(renderHtmlTemplate('[{{yok}}]', { x: 'a' })).toBe('[{{yok}}]');
  });

  it('tanımsız değer boş stringe düşer', () => {
    expect(renderHtmlTemplate('[{{x}}]', { x: undefined as unknown as string })).toBe('[]');
  });
});

describe('renderTextTemplate — düz metin', () => {
  it('kaçışlama YAPMAZ (HTML bağlamı yok)', () => {
    expect(renderTextTemplate('Konu: {{x}}', { x: 'A & B <c>' })).toBe('Konu: A & B <c>');
  });

  it('replacement tuzağına yine de düşmez', () => {
    expect(renderTextTemplate('a{{x}}b', { x: "$'" })).toBe("a$'b");
  });
});

describe('renderSubjectTemplate — başlık', () => {
  it('CR/LF temizler (başlık enjeksiyonu)', () => {
    const out = renderSubjectTemplate('[{{no}}] {{konu}}', {
      no: 'TKT-1',
      konu: 'Arıza\r\nBcc: kurban@firma.com',
    });
    expect(out).not.toContain('\r');
    expect(out).not.toContain('\n');
    expect(out).toContain('Bcc: kurban@firma.com'); // metin kalır, satır sonu gider
  });

  it('normal konuyu bozmaz', () => {
    expect(renderSubjectTemplate('[{{no}}] {{konu}}', { no: 'TKT-1', konu: 'Yazıcı' }))
      .toBe('[TKT-1] Yazıcı');
  });
});
