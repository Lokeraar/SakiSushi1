# Tasks: Fix Cliente App Bugs

## Change ID
`fix-client-bugs`

## Execution Mode
Interactive — each task is a single commit, tests first (TDD). Do not start the next SDD phase (`sdd-apply` or `sdd-verify`) unless the user explicitly approves.

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~370 lines + 1 binary asset (logo-saki.png) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR (all 4 bugs fit under 400-line budget) |
| Delivery strategy | single-pr |
| Chain strategy | pending |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium
```

### Forecast Rationale

| Category | Estimated Lines |
|---|---|
| `Cliente/tests/fixtures/helpers.ts` (new) | ~60 |
| `playwright.config.ts` (new, project root) | ~25 |
| `Cliente/tests/cart-debounce.spec.ts` (new) | ~50 |
| `Cliente/tests/footer-logo.spec.ts` (new) | ~25 |
| `Cliente/tests/network-errors.spec.ts` (new) | ~20 |
| `Cliente/tests/delivery-modal.spec.ts` (new) | ~60 |
| `Cliente/tests/reserva-modal.spec.ts` (new) | ~50 |
| `Cliente/tests/cart-sidebar.spec.ts` (new) | ~30 |
| `Cliente/tests/modal-close.spec.ts` (new) | ~40 |
| `Cliente/js/cliente-carrito.js` (modified) | +7 |
| `Cliente/index.html` (modified) | +1 |
| `Cliente/assets/logo-saki.png` (new binary) | +1 (git LFS or tracked as binary) |
| **Total estimated** | **~369 lines + 1 binary** |

All changes are tightly scoped: 2 modified application files, 8 new test files, 1 new config file, 1 new binary asset. Well under 400-line threshold. Single PR is safe.

---

## Task Dependency Graph

```
Task 1 (infra)
   ├── Task 2 (cart debounce)  ── depends on helpers.ts from Task 1
   ├── Task 3 (footer logo)    ── depends on helpers.ts + playwright.config.ts from Task 1
   └── Task 4 (modal tests)    ── depends on helpers.ts from Task 1
```

All tasks depend on Task 1. Tasks 2–4 are independent of each other and can be done in any order after Task 1.

---

## Task 1: Playwright Test Infrastructure

**Commit message**: `test: add Playwright test infrastructure with shared helpers`

**Goal**: Bootstrap Playwright for the Cliente app. Create `playwright.config.ts` and shared test helpers so downstream spec files have a working harness.

### TDD Sequence

#### RED — No tests yet. Infrastructure-only task (no production code to test).

This task creates the test harness itself. Verification is manual:

```bash
npx playwright install
npx playwright test --list   # Must list 0 tests (no spec files yet)
```

### Implementation

#### 1.1 Create `playwright.config.ts` (project root)

- **Path**: `E:\Documents\SakiSushi0\playwright.config.ts`
- Content per design spec: `testDir: './Cliente/tests'`, `baseURL: 'https://lokeraar.github.io/SakiSushi0/Cliente/'`
- Browsers: chromium (primary). Firefox and webkit optional (design shows all 3 but consider CI speed — start with chromium only to keep changed lines low).
- Options: `fullyParallel: true`, `retries: CI ? 2 : 0`, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`
- **Do NOT** include `.gitignore` for test artifacts (separate concern)

#### 1.2 Create `Cliente/tests/fixtures/helpers.ts`

- **Path**: `E:\Documents\SakiSushi0\Cliente\tests\fixtures\helpers.ts`
- Export these typed helper functions:
  - `loadApp(page)` — `page.goto(baseURL, { waitUntil: 'networkidle' })`
  - `addItemToCart(page, platilloId?)` — `page.evaluate(id => window.agregarAlCarrito(id), platilloId)`
  - `openCart(page)` — click header cart toggle icon, wait for `.cart-sidebar.open`
  - `openDeliveryModal(page)` — click `#deliveryOrderBtn`, wait for `.modal-overlay.active`
  - `openReservaModal(page)` — click `#reservaOrderBtn`, wait for `.modal-overlay.active`
