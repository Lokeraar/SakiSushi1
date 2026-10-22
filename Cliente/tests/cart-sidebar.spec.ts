import { test, expect } from '@playwright/test';
import { SELECTORS } from './fixtures/selectors';
import { openCartSidebar, closeCartSidebar, addToCart, getCartBadgeCount } from './fixtures/actions';

test.describe('Cart Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('#menuGrid .menu-card').first()).toBeVisible({ timeout: 15000 });
  });

  test('Open and close cart sidebar', async ({ page }) => {
    // Initially closed
    const cartSidebar = page.locator(SELECTORS.cartSidebar);
    await expect(cartSidebar).not.toHaveClass(/open/);
    
    // Open
    await openCartSidebar(page);
    await expect(cartSidebar).toHaveClass(/open/);
    
    // Overlay active
    await expect(page.locator('#overlay')).toHaveClass(/active/);
    
    // Close
    await closeCartSidebar(page);
    await expect(cartSidebar).not.toHaveClass(/open/);
    await expect(page.locator('#overlay')).not.toHaveClass(/active/);
  });

  test('Cart shows empty state when no items', async ({ page }) => {
    await openCartSidebar(page);
    
    // Empty state visible
    await expect(page.locator('.cart-empty')).toBeVisible();
    await expect(page.locator('.cart-empty')).toContainText('Tu carrito está vacío');
    
    // Footer hidden
    await expect(page.locator('#cartFooter')).toBeHidden();
  });

  test('Cart shows items with 3-level grouping', async ({ page }) => {
    // Add multiple items
    await addToCart(page, 0);
    await addToCart(page, 1);
    await addToCart(page, 0); // Same as first
    
    await openCartSidebar(page);
    
    // Footer visible
    await expect(page.locator('#cartFooter')).toBeVisible();
    
    // Two nivel1 groups (different platilloId)
    const groups = page.locator('#cartItems .nivel1-group');
    await expect(groups).toHaveCount(2);
    
    // First group has 2 items (quantity 2)
    const firstGroup = groups.first();
    await expect(firstGroup.locator('.header-details span').first()).toContainText('2 uds');
    
    // Second group has 1 item
    const secondGroup = groups.nth(1);
    await expect(secondGroup.locator('.header-details span').first()).toContainText('1 uds');
  });

  test('Cart badge updates correctly', async ({ page }) => {
    // Initially 0
    let badgeCount = await getCartBadgeCount(page);
    expect(badgeCount).toBe(0);
    
    // Add one item
    await addToCart(page, 0);
    await page.waitForTimeout(200);
    
    badgeCount = await getCartBadgeCount(page);
    expect(badgeCount).toBe(1);
    
    // Add another
    await addToCart(page, 1);
    await page.waitForTimeout(200);
    
    badgeCount = await getCartBadgeCount(page);
    expect(badgeCount).toBe(2);
  });

  test('Delivery and Reserva buttons appear in cart footer', async ({ page }) => {
    await addToCart(page, 0);
    await page.waitForTimeout(200);
    
    await openCartSidebar(page);
    
    // Both buttons visible
    await expect(page.locator(SELECTORS.deliveryOrderBtn)).toBeVisible();
    await expect(page.locator(SELECTORS.reservaOrderBtn)).toBeVisible();
    
    // Delivery button has motorcycle icon
    await expect(page.locator(SELECTORS.deliveryOrderBtn)).toContainText('Delivery');
    
    // Reserva button has calendar icon
    await expect(page.locator(SELECTORS.reservaOrderBtn)).toContainText('Reserva');
  });
});