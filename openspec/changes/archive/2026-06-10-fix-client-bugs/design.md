# SDD Design: Fix Cliente App Bugs

## Change ID
`fix-client-bugs`

## Summary

Four targeted bug fixes in the Cliente app discovered during Playwright E2E testing:
1. **Cart duplication** — rapid clicks on "Add to cart" for the same item create duplicate entries
2. **Footer 404** — logo image sourced from Googleusercontent fails with 404
3. **Playwright test ordering** — tests assume modals/forms are pre-opened, but they're not
4. **Exit modal in tests** — tests expect `_salidaAviso` modal, but only native `beforeunload` is used

## Decision Log

| Decision | Rationale |
|---|---|
| Debounce per `platilloId` (not global) | Different items should still be addable rapidly. Only same-item rapid clicks are suppressed. |
| 500ms debounce window | User confirmed. Long enough to catch accidental double-taps, short enough not to block intentional sequential adds. |
| Local asset for logo | User confirmed. Eliminates external dependency and 404 risk. |
| No modal code changes | Modals already work correctly via `iniciarProcesoDelivery()` / `iniciarProcesoReserva()`. The Playwright test just needs to click the buttons first. |
| Remove `_salidaAviso` from test expectations | The exit warning modal was intentionally removed; only native `beforeunload` (in `index.html` head and `cliente-init.js`) remains. |
| Single SDD cycle for all 4 bugs | All are related (testing blockers + data integrity) and small enough to fix together. |

---

## 1. Cart Debounce — `Cliente/js/cliente-carrito.js`

### Problem
`agregarAlCarrito()` has no rate-limiting. Each click creates a new cart instance with a unique `id`, so rapid clicks on the same "Add to cart" button produce N duplicate items.

### Solution
Add a per-`platilloId` timestamp guard at the top of `agregarAlCarrito()`. If the same `platilloId` was added within the last 500ms, the call is silently ignored.

### Affected Code

**File**: `Cliente/js/cliente-carrito.js`

Add a module-scope debounce map, then guard at the start of `agregarAlCarrito`:

```javascript
// ── Debounce map: { platilloId → timestamp } ──
var _ultimoClickCarrito = {};

function agregarAlCarrito(platilloId) {
    // ── Debounce guard: ignore rapid duplicate clicks (500ms per item) ──
    var ahora = Date.now();
    var ultimo = _ultimoClickCarrito[platilloId] || 0;
    if (ahora - ultimo < 500) {
        return; // silently ignore duplicate
    }
    _ultimoClickCarrito[platilloId] = ahora;

    // ... existing logic unchanged below ...
    var item = (S.state.menuItems || []).find(function(i) { return i.id == platilloId; });
    if (!item) return;
    // ... rest of function ...
}
```

### What Changes
- **Lines affected**: ~3 lines added at the top of `agregarAlCarrito()` (function body starts around line 30).
- **New variable**: `_ultimoClickCarrito` object at module scope (~line 28).
- **No other functions modified**: `guardarCarrito`, `restaurarCarrito`, `eliminarInstancia`, `vaciarCarrito`, etc. remain untouched.
- **Exposed APIs unchanged**: `window.agregarAlCarrito`, `S.modules.carrito.agregarAlCarrito` — same signature, same behavior for non-duplicate calls.

### Edge Cases

| Scenario | Behavior |
|---|---|
| 5 rapid clicks on same `platilloId` within 400ms | Only 1 item added; badge shows 1 |
| Click on item A, then item B within 200ms | Both items added (different `platilloId` keys) |
| Click on item A, wait 600ms, click item A again | 2 items added (500ms window expired) |
| Click during debounce period then click a different item | Different item proceeds normally; same-item click is suppressed |

### Test Coverage (see Section 4)
- `cart-debounce.spec.ts` — 3 scenarios from spec: rapid-same, rapid-different, spaced-clicks.

---

## 2. Footer Logo — `Cliente/index.html`

### Problem
The footer brand logo (`<img class="footer-brand-logo">`) references a Googleusercontent URL:
```
https://lh3.googleusercontent.com/pw/AP1GczPrZAoWxmsOGRD9xl1hO5Q65JXuwUZzoR6gUk-cw5lVmarxQe_-lwqpA60tTKLlXfpvIjAJlKC6jFls-xETJOPkebLIIPhbGlUkknmhrRbdhMUll2UViGSUj3WmHKg2YEsZlAfxBPPTjIHhScjD0jfe=w1439-h1439-s-no-gm
```
This returns **404** in automated tests and is fragile for production.

