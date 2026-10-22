import { test, expect } from '@playwright/test';
import { SELECTORS } from './fixtures/selectors';
import { 
  openDeliveryModal, 
  openReservaModal, 
  openCartSidebar,
  waitForModalOpen, 
  waitForModalClose 
} from './fixtures/actions';

test.describe('Modal Close Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // Add an item to cart first
    await page.locator('.btn-add').first().click({ noWaitAfter: true });
    await page.waitForTimeout(500);
  });

  test('Delivery modal closes via X button', async ({ page }) => {
    await openDeliveryModal(page);
    await waitForModalOpen(page, SELECTORS.deliveryModal);
    
    await page.click(SELECTORS.closeDeliveryModal);
    await waitForModalClose(page, SELECTORS.deliveryModal);
  });

  test('Delivery modal closes via Cancel button', async ({ page }) => {
    await openDeliveryModal(page);
    await waitForModalOpen(page, SELECTORS.deliveryModal);
    
    await page.click(SELECTORS.cancelDelivery);
    await waitForModalClose(page, SELECTORS.deliveryModal);
  });

  test('Reserva modal closes via X button', async ({ page }) => {
    await openReservaModal(page);
    await waitForModalOpen(page, SELECTORS.reservaModal);
    
    await page.click(SELECTORS.closeReservaModal);
    await waitForModalClose(page, SELECTORS.reservaModal);
  });

  test('Reserva modal closes via Cancel button', async ({ page }) => {
    await openReservaModal(page);
    await waitForModalOpen(page, SELECTORS.reservaModal);
    
    await page.click(SELECTORS.cancelReserva);
    await waitForModalClose(page, SELECTORS.reservaModal);
  });

  test('Cart sidebar closes via closeCart button', async ({ page }) => {
    await openCartSidebar(page);
    await expect(page.locator(SELECTORS.cartSidebar)).toHaveClass(/open/);
    
    await page.click(SELECTORS.closeCart);
    await expect(page.locator(SELECTORS.cartSidebar)).not.toHaveClass(/open/);
  });

  test('Overlay click closes all modals and sidebars', async ({ page }) => {
    // Open delivery modal
    await openDeliveryModal(page);
    await waitForModalOpen(page, SELECTORS.deliveryModal);
    
    // Click overlay
    await page.click('#overlay');
    
    // Modal should close
    await waitForModalClose(page, SELECTORS.deliveryModal);
    
    // Cart sidebar should also close if open
    await expect(page.locator(SELECTORS.cartSidebar)).not.toHaveClass(/open/);
  });
});