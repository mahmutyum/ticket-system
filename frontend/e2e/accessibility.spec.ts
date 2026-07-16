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
