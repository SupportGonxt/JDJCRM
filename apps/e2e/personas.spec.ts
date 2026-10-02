import { expect, test, type Page } from '@playwright/test';
import { signIn, uniq } from './helpers';

// Every type of user: what they land on, what the menu offers, that each screen loads cleanly, and what the API refuses them.
const PERSONAS: { email: string; lands: string; nav: string[]; refused: [string, string][] }[] = [
  { email: 'agent@crm.local', lands: '/dashboard', nav: ['Dashboard', 'Query board', 'New query', 'Client register', 'Bleed board', 'New bleed request', 'Nurse runs'], refused: [['GET', '/api/admin/users'], ['POST', '/api/contacts/1/merge']] },
  { email: 'supervisor@crm.local', lands: '/dashboard', nav: ['Dashboard', 'Query board', 'New query', 'Client register', 'Bleed board', 'New bleed request', 'Nurse runs'], refused: [['GET', '/api/admin/users']] },
  { email: 'analytical@crm.local', lands: '/tickets', nav: ['My department', 'Sample desk'], refused: [['POST', '/api/tickets'], ['GET', '/api/dashboard/live'], ['GET', '/api/admin/users']] },
  { email: 'preanalytical@crm.local', lands: '/tickets', nav: ['My department', 'Sample desk'], refused: [['POST', '/api/tickets'], ['POST', '/api/bleed-requests']] },
  { email: 'logistics@crm.local', lands: '/tickets', nav: ['My department'], refused: [['POST', '/api/tickets'], ['GET', '/api/admin/users']] },
  { email: 'nursing@crm.local', lands: '/field', nav: [], refused: [['POST', '/api/tickets'], ['POST', '/api/bleed-requests']] },
  { email: 'manager.pre@crm.local', lands: '/tickets', nav: ['Dashboard', 'My department', 'Sample desk'], refused: [['POST', '/api/tickets'], ['GET', '/api/admin/users']] },
  { email: 'exec@crm.local', lands: '/dashboard', nav: ['Dashboard', 'Query board', 'Client register', 'Bleed board', 'Nurse runs'], refused: [['POST', '/api/tickets'], ['POST', '/api/bleed-requests'], ['GET', '/api/admin/users']] },
  { email: 'admin@crm.local', lands: '/admin', nav: ['Administration'], refused: [] },
];

// The CI stack's self-signed certificate stops the offline service worker registering; real sites install the CA.
function watchErrors(page: Page) {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|SSL certificate error occurred when fetching the script/.test(m.text()) && errs.push(m.text()));
  return errs;
}

for (const p of PERSONAS)
  test(`${p.email}: lands on ${p.lands}, sees only their menu, every screen loads, the API refuses the rest`, async ({ browser }) => {
    const page = await signIn(browser, p.email);
    const errs = watchErrors(page);
    await expect(page).toHaveURL(new RegExp(`${p.lands}$`));
    if (p.nav.length) await expect(page.locator('aside nav a')).toHaveText(p.nav);
    for (const href of await page.locator('aside nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')!))) {
      await page.goto(href);
      await expect(page.locator('main h1').first()).toBeVisible();
      await expect(page.locator('main p.text-bad')).toHaveCount(0);
    }
    await page.goto(p.email.startsWith('nursing') ? '/field' : '/account');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    for (const [method, url] of p.refused) {
      const r = await page.request.fetch(url, { method, data: method === 'POST' ? {} : undefined });
      expect(r.status(), `${method} ${url}`).toBe(403);
    }
    expect(errs).toEqual([]);
  });

test('Mac: ⌘K searches from anywhere, ⌘↩ sends a note, Esc closes notifications', async ({ browser }) => {
  const page = await signIn(browser, 'agent@crm.local');
  await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
  const lk = await (await page.request.get('/api/lookups')).json();
  const org = lk.organisations.find((o: any) => o.kind === 'practice');
  const cat = lk.categories.find((c: any) => c.name.startsWith('Compliment'));
  const w = uniq();
  const { id } = await (await page.request.post('/api/tickets', { data: { channel: 'telephone', complainant_type: 'doctor', complainant_name: `Dr Mac ${w}`, organisation_id: org.id, contact_phone: '012 555 0101', site_id: org.site_id, category_id: cat.id, priority: 'normal', description: `Mac ${w}` } })).json();

  await page.goto(`/tickets/${id}`);
  await expect(page.locator('header kbd')).toHaveText('⌘K');
  await page.keyboard.press('Meta+k');
  await expect(page.getByPlaceholder(/Search ticket/)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByPlaceholder(/Search ticket/)).not.toBeFocused();

  await page.getByPlaceholder(/Add a note/).fill(`Sent with the keyboard ${w}`);
  await page.keyboard.press('Meta+Enter');
  await expect(page.getByText(`Sent with the keyboard ${w}`).first()).toBeVisible();
  await expect(page.getByPlaceholder(/Add a note/)).toHaveValue('');

  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.getByText('Mark all read')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Mark all read')).toHaveCount(0);
  await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', '/apple-touch-icon.png');
  expect((await page.request.get('/apple-touch-icon.png')).headers()['content-type']).toMatch(/image\/png/);
});