- Use resilient selectors (IDs preferred, fallback to aria/class)
- Each function should have a timeout-safe `waitForSelector` (5s default)

### Verification

```bash
cd E:\Documents\SakiSushi0
npx playwright test --list    # Expect 0 tests listed (no spec files yet)
npx tsc Cliente/tests/fixtures/helpers.ts --noEmit --strict  # Type-check helpers
```

### Files Changed
- `playwright.config.ts` (NEW, ~25 lines)
- `Cliente/tests/fixtures/helpers.ts` (NEW, ~60 lines)

### Rollback
- Delete `playwright.config.ts`
- Delete `Cliente/tests/fixtures/helpers.ts`

---

## Task 2: Cart Debounce — Test + Implementation (TDD)

**Commit message**: `fix: add 500ms per-platilloId debounce to agregarAlCarrito`

**Goal**: Prevent duplicate cart items from rapid same-item clicks by adding a 500ms debounce guard to `agregarAlCarrito()`. Per-item keying ensures different items can still be added rapidly.

### TDD Sequence

#### 🔴 RED — Write failing test

**File to create**: `Cliente/tests/cart-debounce.spec.ts`

Three test cases (per spec):

1. **`rapid clicks on same item create only one cart item`**
   - Call `window.agregarAlCarrito(1)` 5x in a loop (no await between calls)
   - Assert `window.getCarrito().length === 1`
   - Assert `#cartBadge` text content is `'1'`

2. **`rapid clicks on different items create multiple items`**
   - Call `window.agregarAlCarrito(1)`, `(2)`, `(3)` in sequence
   - Assert `window.getCarrito().length === 3`

3. **`clicks spaced > 500ms on same item create multiple items`**
   - Call `window.agregarAlCarrito(1)`
   - `await page.waitForTimeout(600)` — wait beyond the debounce window
   - Call `window.agregarAlCarrito(1)` again
   - Assert `window.getCarrito().length === 2`

Use `loadApp` from helpers in `beforeEach`.

**Expected**: Test FAILS because debounce doesn't exist yet — all 5 rapid clicks create 5 items.

#### 🟢 GREEN — Implement debounce

**File to modify**: `Cliente/js/cliente-carrito.js`

Changes:
1. Add module-scope variable after the IIFE opening:
   ```javascript
   var _ultimoClickCarrito = {}; // { platilloId → timestamp }
   ```
2. At the top of `agregarAlCarrito(platilloId)`, BEFORE finding the menu item:
   ```javascript
   var ahora = Date.now();
   var ultimo = _ultimoClickCarrito[platilloId] || 0;
   if (ahora - ultimo < 500) {
       return; // silently ignore rapid duplicate click
   }
   _ultimoClickCarrito[platilloId] = ahora;
   ```

That's it. No other functions touched. The toast, badge, and UI updates still fire for the first (allowed) click.

**Expected**: After change, all 3 test cases PASS.

#### 🔷 TRIANGULATE — edge case safety check

Run the full test suite to ensure no regressions in cart behavior:
```bash
npx playwright test cart-debounce --reporter=list
```

Manually review: does the badge show correct count? Does `guardarCarrito` / `restaurarCarrito` still work? (Covered by `getCarrito` assertions.)

#### ♻️ REFACTOR — not needed

The debounce is 3 lines + 1 variable declaration. No refactor needed at this scope.

### Files Changed
- `Cliente/tests/cart-debounce.spec.ts` (NEW, ~50 lines)
- `Cliente/js/cliente-carrito.js` (MODIFY, +7 lines)

### Verification
```bash
npx playwright test cart-debounce --reporter=list
# Expected: 3 passed, 0 failed
```

### Rollback
- Revert `cliente-carrito.js` (remove `_ultimoClickCarrito` and guard)
- Delete `Cliente/tests/cart-debounce.spec.ts`

---

## Task 3: Footer Logo — Test + Asset + HTML (TDD)

