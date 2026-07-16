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

test('public ticket yaşam döngüsü yanıt, dosya ve yetkili indirme linkini korur', async ({ page }) => {
  const token = 'public-token-1234567890';
  await page.route('**/api/**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }),
  }));
  await page.route(`**/api/public/ticket/${token}`, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: {
        id: 'ticket-1', ticketNumber: 'TKT-2026-00001', subject: 'Yazıcı çalışmıyor',
        description: 'Kağıt sıkışması oluşuyor', priority: 'medium', status: 'open',
        createdAt: '2026-07-16T10:00:00Z', updatedAt: '2026-07-16T10:00:00Z',
        company: { name: 'ACME' }, location: { name: 'Merkez' }, category: { name: 'Donanım' },
        assignedTo: { fullName: 'Teknik Personel' }, customValues: [], notes: [],
        history: [{
          id: 'history-1', action: 'ticket_created', field: null, oldValue: null,
          newValue: 'open', createdAt: '2026-07-16T10:00:00Z',
        }],
        attachments: [{ id: 'attachment-1', fileName: 'log.txt', fileSize: 1024, createdAt: '2026-07-16T10:00:00Z' }],
        onsiteSupport: [],
      },
    }),
  }));

  let replyBody: unknown;
  await page.route(`**/api/public/ticket/${token}/reply`, (route) => {
    replyBody = route.request().postDataJSON();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  let uploadCalls = 0;
  await page.route(`**/api/public/ticket/${token}/attachments`, async (route) => {
    uploadCalls += 1;
    await expect(route.request().headerValue('content-type')).resolves.toContain('multipart/form-data');
    return route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { id: 'attachment-2', fileName: 'new.txt', fileSize: 3 } }),
    });
  });

  await page.goto(`/ticket/${token}`);
  await expect(page.getByText('TKT-2026-00001')).toBeVisible();
  const downloadLink = page.getByRole('link', { name: /log\.txt/ });
  await expect(downloadLink).toHaveAttribute('href', `/api/attachments/attachment-1?token=${token}`);

  await page.getByPlaceholder('Mesajınızı yazın...').fill('Sorun devam ediyor');
  await page.getByRole('button', { name: 'Gönder' }).click();
  await expect.poll(() => replyBody).toEqual({ content: 'Sorun devam ediyor' });

  await page.locator('input[type="file"]').setInputFiles({
    name: 'new.txt', mimeType: 'text/plain', buffer: Buffer.from('abc'),
  });
  await expect.poll(() => uploadCalls).toBe(1);
});
