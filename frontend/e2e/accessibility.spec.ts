import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

async function mockPublicApi(page: Page) {
  await page.route(/\/api\/companies\/branding\/by-host|\/companies\/branding\/by-host/, (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ success: true, data: null }),
  }));
  await page.route(/\/api\/companies$|\/companies$/, (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }),
  }));
  await page.route(/\/api\/auth\/staff\/refresh|\/auth\/staff\/refresh/, (route) => route.fulfill({
    status: 401, contentType: 'application/json', body: JSON.stringify({ success: false }),
  }));
}

for (const path of ['/', '/create', '/track', '/staff/login']) {
  test(`${path} kritik erişilebilirlik ihlali taşımıyor`, async ({ page }) => {
    await mockPublicApi(page);
    await page.goto(path);
    await expect(page.locator('body')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
  });
}

test('bilinmeyen route ana sayfaya güvenle döner', async ({ page }) => {
  await mockPublicApi(page);
  await page.goto('/olmayan-route');
  await expect(page).toHaveURL(/\/$/);
});

test('/create dark mode kritik kontrast ihlali taşımıyor', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await mockPublicApi(page);
  await page.goto('/create');
  await expect(page.locator('html')).toHaveClass(/dark/);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
});

// ---------------------------------------------------------------------------
// Personel paneli — eskiden yalnızca 4 public rota taranıyordu; panelin
// rotaları axe'nin hiç görmediği köşeydi. En yoğun üç sayfa sahte oturumla
// taranır (gerçek veri modeli değil, render edilebilir minimum gövde).
// ---------------------------------------------------------------------------

const FAKE_JWT = 'e30.eyJzdWIiOiJ0ZXN0In0.fake-signature';

/** it_manager sahte oturumu: refresh çağrısı geçerli oturum döner. */
async function mockStaffApi(page: Page) {
  // Branding'i en önce kaydet: aşağıdaki geniş /companies yakalayıcısı
  // branding isteğini de yakalar; işleyicide ayrıştırıyoruz.
  const brandingPattern = /\/api\/companies\/branding\/by-host|\/companies\/branding\/by-host/;
  await page.route(brandingPattern, (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ success: true, data: null }),
  }));
  await page.route(/\/api\/companies($|\?)/, (route) => {
    if (brandingPattern.test(route.request().url())) {
      return route.fallback();
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route(/\/api\/auth\/staff\/refresh|\/auth\/staff\/refresh/, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: {
        accessToken: FAKE_JWT,
        user: { id: 'u1', email: 'manager@test.local', fullName: 'Test Yönetici', role: 'it_manager' },
        mfaWarningEnabled: false,
      },
    }),
  }));
  await page.route(/\/api\/dashboard\/stats/, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: {
        summary: { totalOpen: 0, totalInProgress: 0, todayCreated: 0, slaViolations: 0, myOpen: 0 },
        byStatus: [], byPriority: [], byCompany: [], recentTickets: [],
        accessibleCompanies: [{ id: 'c1', name: 'Test Şirketi' }],
      },
    }),
  }));
  await page.route(/\/api\/tickets($|\?)/, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } }),
  }));
  await page.route(/\/api\/tasks($|\?)/, (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }),
  }));
  await page.route(/\/api\/staff($|\?)/, (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }),
  }));
  // Canlı güncelleme akışı axe taramasını etkilemez; sessizce kapat.
  await page.route(/\/api\/events\/staff/, (route) => route.fulfill({ status: 204 }));
}

for (const path of ['/staff', '/staff/tickets', '/staff/tasks']) {
  test(`${path} kritik erişilebilirlik ihlali taşımıyor (personel paneli)`, async ({ page }) => {
    await mockStaffApi(page);
    await page.goto(path);
    await expect(page.locator('body')).toContainText(/.+/);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
  });
}
