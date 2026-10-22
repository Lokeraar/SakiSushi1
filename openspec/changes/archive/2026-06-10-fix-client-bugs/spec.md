# SDD Spec: Fix Cliente App Bugs

## Change ID
`fix-client-bugs`

## Gherkin Specs for Playwright

---

### Feature: Delivery Modal Form

**Background:**
- User navigates to https://lokeraar.github.io/SakiSushi0/Cliente/
- Page loads completely (networkidle)

**Scenario: Open Delivery modal and fill all required fields**
```gherkin
Given the Cliente app is loaded
And the cart has at least one item
When the user clicks the "Delivery" button in the cart footer
Then the delivery modal becomes visible (has class "active")
And the order summary is displayed
And the 20-minute timer starts counting down

When the user selects a parish from the dropdown
And enters a valid address (min 20 characters)
And enters a valid phone number (+58XXXXXXXXXXX format)
And enters a 6-digit reference code (auto-advances between inputs)
And uploads a payment proof image (max 5MB)
Then all form fields are fillable without timeout
And the "Confirmar Pedido" button becomes enabled

When the user clicks "Confirmar Pedido"
Then the order is submitted via Supabase RPC
And the cart is cleared
And the modal closes
And a success toast appears
```

**Scenario: Delivery modal parish search filters options**
```gherkin
Given the Delivery modal is open
When the user types "Chacao" in the parish search input
Then only matching parishes are shown in the dropdown
And selecting "Chacao" updates the delivery cost display
```

---

### Feature: Reserva Modal Form

**Background:**
- User navigates to https://lokeraar.github.io/SakiSushi0/Cliente/
- Page loads completely
- Cart has at least one item

**Scenario: Open Reserva modal and fill all required fields**
```gherkin
Given the Cliente app is loaded with items in cart
When the user clicks the "Reserva" button in the cart footer
Then the reserva modal becomes visible (has class "active")
And the order summary is displayed
And the 20-minute timer starts counting down

When the user selects a future date
And enters a name (min 3 characters)
And enters a 6-digit reference code (auto-advances between inputs)
And uploads a payment proof image (max 5MB)
Then all form fields are fillable without timeout
And the "Confirmar Reserva" button becomes enabled

When the user clicks "Confirmar Reserva"
Then the reservation is registered
And the modal closes
And a success toast appears
```

---

### Feature: Cart Sidebar Interactions

**Scenario: Open and close cart sidebar**
```gherkin
Given the Cliente app is loaded
When the user clicks the cart toggle button (shopping cart icon)
Then the cart sidebar opens (has class "open")
And the overlay becomes active

When the user clicks the close cart button (id="closeCart")
Then the cart sidebar closes (class "open" removed)
And the overlay becomes inactive
```

**Scenario: Cart shows items with 3-level grouping**
```gherkin
Given the cart has multiple items (some with personalization)
When the cart sidebar is open
Then items are grouped by platilloId (nivel 1)
And personalized items are sub-grouped (nivel 2)
And individual instances are shown (nivel 3)
And totals per group are displayed correctly
```

---

### Feature: Cart Debounce (Prevent Duplicate Items)

**Scenario: Rapid clicks on same "Add to cart" button create only one item**
```gherkin
Given the Cliente app is loaded with menu items visible
When the user clicks "Add to cart" on the same item 5 times within 500ms
Then only 1 cart item is created for that platilloId
And the cart badge shows quantity 1
And a single success toast appears
```

**Scenario: Rapid clicks on different items create multiple items**
```gherkin
Given the Cliente app is loaded with multiple menu items visible
When the user clicks "Add to cart" on item A, then item B, then item C within 500ms
Then 3 separate cart items are created (one per platilloId)
And the cart badge shows quantity 3
And 3 success toasts appear
```

**Scenario: Clicks spaced > 500ms on same item create multiple items**
```gherkin
Given the Cliente app is loaded
When the user clicks "Add to cart" on item A
And waits 600ms
And clicks "Add to cart" on item A again
Then 2 cart items are created for that platilloId
And the cart badge shows quantity 2
```

---

### Feature: Footer Logo Loads Without 404

**Scenario: Footer brand logo loads successfully**
```gherkin
Given the Cliente app is loaded
When the page finishes loading (networkidle)
Then the footer brand logo (img.footer-brand-logo) has loaded
And its src is a local asset (assets/logo-saki.png)
And no 404 network error occurs for the logo
```

---

### Feature: Zero Network 404 Errors

**Scenario: Page load produces no 404 errors**
```gherkin
Given the Cliente app is loaded
When the page finishes loading (networkidle)
Then no network responses have status >= 400
And specifically no 404 errors for images, scripts, or stylesheets
```

---

### Feature: Modal Close Buttons Work

**Scenario: Delivery modal closes via X button**
```gherkin
Given the Delivery modal is open
When the user clicks the close button (id="closeDeliveryModal")
Then the modal closes (class "active" removed)
And timers are stopped
And form data is preserved in sessionStorage
```

**Scenario: Reserva modal closes via X button**
```gherkin
Given the Reserva modal is open
When the user clicks the close button (id="closeReservaModal")
Then the modal closes (class "active" removed)
And timers are stopped
And form data is preserved in sessionStorage
```

**Scenario: Delivery modal closes via Cancel button**
```gherkin
Given the Delivery modal is open
When the user clicks "Cancelar" button (id="cancelDelivery")
Then the modal closes (class "active" removed)
And timers are stopped
```

---

## Test File Structure

```
Cliente/tests/
├── delivery-modal.spec.ts      # Delivery modal scenarios
├── reserva-modal.spec.ts       # Reserva modal scenarios
├── cart-sidebar.spec.ts        # Cart sidebar scenarios
├── cart-debounce.spec.ts       # Cart debounce scenarios
├── footer-logo.spec.ts         # Footer logo scenario
├── network-errors.spec.ts      # 404 check scenario
└── modal-close.spec.ts         # Close button scenarios
```

## Playwright Config (add to existing or create)
```typescript
// playwright.config.ts
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
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
```

---

## Implementation Notes

### Cart Debounce Implementation (cliente-carrito.js)
```javascript
// Add to module scope
var _ultimoClickCarrito = {}; // { platilloId: timestamp }

function agregarAlCarrito(platilloId) {
    var ahora = Date.now();
    var ultimo = _ultimoClickCarrito[platilloId] || 0;
    if (ahora - ultimo < 500) {
        // Ignorar click duplicado rápido
        return;
    }
    _ultimoClickCarrito[platilloId] = ahora;
    
    // ... existing logic
}
```

### Footer Logo Implementation
1. Download/save logo to `Cliente/assets/logo-saki.png`
2. Update `index.html` footer:
   ```html
   <img src="assets/logo-saki.png" alt="Saki Sushi" class="footer-brand-logo" style="width:140px; height:155px;">
   ```

### Playwright Test Updates
- All modal tests: Click Delivery/Reserva buttons before filling forms
- Cart test: Click cart toggle before clicking closeCart
- Remove exit modal expectations (_salidaAviso)