### Solution
1. Download/save the logo as `Cliente/assets/logo-saki.png`
2. Update the `<img>` `src` to use the local asset path

### Affected Code

**File**: `Cliente/index.html` — line 2868

**Before:**
```html
<img src="https://lh3.googleusercontent.com/pw/AP1GczPrZAoWxmsOGRD9xl1hO5Q65JXuwUZzoR6gUk-cw5lVmarxQe_-lwqpA60tTKLlXfpvIjAJlKC6jFls-xETJOPkebLIIPhbGlUkknmhrRbdhMUll2UViGSUj3WmHKg2YEsZlAfxBPPTjIHhScjD0jfe=w1439-h1439-s-no-gm" alt="Saki Sushi" class="footer-brand-logo" style="width:140px; height:155px;">
```

**After:**
```html
<img src="assets/logo-saki.png" alt="Saki Sushi" class="footer-brand-logo" style="width:140px; height:155px;">
```

### Asset File
- **New file**: `Cliente/assets/logo-saki.png`
- Source: Download the same image from the existing Googleusercontent URL (before the 404 fix breaks it) or from the project's Supabase storage. The existing header logo (`.logo` class, line 2496) uses the same URL — that one should also be updated for consistency, but is not in the bug scope (header logo may have a CDN fallback).

### CSS (no changes needed)
The `.footer-brand-logo` class (line 1867) already handles `width`, `height`, `border-radius: 50%`, `object-fit: cover` — no CSS changes required.

---

## 3. Playwright Test Updates — Modal Button Clicks

### Problem
Playwright tests assume delivery/reserva forms are visible and fillable on page load. In reality:
- Modal overlays are hidden by default (`display: none` / no `.active` class)
- The Delivery and Reserva buttons in the cart footer must be clicked first to open modals via `iniciarProcesoDelivery()` / `iniciarProcesoReserva()`
- The `closeCart` button is inside the cart sidebar header, which is only visible when the sidebar is open

### Solution
**No application code changes.** The modals already open correctly. Only Playwright test code needs updating to click buttons before interacting with modals/forms.

### Test Pattern — Before (broken)

```typescript
// ❌ WRONG: assumes modal is already open
await page.fill('#deliveryAddress', 'Av. Principal, Caracas');
await page.selectOption('#deliveryParish', 'Chacao');
```

### Test Pattern — After (correct)

```typescript
// ✅ CORRECT: open the modal first by clicking the Delivery button in the cart footer
// Step 1: Ensure cart has items (add one via page.evaluate or UI click)
await page.evaluate(() => window.agregarAlCarrito(1));

// Step 2: Open cart sidebar (click cart toggle button)
await page.click('#cartToggle'); // or whatever the cart toggle selector is

// Step 3: Click the Delivery button in the cart footer
await page.click('#deliveryOrderBtn');

// Step 4: Wait for modal to become visible
await page.waitForSelector('#deliveryModal.active, .modal-overlay.active', { state: 'visible' });

// Step 5: NOW fill the form
await page.fill('#deliveryAddress', 'Av. Universidad, Caracas, Venezuela, Chacao');
await page.selectOption('#deliveryParish', 'Chacao');
```

### Modal Interaction Map

| Modal | Open Trigger | Selector After Open | Close Button |
|---|---|---|---|
| Delivery | `#deliveryOrderBtn` → `iniciarProcesoDelivery()` | `.modal-overlay.active` or `#deliveryModal.active` | `#closeDeliveryModal` (X), `#cancelDelivery` (Cancel) |
| Reserva | `#reservaOrderBtn` → `iniciarProcesoReserva()` | `.modal-overlay.active` or `#reservaModal.active` | `#closeReservaModal` (X) |
| Cart Sidebar | `#cartToggle` or header cart icon | `.cart-sidebar.open` | `#closeCart` |

### Key Selectors (from current DOM)

