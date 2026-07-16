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

test('kasa parolası yalnızca açık reveal etkileşimiyle gösterilir', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }),
  }));
  await page.route('**/api/auth/staff/login', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { mfaRequired: true, challenge: 'challenge-token-1234567890' } }),
  }));
  await page.route('**/api/auth/staff/mfa/verify-login', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: {
        accessToken: 'access-token',
        user: { id: 'staff-1', email: 'admin@example.com', fullName: 'Admin User', role: 'admin' },
      },
    }),
  }));
  await page.route('**/api/dashboard/stats', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: {
        summary: { totalOpen: 0, totalInProgress: 0, todayCreated: 0, slaViolations: 0, myOpen: 0 },
        byStatus: [], byPriority: [], byCompany: [], recentTickets: [], accessibleCompanies: [],
      },
    }),
  }));
  await page.route(/\/api\/credentials(?:\?.*)?$/, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: [{
        id: 'credential-1', title: 'Sunucu', category: 'Linux', url: null, username: 'root',
        companyId: null, createdAt: '2026-07-16T10:00:00Z', updatedAt: '2026-07-16T10:00:00Z',
        company: null,
      }],
    }),
  }));
  let revealCalls = 0;
  await page.route('**/api/credentials/credential-1/reveal', (route) => {
    revealCalls += 1;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { password: 'very-secret-password', notes: null } }),
    });
  });

  await page.goto('/staff/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Şifre').fill('correct-password');
  await page.getByRole('button', { name: 'Giriş Yap' }).click();
  await page.getByLabel('Doğrulama kodu').fill('123456');
  await page.getByRole('button', { name: 'Kodu Doğrula' }).click();
  await expect(page).toHaveURL(/\/staff$/);

  await page.evaluate(() => {
    window.history.pushState({}, '', '/staff/passwords');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/staff\/passwords$/);
  await expect(page.getByText('Sunucu')).toBeVisible();
  expect(revealCalls).toBe(0);
  await page.getByTitle('Şifreyi göster (denetim kaydına yazılır)').click();
  await expect(page.getByText('very-secret-password')).toBeVisible();
  expect(revealCalls).toBe(1);
});
