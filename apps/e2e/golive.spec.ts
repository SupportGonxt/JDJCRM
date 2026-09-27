import { expect, test } from '@playwright/test';
import { signIn, uniq } from './helpers';

test('bulk import: the admin checks a CSV, sees the problem rows, fixes them and imports', async ({ browser }) => {
  const w = uniq();
  const admin = await signIn(browser, 'admin@crm.local');
  await admin.goto('/admin/import');
  const csv = admin.getByPlaceholder('Paste CSV here, with the header row from the template');
  await csv.fill(`kind,name,lat,lng,radius_m\nhospital,Import General ${w},-26.2,28.04,300\nhospital,Import NoGPS ${w},,,\n`);
  await admin.getByRole('button', { name: 'Check' }).click();
  await expect(admin.getByText('Line 3: a hospital needs lat and lng for its geofence')).toBeVisible();
  await expect(admin.getByRole('button', { name: /^Import/ })).toBeDisabled();
  await csv.fill(`kind,name,lat,lng,radius_m\nhospital,Import General ${w},-26.2,28.04,300\npractice,Import Practice ${w},,,\n`);
  await admin.getByRole('button', { name: 'Check' }).click();
  await expect(admin.getByText('All 2 rows are valid: 2 to create, 0 to update.')).toBeVisible();
  await admin.getByRole('button', { name: 'Import 2 rows' }).click();
  await expect(admin.getByText('Imported: 2 created, 0 updated.')).toBeVisible();
  await admin.goto('/admin/organisations');
  await expect(admin.getByRole('cell', { name: `Import General ${w}` })).toBeVisible();
});

test('registration pages: forgot password never reveals whether an account exists; a used or bad link explains what to do', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('E-mail').fill(`nobody-${uniq()}@jdj.local`);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('Check your e-mail')).toBeVisible();
  await page.goto('/set-password?token=not-a-real-token-0000000000');
  await expect(page.getByText("This link can't be used")).toBeVisible();
  await page.getByRole('link', { name: 'Go to sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