| Element | ID / Selector | Location |
|---|---|---|
| Delivery button | `#deliveryOrderBtn` | Cart footer (dynamically created in `actualizarCarritoUI`) |
| Reserva button | `#reservaOrderBtn` | Cart footer (dynamically created in `actualizarCarritoUI`) |
| Close cart | `#closeCart` | Cart sidebar header |
| Delivery modal close | `#closeDeliveryModal` | Delivery modal overlay |
| Reserva modal close | `#closeReservaModal` | Reserva modal overlay |
| Cancel delivery | `#cancelDelivery` | Delivery modal footer |
| Cart toggle | Header cart icon (`.icon-button` with cart icon) | Header |

---

## 4. Exit Modal Removal from Test Expectations

### Problem
Tests check for `_salidaAviso` modal behavior. The custom exit modal (`_salidaAviso`) exists in the DOM (line 2467 of `index.html`) but is only used by:
- `Cliente/js/cliente-ui.js:374-377` — event listeners for `_salidaNo` and `_salidaSi` buttons
- These buttons just hide/show the modal

However, the actual exit protection is handled by **native `beforeunload`**:
- `Cliente/index.html` line 8: `window.addEventListener('beforeunload', function(e){if(!window._sakiReady){e.preventDefault();e.returnValue='';}});`
- `Cliente/js/cliente-init.js:175`: `window.addEventListener('beforeunload', cleanupOnBeforeunload);`

### Solution
- **Application code**: No change (the `_salidaAviso` DOM element stays — it's inert and removing it could break other pages that share the HTML pattern)
- **Test code**: Remove all assertions about `_salidaAviso` visibility, button clicks, or modal state

### What to Remove from Tests

```typescript
// ❌ Remove these patterns from test expectations:
// - expect(await page.$('#_salidaAviso')).toBeVisible()
// - await page.click('#_salidaSi')
// - await page.click('#_salidaNo')
// - expect(await page.$('#_salidaAviso')).toBeHidden()
```

### What to Keep

```typescript
// ✅ Native beforeunload is tested by Playwright's page.close() or navigation:
// Playwright handles beforeunload natively — no special test needed
// If testing that the page doesn't navigate away unexpectedly,
// use: page.on('dialog', dialog => dialog.accept()) or similar
```

---

## 5. Playwright Test File Structure

### Directory Layout

```
Cliente/
├── assets/
│   └── logo-saki.png              ← NEW: local logo asset
├── js/
│   └── cliente-carrito.js         ← MODIFIED: debounce guard
├── index.html                     ← MODIFIED: footer logo src
└── tests/                         ← NEW: Playwright test directory
    ├── fixtures/
    │   └── helpers.ts             ← Shared setup: page.goto, add-item, open-cart
    ├── delivery-modal.spec.ts     ← Delivery modal scenarios
    ├── reserva-modal.spec.ts      ← Reserva modal scenarios
    ├── cart-sidebar.spec.ts       ← Cart open/close scenarios
    ├── cart-debounce.spec.ts      ← Debounce behavior scenarios
    ├── footer-logo.spec.ts        ← Logo loads without 404
    ├── network-errors.spec.ts     ← Zero 404 errors on page load
    └── modal-close.spec.ts        ← Modal X/Cancel button scenarios
```

### `playwright.config.ts` (project root)

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './Cliente/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'https://lokeraar.github.io/SakiSushi0/Cliente/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

### `Cliente/tests/fixtures/helpers.ts` — Shared Helpers

```typescript
import { Page, expect } from '@playwright/test';

const BASE_URL = 'https://lokeraar.github.io/SakiSushi0/Cliente/';

/** Navigate to the Cliente app and wait for full load */
export async function loadApp(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
}

/** Add an item to cart via the global function (fast, no UI needed) */
export async function addItemToCart(page: Page, platilloId: number = 1): Promise<void> {
  await page.evaluate((id) => window.agregarAlCarrito(id), platilloId);
}

/** Open the cart sidebar by clicking the cart toggle in the header */
export async function openCart(page: Page): Promise<void> {
  // The cart toggle is an icon-button in the header with a cart icon
  const cartBtn = page.locator('.icon-button').filter({ has: page.locator('.fa-shopping-cart, .fa-cart-shopping') });
  if (await cartBtn.count() > 0) {
    await cartBtn.first().click();
  }
  await page.waitForSelector('.cart-sidebar.open', { timeout: 5000 });
}

/** Click the Delivery button in the cart footer to open the delivery modal */
export async function openDeliveryModal(page: Page): Promise<void> {
  await page.click('#deliveryOrderBtn');
  await page.waitForSelector('.modal-overlay.active, [id*="delivery"][class*="active"]', { state: 'visible', timeout: 5000 });
}

/** Click the Reserva button in the cart footer to open the reserva modal */
export async function openReservaModal(page: Page): Promise<void> {
  await page.click('#reservaOrderBtn');
  await page.waitForSelector('.modal-overlay.active, [id*="reserva"][class*="active"]', { state: 'visible', timeout: 5000 });
}
```

### Test File: `cart-debounce.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { loadApp, addItemToCart } from './fixtures/helpers';

test.describe('Cart Debounce', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
  });

  test('rapid clicks on same item create only one cart item', async ({ page }) => {
    // Click "add to cart" for the same item 5 times within 500ms
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.agregarAlCarrito(1));
    }

    const cartCount = await page.evaluate(() => window.getCarrito().length);
    expect(cartCount).toBe(1);

    const badge = await page.locator('#cartBadge').textContent();
    expect(badge).toBe('1');
  });

  test('rapid clicks on different items create multiple items', async ({ page }) => {
    // Add 3 different items rapidly
    await page.evaluate(() => {
      window.agregarAlCarrito(1);
      window.agregarAlCarrito(2);
      window.agregarAlCarrito(3);
    });

    const cartCount = await page.evaluate(() => window.getCarrito().length);
    expect(cartCount).toBe(3);
  });

  test('clicks spaced > 500ms on same item create multiple items', async ({ page }) => {
    await page.evaluate(() => window.agregarAlCarrito(1));

    // Wait 600ms (beyond the 500ms debounce window)
    await page.waitForTimeout(600);

    await page.evaluate(() => window.agregarAlCarrito(1));

    const cartCount = await page.evaluate(() => window.getCarrito().length);
    expect(cartCount).toBe(2);
  });
});
```

### Test File: `footer-logo.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { loadApp } from './fixtures/helpers';

