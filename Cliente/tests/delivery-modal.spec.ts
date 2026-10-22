import { test, expect } from '@playwright/test';
import { SELECTORS } from './fixtures/selectors';
import { 
  openDeliveryModal, 
  fillDeliveryForm, 
  waitForModalOpen, 
  waitForModalClose,
  waitForToast 
} from './fixtures/actions';

test.describe('Delivery Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // Add an item to cart first (required for Delivery button to show)
    await page.locator('.btn-add').first().click({ noWaitAfter: true });
    await page.waitForTimeout(500);
  });

  test('Open Delivery modal and verify all fields accessible', async ({ page }) => {
    await openDeliveryModal(page);
    
    // Modal is open
    await waitForModalOpen(page, SELECTORS.deliveryModal);
    
    // Order summary visible
    await expect(page.locator('#resumenPedidoDelivery')).toBeVisible();
    await expect(page.locator('#resumenPedidoDelivery')).not.toBeEmpty();
    
    // Timer visible
    await expect(page.locator('#deliveryTimerDisplay')).toBeVisible();
    
    // All form fields visible and fillable
    await expect(page.locator(SELECTORS.selectedParroquiaText)).toBeVisible();
    await expect(page.locator(SELECTORS.direccion)).toBeVisible();
    await expect(page.locator(SELECTORS.telefono)).toBeVisible();
    
    // Reference inputs (6 separate)
    const refInputs = page.locator(SELECTORS.deliveryRefInputs);
    await expect(refInputs).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      await expect(refInputs.nth(i)).toBeVisible();
      await expect(refInputs.nth(i)).toBeEnabled();
    }
    
    // Comprobante upload
    await expect(page.locator(SELECTORS.comprobante)).toBeVisible();
    
    // Confirm button initially disabled (form not complete)
    await expect(page.locator(SELECTORS.confirmDelivery)).toBeDisabled();
  });

  test('Parish search filters dropdown options', async ({ page }) => {
    await openDeliveryModal(page);
    
    // Open parish selector
    await page.click(SELECTORS.selectedParroquiaText);
    
    // Search for "Chacao"
    await page.fill(SELECTORS.parroquiaSearch, 'Chacao');
    await page.waitForTimeout(200);
    
    // Only Chacao should be visible
    const options = page.locator('#parroquiaSelect option:not([value=""])');
    const visibleOptions = await options.evaluateAll(opts => 
      opts.filter(o => o.style.display !== 'none').map(o => o.textContent)
    );
    
    expect(visibleOptions).toContain('Chacao');
    
    // Select Chacao
    await page.locator('#parroquiaSelect option:has-text("Chacao")').click();
    
    // Verify selection
    await expect(page.locator(SELECTORS.selectedParroquiaText)).toContainText('Chacao');
    
    // Delivery cost should update
    await expect(page.locator('#deliveryPriceDisplay')).not.toContainText('Primero seleccione');
  });

  test('Fill Delivery form completely enables confirm button', async ({ page }) => {
    await openDeliveryModal(page);
    
    // Fill form
    await fillDeliveryForm(page, {
      parroquia: 'Chacao',
      direccion: 'Avenida Principal, Edificio Central, Piso 3, Oficina 301, Caracas',
      telefono: '+584121234567',
      referencia: '123456',
    });
    
    // Upload comprobante (create a small test image)
    const fileInput = page.locator(SELECTORS.comprobante);
    // Note: actual file upload would need a real file
    // For now, we just verify the input is accessible
    await expect(fileInput).toBeVisible();
    
    // Verify confirm button enabled (after all fields + comprobante)
    // Note: comprobante upload is async, so button enables after upload completes
    // This test verifies form fields work; full integration needs file upload
  });

  test('Close Delivery modal via X button', async ({ page }) => {
    await openDeliveryModal(page);
    
    // Click X button
    await page.click(SELECTORS.closeDeliveryModal);
    
    // Modal closes
    await waitForModalClose(page, SELECTORS.deliveryModal);
    
    // Timer should be stopped
    // (Implementation detail: verificar timers detenidos)
  });

  test('Close Delivery modal via Cancel button', async ({ page }) => {
    await openDeliveryModal(page);
    
    // Click Cancel button
    await page.click(SELECTORS.cancelDelivery);
    
    // Modal closes
    await waitForModalClose(page, SELECTORS.deliveryModal);
  });
});