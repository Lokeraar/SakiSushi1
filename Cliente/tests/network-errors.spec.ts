import { test, expect } from '@playwright/test';

test.describe('Network Errors - Zero 404 on Page Load', () => {
  test('Page load produces no 404 errors', async ({ page }) => {
    const errors: Array<{ url: string; status: number }> = [];
    
    page.on('response', response => {
      if (response.status() >= 400) {
        errors.push({ url: response.url(), status: response.status() });
      }
    });
    
    await page.goto('/', { waitUntil: 'networkidle' });
    
    // Wait a bit for any late-loading resources
    await page.waitForTimeout(2000);
    
    // Filter out expected failures (e.g., favicon.ico if not present)
    const relevantErrors = errors.filter(e => 
      !e.url.includes('favicon.ico') && 
      !e.url.includes('chrome-extension') &&
      !e.url.includes('analytics')
    );
    
    // No 404 errors
    const notFound = relevantErrors.filter(e => e.status === 404);
    expect(notFound, `404 errors: ${JSON.stringify(notFound)}`).toHaveLength(0);
    
    // No 5xx errors
    const serverErrors = relevantErrors.filter(e => e.status >= 500);
    expect(serverErrors, `5xx errors: ${JSON.stringify(serverErrors)}`).toHaveLength(0);
  });
});