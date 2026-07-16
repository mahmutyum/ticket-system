/**
 * Çift dil (TR/EN) ekran görüntüsü üretici.
 *
 * Çalışan dev sunucusuna (http://localhost:1111) bağlanır, her dil için public
 * portal + tüm yönetim ekranlarını gezip `docs/screenshots/<sayfa>-<dil>.png`
 * olarak kaydeder. Dil, i18next'in localStorage tabanlı algılaması `lang`
 * anahtarına yazılarak zorlanır (addInitScript her navigasyondan önce çalışır).
 *
 * Kullanım (docker dev ayakta + seed yapılmışken):
 *   node scripts/screenshots.mjs
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', '..', 'docs', 'screenshots');
const BASE = process.env.SHOT_BASE || 'http://localhost:1111';
const ADMIN = { email: 'admin@company.com', password: 'admin123' };

const publicPages = [
  { path: '/', name: 'public-home' },
  { path: '/create', name: 'public-create-ticket' },
  { path: '/track', name: 'public-track' },
];
const loginPage = { path: '/staff/login', name: 'staff-login' };
const staffPages = [
  { path: '/staff', name: 'staff-dashboard' },
  { path: '/staff/tickets', name: 'staff-tickets' },
  { path: '/staff/tasks', name: 'staff-tasks' },
  { path: '/staff/onsite', name: 'staff-onsite' },
  { path: '/staff/companies', name: 'staff-companies' },
  { path: '/staff/staff-management', name: 'staff-management' },
  { path: '/staff/reports', name: 'staff-reports' },
  { path: '/staff/templates', name: 'staff-templates' },
  { path: '/staff/passwords', name: 'staff-passwords' },
  { path: '/staff/account', name: 'staff-account' },
];

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(700);
}

async function shot(page, name, lang) {
  const file = join(OUT, `${name}-${lang}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('  ✓', `${name}-${lang}.png`);
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  for (const lang of ['tr', 'en']) {
    console.log(`\n=== ${lang.toUpperCase()} ===`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // i18next'i bu dile sabitle (her sayfa yüklenmeden önce).
    await context.addInitScript((l) => {
      try { window.localStorage.setItem('lang', l); } catch { /* ignore */ }
    }, lang);
    const page = await context.newPage();

    // Public sayfalar
    for (const p of publicPages) {
      await page.goto(BASE + p.path, { waitUntil: 'domcontentloaded' });
      await settle(page);
      await shot(page, p.name, lang);
    }

    // Login ekranı (formu doldurmadan önce görüntüle)
    await page.goto(BASE + loginPage.path, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await shot(page, loginPage.name, lang);

    // Giriş yap
    await page.fill('#staff-email', ADMIN.email);
    await page.fill('#staff-password', ADMIN.password);
    await page.click('button[type="submit"]');
    // Panelin yüklendiğini doğrula (sidebar'daki çıkış butonu görünür olur).
    await page.waitForURL('**/staff', { timeout: 20000 }).catch(() => {});
    await settle(page);

    // Yönetim ekranları — SPA içi navigasyon (sidebar link'lerine tıklayarak).
    // Full reload yerine client-side geçiş: bellekteki access token korunur,
    // her sayfada yeniden refresh gerekmez.
    for (const p of staffPages) {
      // Sidebar dar ekranda gizli olabilir; 1440px'de desktop, görünür.
      const link = page.locator(`a[href="${p.path}"]`).first();
      if (await link.count()) {
        await link.click();
      } else {
        await page.goto(BASE + p.path, { waitUntil: 'domcontentloaded' });
      }
      await page.waitForURL(`**${p.path}`, { timeout: 10000 }).catch(() => {});
      await settle(page);
      await shot(page, p.name, lang);
    }

    await context.close();
  }

  await browser.close();
  console.log('\nBitti → docs/screenshots/');
}

run().catch((e) => { console.error(e); process.exit(1); });
