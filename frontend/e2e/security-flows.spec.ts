import { expect, test } from '@playwright/test';

test('MFA giriş akışı challenge ve altı haneli kodla tamamlanır', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {} }),
  }));

  let loginBody: unknown;
  let verifyBody: unknown;
  await page.route('**/api/auth/staff/login', async (route) => {
    loginBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { mfaRequired: true, challenge: 'challenge-token-1234567890' },
      }),
    });
  });
  await page.route('**/api/auth/staff/mfa/verify-login', async (route) => {
    verifyBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          accessToken: 'access-token',
          user: {
            id: 'staff-1', email: 'admin@example.com', fullName: 'Admin User', role: 'admin',
            department: null, avatarUrl: null,
          },
        },
      }),
    });
  });

  await page.goto('/staff/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Şifre').fill('correct-password');
  await page.getByRole('button', { name: 'Giriş Yap' }).click();

  await expect(page.getByLabel('Doğrulama kodu')).toBeVisible();
  await page.getByLabel('Doğrulama kodu').fill('123456');
  await page.getByRole('button', { name: 'Kodu Doğrula' }).click();

  await expect(page).toHaveURL(/\/staff$/);
  expect(loginBody).toEqual({ email: 'admin@example.com', password: 'correct-password' });
  expect(verifyBody).toEqual({ challenge: 'challenge-token-1234567890', code: '123456' });
});