**Commit message**: `fix: replace 404 Googleusercontent footer logo with local asset`

**Goal**: Replace the footer logo's Googleusercontent URL (returns 404 in automated tests) with a local asset `assets/logo-saki.png`. Update `index.html` src. Verify via test.

### TDD Sequence

#### 🔴 RED — Write failing tests

**File to create**: `Cliente/tests/footer-logo.spec.ts`

One test case:
1. **`footer brand logo loads successfully from local asset`**
   - Set up page response listener for URL containing `logo-saki.png`
   - Call `loadApp(page)`
   - Wait for the response, assert `status === 200`
   - Assert `img.footer-brand-logo` is visible
   - Assert `src` attribute equals `'assets/logo-saki.png'`

**File to create**: `Cliente/tests/network-errors.spec.ts`

One test case:
1. **`page load produces no 404 responses`**
   - Register `page.on('response', ...)` collector for status >= 400
   - Call `loadApp(page)`
   - Assert errors array is empty (`expect(errors).toEqual([])`)

**Expected**: Both tests FAIL — `logo-saki.png` doesn't exist yet (404), and the page still loads the Googleusercontent URL.

#### 🟢 GREEN — Implement asset and HTML change

1. **Download logo asset**:
   - Create directory `Cliente/assets/` if not present
   - Download the original image from the existing Googleusercontent URL:
     `https://lh3.googleusercontent.com/pw/AP1GczPrZAoWxmsOGRD9xl1hO5Q65JXuwUZzoR6gUk-cw5lVmarxQe_-lwqpA60tTKLlXfpvIjAJlKC6jFls-xETJOPkebLIIPhbGlUkknmhrRbdhMUll2UViGSUj3WmHKg2YEsZlAfxBPPTjIHhScjD0jfe=w1439-h1439-s-no-gm`
   - Save as `Cliente/assets/logo-saki.png`
   - Verify the image is valid (can open in browser, correct dimensions ~140x155)

2. **Update `index.html`** (line 2868):
   ```html
   <!-- BEFORE -->
   <img src="https://lh3.googleusercontent.com/pw/AP1GczPrZAoWxmsOGRD9xl1hO5Q65JXuwUZzoR6gUk-cw5lVmarxQe_-lwqpA60tTKLlXfpvIjAJlKC6jFls-xETJOPkebLIIPhbGlUkknmhrRbdhMUll2UViGSUj3WmHKg2YEsZlAfxBPPTjIHhScjD0jfe=w1439-h1439-s-no-gm" alt="Saki Sushi" class="footer-brand-logo" style="width:140px; height:155px;">

   <!-- AFTER -->
   <img src="assets/logo-saki.png" alt="Saki Sushi" class="footer-brand-logo" style="width:140px; height:155px;">
   ```

**Expected**: Both tests PASS after the asset is downloadable and HTML src is updated.

#### 🔷 TRIANGULATE

- Run `network-errors.spec.ts` in isolation to verify zero 404s on full page load
- Manually open the page and inspect the footer logo loads (visual check)

#### ♻️ REFACTOR — not needed

Single-line HTML change and a binary asset. No refactor.

### Files Changed
- `Cliente/assets/logo-saki.png` (NEW, binary)
- `Cliente/index.html` (MODIFY, 1 line)
- `Cliente/tests/footer-logo.spec.ts` (NEW, ~25 lines)
- `Cliente/tests/network-errors.spec.ts` (NEW, ~20 lines)

### Verification
```bash
npx playwright test footer-logo network-errors --reporter=list
# Expected: 2 passed, 0 failed
```

### Rollback
- Revert `index.html` line 2868 to original Googleusercontent URL
- Delete `Cliente/assets/logo-saki.png`
- Delete `Cliente/tests/footer-logo.spec.ts`
- Delete `Cliente/tests/network-errors.spec.ts`

---

## Task 4: Modal Interaction Tests — Delivery, Reserva, Cart, Close Buttons

**Commit message**: `test: add Playwright specs for Delivery/Reserva modals, cart sidebar, and close buttons`