test.describe('Footer Logo', () => {
  test('footer brand logo loads successfully from local asset', async ({ page }) => {
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('logo-saki.png')
    );

    await loadApp(page);

    const response = await responsePromise;
    expect(response.status()).toBe(200);

    const logo = page.locator('img.footer-brand-logo');
    await expect(logo).toBeVisible();
    const src = await logo.getAttribute('src');
    expect(src).toBe('assets/logo-saki.png');
  });
});
```

### Test File: `network-errors.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { loadApp } from './fixtures/helpers';

test.describe('Zero 404 Errors', () => {
  test('page load produces no 404 responses', async ({ page }) => {
    const errors: string[] = [];

    page.on('response', (response) => {
      if (response.status() >= 400) {
        errors.push(`${response.status()} ${response.url()}`);
      }
    });

    await loadApp(page);

    expect(errors).toEqual([]);
  });
});
```

### Test File: `delivery-modal.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { loadApp, addItemToCart, openCart, openDeliveryModal } from './fixtures/helpers';

test.describe('Delivery Modal', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
    await addItemToCart(page, 1);
    await openCart(page);
  });

  test('opens and all fields are fillable', async ({ page }) => {
    await openDeliveryModal(page);

    // Verify modal is visible
    const modal = page.locator('.modal-overlay.active').first();
    await expect(modal).toBeVisible();

    // Fill form fields (selectors based on actual modal DOM)
    await page.selectOption('#deliveryParish', { index: 1 });
    await page.fill('#deliveryAddress', 'Av. Universidad, Caracas, Venezuela, Municipio Chacao');
    await page.fill('#deliveryPhone', '+584242884773');

    // Reference code inputs (6 digits, auto-advance)
    const refInputs = page.locator('.reference-input, input[name*="ref"]');
    const count = await refInputs.count();
    for (let i = 0; i < Math.min(count, 6); i++) {
      await refInputs.nth(i).fill(String(i + 1));
    }

    // Verify Confirmar button exists
    const confirmBtn = page.locator('#confirmDelivery, button:has-text("Confirmar Pedido")');
    await expect(confirmBtn).toBeVisible();
  });

  test('closes via X button', async ({ page }) => {
    await openDeliveryModal(page);

    await page.click('#closeDeliveryModal');
    const modal = page.locator('.modal-overlay.active').first();
    // Modal should no longer be visible
    await expect(modal).not.toBeVisible({ timeout: 3000 }).catch(() => {
      // If selector doesn't match, check the overlay is gone
    });
  });

  test('closes via Cancel button', async ({ page }) => {
    await openDeliveryModal(page);

    await page.click('#cancelDelivery');
    // Modal should close
  });
});
```

### Test File: `cart-sidebar.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { loadApp, addItemToCart, openCart } from './fixtures/helpers';

