import { Page, Locator, expect } from '@playwright/test';
import { SELECTORS } from './selectors';

/**
 * Wait for a modal to become visible (have .active class)
 */
export async function waitForModalOpen(page: Page, modalSelector: string): Promise<Locator> {
  const modal = page.locator(modalSelector);
  await expect(modal).toHaveClass(/active/, { timeout: 10000 });
  return modal;
}

/**
 * Wait for a modal to close (lose .active class)
 */
export async function waitForModalClose(page: Page, modalSelector: string): Promise<void> {
  const modal = page.locator(modalSelector);
  await expect(modal).not.toHaveClass(/active/, { timeout: 10000 });
}

/**
 * Open Delivery modal by clicking the button in cart footer
 */
export async function openDeliveryModal(page: Page): Promise<void> {
  // Ensure cart sidebar is open first
  await openCartSidebar(page);
  
  // Click Delivery button
  await page.click(SELECTORS.deliveryOrderBtn);
  
  // Wait for modal to open
  await waitForModalOpen(page, SELECTORS.deliveryModal);
}

/**
 * Open Reserva modal by clicking the button in cart footer
 */
export async function openReservaModal(page: Page): Promise<void> {
  // Ensure cart sidebar is open first
  await openCartSidebar(page);
  
  // Click Reserva button
  await page.click(SELECTORS.reservaOrderBtn);
  
  // Wait for modal to open
  await waitForModalOpen(page, SELECTORS.reservaModal);
}

/**
 * Open cart sidebar
 */
export async function openCartSidebar(page: Page): Promise<void> {
  const cartSidebar = page.locator(SELECTORS.cartSidebar);
  if (!(await cartSidebar.evaluate(el => el.classList.contains('open')))) {
    await page.click(SELECTORS.cartToggle);
    await expect(cartSidebar).toHaveClass(/open/, { timeout: 5000 });
  }
}

/**
 * Fill the 6-digit reference code inputs using keyboard typing
 * (more reliable than filling individual inputs with auto-advance)
 */
export async function fillReferenceCode(page: Page, code: string, type: 'delivery' | 'reserva'): Promise<void> {
  const firstInputSelector = type === 'delivery' 
    ? '.ref-digit[data-type="delivery"][data-index="0"]'
    : '.ref-digit[data-type="reserva"][data-index="0"]';
  
  // Click first input to focus, then type the whole code
  // Auto-advance will handle the rest
  await page.click(firstInputSelector);
  await page.keyboard.type(code, { delay: 50 });
  
  // Wait for all 6 inputs to be filled
  const selector = type === 'delivery' ? SELECTORS.deliveryRefInputs : SELECTORS.reservaRefInputs;
  const inputs = page.locator(selector);
  for (let i = 0; i < 6; i++) {
    await expect(inputs.nth(i)).toHaveValue(code[i], { timeout: 2000 });
  }
}

/**
 * Close cart sidebar
 */
export async function closeCartSidebar(page: Page): Promise<void> {
  await page.click(SELECTORS.closeCart);
  await expect(page.locator(SELECTORS.cartSidebar)).not.toHaveClass(/open/, { timeout: 5000 });
}

/**
 * Fill Delivery form completely
 */
export async function fillDeliveryForm(page: Page, data: {
  parroquia: string;
  direccion: string;
  telefono: string;
  referencia: string;
}): Promise<void> {
  // Select parroquia
  await page.click(SELECTORS.selectedParroquiaText);
  await page.fill(SELECTORS.parroquiaSearch, data.parroquia);
  await expect(page.locator(`#parroquiaSelect option:has-text("${data.parroquia}")`)).toBeVisible({ timeout: 5000 });
  await page.locator(`#parroquiaSelect option:has-text("${data.parroquia}")`).click();
  
  // Fill address
  await page.fill(SELECTORS.direccion, data.direccion);
  
  // Fill phone
  await page.fill(SELECTORS.telefono, data.telefono);
  
  // Fill reference
  await fillReferenceCode(page, data.referencia, 'delivery');
  
  // Note: comprobante upload requires file - handled separately in tests
}

/**
 * Fill Reserva form completely
 */
export async function fillReservaForm(page: Page, data: {
  fecha: string; // YYYY-MM-DD
  nombre: string;
  referencia: string;
}): Promise<void> {
  // Fill date
  await page.fill(SELECTORS.fechaReserva, data.fecha);
  
  // Fill name
  await page.fill(SELECTORS.nombreReserva, data.nombre);
  
  // Fill reference
  await fillReferenceCode(page, data.referencia, 'reserva');
  
  // Note: comprobante upload requires file - handled separately in tests
}

/**
 * Capture network errors during test
 */
export function captureNetworkErrors(page: Page): { errors: Array<{ url: string; status: number }>; clear: () => void } {
  const errors: Array<{ url: string; status: number }> = [];
  
  page.on('response', response => {
    if (response.status() >= 400) {
      errors.push({ url: response.url(), status: response.status() });
    }
  });
  
  return {
    errors,
    clear: () => errors.length = 0,
  };
}

/**
 * Assert no 404 errors occurred
 */
export function assertNo404Errors(errors: Array<{ url: string; status: number }>): void {
  const notFound = errors.filter(e => e.status === 404);
  if (notFound.length > 0) {
    throw new Error(`404 errors found: ${JSON.stringify(notFound)}`);
  }
}

/**
 * Assert no network errors >= 400
 */
export function assertNoNetworkErrors(errors: Array<{ url: string; status: number }>): void {
  if (errors.length > 0) {
    throw new Error(`Network errors (>=400) found: ${JSON.stringify(errors)}`);
  }
}

/**
 * Wait for toast to appear and get its text
 */
export async function waitForToast(page: Page, timeout = 5000): Promise<string> {
  const toast = page.locator(SELECTORS.toast).first();
  await expect(toast).toBeVisible({ timeout });
  const text = await toast.textContent();
  return text || '';
}

/**
 * Add item to cart by clicking "Add to cart" button on a menu card
 */
export async function addToCart(page: Page, itemIndex = 0): Promise<void> {
  const addButtons = page.locator('.btn-add');
  await expect(addButtons.nth(itemIndex)).toBeVisible();
  await addButtons.nth(itemIndex).click();
  await page.waitForTimeout(100); // Wait for cart update
}

/**
 * Get cart badge count
 */
export async function getCartBadgeCount(page: Page): Promise<number> {
  const badge = page.locator(SELECTORS.cartBadge);
  const text = await badge.textContent();
  return text ? parseInt(text, 10) : 0;
}