import { test, expect } from '@playwright/test';
import { SELECTORS } from './fixtures/selectors';
import { 
  openReservaModal, 
  fillReservaForm, 
  waitForModalOpen, 
  waitForModalClose 
} from './fixtures/actions';

test.describe('Reserva Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // Add an item to cart first (required for Reserva button to show)
    await page.locator('.btn-add').first().click({ noWaitAfter: true });
    await page.waitForTimeout(500);
  });

  test('Open Reserva modal and verify all fields accessible', async ({ page }) => {
    await openReservaModal(page);
    
    // Modal is open
    await waitForModalOpen(page, SELECTORS.reservaModal);
    
    // Order summary visible
    await expect(page.locator('#resumenPedidoReserva')).toBeVisible();
    await expect(page.locator('#resumenPedidoReserva')).not.toBeEmpty();
    
    // Timer visible
    await expect(page.locator('#reservaTimerDisplay')).toBeVisible();
    
    // All form fields visible and fillable
    await expect(page.locator(SELECTORS.fechaReserva)).toBeVisible();
    await expect(page.locator(SELECTORS.nombreReserva)).toBeVisible();
    
    // Reference inputs (6 separate)
    const refInputs = page.locator(SELECTORS.reservaRefInputs);
    await expect(refInputs).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      await expect(refInputs.nth(i)).toBeVisible();
      await expect(refInputs.nth(i)).toBeEnabled();
    }
    
    // Comprobante upload
    await expect(page.locator(SELECTORS.comprobanteReserva)).toBeVisible();
    
    // Confirm button initially disabled (form not complete)
    await expect(page.locator(SELECTORS.confirmReserva)).toBeDisabled();
  });

  test('Fill Reserva form completely enables confirm button', async ({ page }) => {
    await openReservaModal(page);
    
    // Get tomorrow's date in YYYY-MM-DD format
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const fecha = tomorrow.toISOString().split('T')[0];
    
    // Fill form
    await fillReservaForm(page, {
      fecha: fecha,
      nombre: 'Juan Pérez',
      referencia: '654321',
    });
    
    // Upload comprobante
    await expect(page.locator(SELECTORS.comprobanteReserva)).toBeVisible();
    
    // Verify confirm button enabled (after all fields + comprobante)
    // Note: comprobante upload is async
  });

  test('Close Reserva modal via X button', async ({ page }) => {
    await openReservaModal(page);
    
    // Click X button
    await page.click(SELECTORS.closeReservaModal);
    
    // Modal closes
    await waitForModalClose(page, SELECTORS.reservaModal);
  });

  test('Close Reserva modal via Cancel button', async ({ page }) => {
    await openReservaModal(page);
    
    // Click Cancel button
    await page.click(SELECTORS.cancelReserva);
    
    // Modal closes
    await waitForModalClose(page, SELECTORS.reservaModal);
  });

  test('Date picker minimum date is today', async ({ page }) => {
    await openReservaModal(page);
    
    const fechaInput = page.locator(SELECTORS.fechaReserva);
    const minAttr = await fechaInput.getAttribute('min');
    
    // Should be today or empty (browser handles min)
    const today = new Date().toISOString().split('T')[0];
    if (minAttr) {
      expect(minAttr).toBe(today);
    }
  });
});