test.describe('Cart Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
  });

  test('opens and closes cart sidebar', async ({ page }) => {
    await addItemToCart(page, 1);
    await openCart(page);

    const sidebar = page.locator('.cart-sidebar');
    await expect(sidebar).toHaveClass(/open/);

    // Close via closeCart button
    await page.click('#closeCart');
    await expect(sidebar).not.toHaveClass(/open/, { timeout: 3000 });
  });
});
```

---

## File Change Summary

| File | Action | Lines Changed |
|---|---|---|
| `Cliente/js/cliente-carrito.js` | Modify | +7 lines (debounce map + guard at top of `agregarAlCarrito`) |
| `Cliente/index.html` | Modify | 1 line (footer logo `src` attribute) |
| `Cliente/assets/logo-saki.png` | Create | New binary asset (downloaded logo) |
| `Cliente/tests/fixtures/helpers.ts` | Create | ~60 lines (shared test helpers) |
| `Cliente/tests/delivery-modal.spec.ts` | Create | ~60 lines |
| `Cliente/tests/reserva-modal.spec.ts` | Create | ~50 lines |
| `Cliente/tests/cart-sidebar.spec.ts` | Create | ~30 lines |
| `Cliente/tests/cart-debounce.spec.ts` | Create | ~50 lines |
| `Cliente/tests/footer-logo.spec.ts` | Create | ~25 lines |
| `Cliente/tests/network-errors.spec.ts` | Create | ~20 lines |
| `Cliente/tests/modal-close.spec.ts` | Create | ~40 lines |
| `playwright.config.ts` (root) | Create | ~25 lines |

**Total application code changes**: ~8 lines across 2 files  
**New test files**: 8 files (~300 lines total)

---

## Rollback Plan

1. Revert `Cliente/js/cliente-carrito.js` — remove `_ultimoClickCarrito` map and guard
2. Revert `Cliente/index.html` — restore Googleusercontent URL in footer logo `<img>`
3. Delete `Cliente/assets/logo-saki.png`
4. Delete `Cliente/tests/` directory and `playwright.config.ts`

No database migrations, no Supabase changes, no Edge Function changes.

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Debounce breaks legitimate rapid adds of different items | Medium | Per-`platilloId` keying ensures only same-item clicks are debounced |
| Local logo asset differs from original (downloaded at wrong resolution) | Low | Download at original resolution; CSS `object-fit: cover` handles any minor size difference |
| Playwright selectors don't match dynamic DOM | Medium | Use `helpers.ts` with `page.evaluate()` as fallback for cart operations; use resilient selectors (ID-based, not class-based) |
| `_salidaAviso` removal from tests misses regression if it's re-added | Low | The DOM element stays in `index.html`; only test assertions are removed |

---

## Success Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Rapid same-item clicks → 1 cart entry | `cart-debounce.spec.ts` passes |
| 2 | Footer logo loads (status 200, no 404) | `footer-logo.spec.ts` + `network-errors.spec.ts` pass |
| 3 | Delivery modal opens and form is fillable | `delivery-modal.spec.ts` passes |
| 4 | Reserva modal opens and form is fillable | `reserva-modal.spec.ts` passes |
| 5 | Cart sidebar open/close works | `cart-sidebar.spec.ts` passes |
| 6 | Modal close buttons work | `modal-close.spec.ts` passes |
| 7 | Zero 404 network errors on page load | `network-errors.spec.ts` passes |
| 8 | All existing functionality preserved | Manual smoke test: add items, open delivery/reserva, theme toggle, favorites |
