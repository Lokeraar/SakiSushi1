import { test, expect } from '@playwright/test';
import { SELECTORS } from './fixtures/selectors';
import { openCartSidebar, addToCart, getCartBadgeCount, waitForToast } from './fixtures/actions';

test.describe('Cart Debounce - Prevent Duplicate Items', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // Wait for menu to load
    await expect(page.locator('#menuGrid .menu-card').first()).toBeVisible({ timeout: 15000 });
  });

  test('Rapid clicks on same "Add to cart" button create only one item', async ({ page }) => {
    // Get the first menu card's add button
    const firstAddButton = page.locator('.btn-add').first();
    const itemName = await firstAddButton.locator('..').locator('.menu-card-title').textContent();
    
    // Click 5 times rapidly (within 500ms)
    for (let i = 0; i < 5; i++) {
      await firstAddButton.click({ noWaitAfter: true });
    }
    
    // Wait for cart badge to update (state-based)
    await expect(page.locator(SELECTORS.cartBadge)).toHaveText('1', { timeout: 5000 });
    
    // Open cart to verify
    await openCartSidebar(page);
    
    // Should have only 1 item for that platilloId
    const badgeCount = await getCartBadgeCount(page);
    expect(badgeCount).toBe(1);
    
    // Verify cart contains the item
    const cartItems = page.locator('#cartItems .nivel1-group');
    await expect(cartItems).toHaveCount(1);
    await expect(cartItems.first()).toContainText(itemName || '');
    
    // Should have only one success toast (not 5)
    // Note: toasts may be transient, so we check cart state instead
  });

  test('Rapid clicks on different items create multiple items', async ({ page }) => {
    const addButtons = page.locator('.btn-add');
    const count = await addButtons.count();
    
    // Click first 3 different items rapidly
    for (let i = 0; i < Math.min(3, count); i++) {
      await addButtons.nth(i).click({ noWaitAfter: true });
    }
    
    // Wait for cart badge to update (state-based)
    await expect(page.locator(SELECTORS.cartBadge)).toHaveText('3', { timeout: 5000 });
    await openCartSidebar(page);
    
    const badgeCount = await getCartBadgeCount(page);
    expect(badgeCount).toBe(3);
    
    const cartGroups = page.locator('#cartItems .nivel1-group');
    await expect(cartGroups).toHaveCount(3);
  });

  test('Clicks spaced > 500ms on same item create multiple items', async ({ page }) => {
    const firstAddButton = page.locator('.btn-add').first();
    
    // First click
    await firstAddButton.click();
    await expect(page.locator(SELECTORS.cartBadge)).toHaveText('1', { timeout: 5000 });
    
    // Wait > 500ms (debounce window)
    await page.waitForTimeout(600);
    
    // Second click
    await firstAddButton.click();
    await expect(page.locator(SELECTORS.cartBadge)).toHaveText('2', { timeout: 5000 });
    
    await openCartSidebar(page);
    
    const badgeCount = await getCartBadgeCount(page);
    expect(badgeCount).toBe(2);
    
    // Should be grouped under same nivel1 but with quantity 2
    const cartGroups = page.locator('#cartItems .nivel1-group');
    await expect(cartGroups).toHaveCount(1);
    
    // Check quantity in group header
    const groupHeader = cartGroups.first().locator('.nivel1-header .header-details span').first();
    await expect(groupHeader).toContainText('2 uds');
  });
});