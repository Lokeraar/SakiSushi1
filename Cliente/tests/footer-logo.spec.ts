import { test, expect } from '@playwright/test';
import { SELECTORS } from './fixtures/selectors';

test.describe('Footer Logo - No 404', () => {
  test('Footer brand logo loads successfully from local asset', async ({ page }) => {
    const errors: Array<{ url: string; status: number }> = [];
    
    page.on('response', response => {
      if (response.status() >= 400) {
        errors.push({ url: response.url(), status: response.status() });
      }
    });
    
    await page.goto('/', { waitUntil: 'networkidle' });
    
    // Check footer logo
    const logo = page.locator(SELECTORS.footerLogo);
    await expect(logo).toBeVisible();
    
    // Verify it's a local asset (not Googleusercontent)
    const src = await logo.getAttribute('src');
    expect(src).toBeTruthy();
    expect(src).not.toContain('googleusercontent.com');
    expect(src).not.toContain('lh3.googleusercontent.com');
    
    // Should be local relative path. El archivo real del proyecto es
    // ../assets/marca/logo-300.png (300x300). Antes apuntaba a
    // assets/logo-saki.svg, que NO EXISTE: el logo salia roto y la prueba
    // no lo detecto porque nunca se ejecuto contra la pagina real.
    expect(src).toMatch(/assets\/marca\/logo-300\.png/);
    
    // Wait for image to load (check naturalWidth > 0)
    await expect(logo).toHaveJSProperty('naturalWidth', expect.toBeGreaterThan(0));
    
    // No 404 for the logo
    const logo404 = errors.find(e => e.url.includes('logo-300') && e.status === 404);
    expect(logo404).toBeUndefined();
  });
});