**Goal**: Create end-to-end Playwright tests for all modal interactions. These tests are designed from scratch to click the correct open triggers before interacting with forms (unlike the previous broken tests that assumed modals were pre-opened).

### TDD Sequence

#### 🔴 RED — Write 4 spec files, all currently failing because modals require clicking open triggers

**File 1**: `Cliente/tests/delivery-modal.spec.ts`

Test cases (per spec):
1. **`opens and all fields are fillable`**
   - Background: loadApp → addItemToCart(1) → openCart → openDeliveryModal
   - Verify modal is visible (`.modal-overlay.active`)
   - Fill `#deliveryParish` (selectOption index 1)
   - Fill `#deliveryAddress` (min 20 chars: "Av. Universidad, Caracas, Venezuela, Municipio Chacao")
   - Fill `#deliveryPhone` ("+584242884773")
   - Fill reference code inputs (6 digits, auto-advance)
   - Assert `#confirmDelivery` or button with text "Confirmar Pedido" is visible

2. **`closes via X button`**
   - Open modal → click `#closeDeliveryModal` → assert modal not visible

3. **`closes via Cancel button`** (if `#cancelDelivery` exists)
   - Open modal → click `#cancelDelivery` → assert modal not visible

**File 2**: `Cliente/tests/reserva-modal.spec.ts`

Test cases:
1. **`opens and all fields are fillable`**
   - Background: loadApp → addItemToCart(1) → openCart → openReservaModal
   - Verify modal visible
   - Fill date field, name (min 3 chars), reference code
   - Assert "Confirmar Reserva" button is visible

2. **`closes via X button`**
   - Open modal → click `#closeReservaModal` → assert modal not visible

**File 3**: `Cliente/tests/cart-sidebar.spec.ts`

Test cases:
1. **`opens and closes cart sidebar`**
   - loadApp → addItemToCart(1)
   - Click cart toggle icon
   - Assert `.cart-sidebar` has class `open`
   - Click `#closeCart`
   - Assert `.cart-sidebar` does NOT have class `open`

**File 4**: `Cliente/tests/modal-close.spec.ts`

Test cases:
1. **`Delivery modal closes via X button`** — same as delivery-modal.spec.ts but more explicit: check timer stopped, overlay removed
2. **`Reserva modal closes via X button`** — same for reserva
3. **`Delivery modal closes via Cancel button`** — click `#cancelDelivery`

**Note**: This file covers the close-button edge cases. Tests 1–2 may overlap with delivery/reserva specs — that's intentional for boundary coverage. If both specs test the same close behavior, keep one authoritative and make the other a lightweight smoke test.

**Expected**: Tests FAIL initially because:
- The page loads against the live `baseURL` (or a static server)
- Modal interaction requires clicking the correct open trigger buttons
- The tests are designed to click those triggers first, so they *should* pass once written correctly
- However, without the test infrastructure (Task 1) completed, these tests won't even compile

Wait — these tests use `loadApp`, `addItemToCart`, `openCart`, `openDeliveryModal`, `openReservaModal` from helpers.ts, which was created in Task 1. So after Task 1 is done, these tests should work.

But from a pure TDD perspective: if we write the tests FIRST (before the app code that makes them pass), they'd fail because... well, the app code already exists. The modals already open correctly. The tests are testing EXISTING functionality, not new functionality.

So these tests should PASS immediately after Task 1 is done, because:
- `loadApp` navigates to the live site
- `addItemToCart` calls the existing `window.agregarAlCarrito()`
- `openCart` clicks the existing cart toggle
- `openDeliveryModal` clicks `#deliveryOrderBtn` which calls `iniciarProcesoDelivery()`, which adds the `.active` class

The only "fix" in the test is that we're clicking the buttons FIRST. That's the test update pattern described in the design.

So the TDD sequence here is:
- 🔴 Write tests — they should actually pass if the infrastructure is correct
- No 🟢 step needed for app code (no app changes)
- The "fix" is purely in the test design itself

This means these are "test creation" tasks rather than "test-driven development" tasks. I'll note this explicitly.

#### 🟢 GREEN — No app code changes needed

Per the design decision log:
> **Modal test strategy**: Test fix only. The modals already open correctly via `iniciarProcesoDelivery/Reserva()`. The Playwright test must click "Delivery"/"Reserva" buttons first before filling forms. **No code change needed for modals.**

So no GREEN phase for app code. The tests test existing correct behavior.

#### 🔷 TRIANGULATE

Run all modal tests together:
```bash
npx playwright test delivery-modal reserva-modal cart-sidebar modal-close --reporter=list
```

Also run the full suite to ensure no regressions:
```bash
npx playwright test --reporter=list
```

#### ♻️ REFACTOR — not needed

Test code is straightforward. However, if selectors change (e.g., `#deliveryOrderBtn` doesn't match dynamic DOM), update the selectors in `helpers.ts` rather than inline in each test.

### Files Changed
- `Cliente/tests/delivery-modal.spec.ts` (NEW, ~60 lines)
- `Cliente/tests/reserva-modal.spec.ts` (NEW, ~50 lines)
- `Cliente/tests/cart-sidebar.spec.ts` (NEW, ~30 lines)
- `Cliente/tests/modal-close.spec.ts` (NEW, ~40 lines)

### Verification
```bash
npx playwright test delivery-modal reserva-modal cart-sidebar modal-close --reporter=list
# Expected: all tests pass
```

### Rollback
- Delete the 4 spec files listed above

---

## Full Test Suite Verification (Final)

After all 4 tasks are complete, run the entire test suite:

```bash
cd E:\Documents\SakiSushi0
npx playwright test --reporter=list
```

Expected result:

```
Cliente/tests/
  ✓ cart-debounce.spec.ts (3 tests)
  ✓ footer-logo.spec.ts (1 test)
  ✓ network-errors.spec.ts (1 test)
  ✓ delivery-modal.spec.ts (2-3 tests)
  ✓ reserva-modal.spec.ts (2 tests)
  ✓ cart-sidebar.spec.ts (1 test)
  ✓ modal-close.spec.ts (2-3 tests)

Total: ~13+ tests, all passed
```

---

## Change Summary

| File | Action | Task |
|---|---|---|
| `playwright.config.ts` | CREATE | 1 |
| `Cliente/tests/fixtures/helpers.ts` | CREATE | 1 |
| `Cliente/tests/cart-debounce.spec.ts` | CREATE | 2 |
| `Cliente/js/cliente-carrito.js` | MODIFY (+7 lines) | 2 |
| `Cliente/tests/footer-logo.spec.ts` | CREATE | 3 |
| `Cliente/tests/network-errors.spec.ts` | CREATE | 3 |
| `Cliente/assets/logo-saki.png` | CREATE (binary) | 3 |
| `Cliente/index.html` | MODIFY (1 line) | 3 |
| `Cliente/tests/delivery-modal.spec.ts` | CREATE | 4 |
| `Cliente/tests/reserva-modal.spec.ts` | CREATE | 4 |
| `Cliente/tests/cart-sidebar.spec.ts` | CREATE | 4 |
| `Cliente/tests/modal-close.spec.ts` | CREATE | 4 |

**Total**: 8 new test files, 2 modified app files, 1 new config, 1 new asset = ~370 lines + binary.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Googleusercontent URL becomes inaccessible before logo is downloaded | Low | If download fails, use the header logo URL instead (same image) or ask user to provide the file |
| Playwright cannot find cart toggle icon selector | Low | Use `page.evaluate` to call `window.abrirCarrito?.()` if the icon selector is unreliable; fallback in helpers.ts |
| `#deliveryOrderBtn` / `#reservaOrderBtn` IDs differ from actual DOM | Low | Inspect `actualizarCarritoUI()` output in `cliente-carrito.js` lines 257-258 — verify IDs match. Update helpers if needed. |
| Binary asset increases repo size | Low | Single small PNG (~20-50KB). No git-lfs needed. |
