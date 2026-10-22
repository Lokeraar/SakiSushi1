# SDD Proposal: Fix Cliente App Bugs Found in Playwright Testing

## Change ID
`fix-client-bugs`

## Intent
Fix critical bugs in the SakiSushi0 Cliente app discovered during automated Playwright testing against https://lokeraar.github.io/SakiSushi0/Cliente/

## Scope
Fixes for the Cliente app (`E:\Documents\SakiSushi0\Cliente\`):

1. **Modal form visibility** - Delivery/Reserva modals hidden by default, forms not fillable without opening modals first
2. **Button visibility** - Exit confirmation and cart close buttons inside hidden modals/panels
3. **Cart duplication** - Rapid "Add to cart" clicks create duplicate items
4. **404 resource** - Footer logo image from Googleusercontent returns 404

## Affected Areas
- `Cliente/index.html` — Modal DOM structure, footer logo
- `Cliente/js/cliente-delivery.js` — Modal opening logic, form validation
- `Cliente/js/cliente-ui.js` — Event listeners for modal buttons, cart toggle
- `Cliente/js/cliente-carrito.js` — `agregarAlCarrito` function (debounce needed)
- `Cliente/js/cliente-init.js` — Initialization lifecycle

## Risks
- **Low**: Changes are bug fixes with clear root causes
- **Medium**: Cart debounce must not break legitimate rapid adds (different items)
- **Low**: Modal logic is well-isolated in `cliente-delivery.js`

## Rollback
Revert the 4-5 changed files. No database migrations.

## Success Criteria
1. Playwright test passes: all 20 form fields fillable after modal open
2. Playwright test passes: all 4 previously-hidden buttons clickable
3. Cart: Rapid clicks on same "Add to cart" button within 500ms create only 1 item
4. Network: Zero 404 errors on page load
5. All existing functionality preserved (delivery, reserva, cart, theme, favorites)

## Current-State Gap
| Bug | Current Behavior | Expected |
|-----|------------------|----------|
| Modal forms | Hidden (`display: none` via `.modal-overlay` without `.active`) | Forms fillable after clicking Delivery/Reserva buttons |
| Hidden buttons | 4 buttons in hidden modals/panels | Clickable when modals/panels open |
| Cart dupe | Each click = new cart item (unique ID) | Debounced: rapid same-item clicks = 1 item |
| 404 | Footer logo from Googleusercontent fails | Local or reliable CDN image |

## Business Impact
- **User-facing**: Delivery/Reserva forms unusable if modals don't open properly
- **Data integrity**: Cart duplication creates phantom orders
- **Reliability**: 404 resource fails silently but affects branding
- **Testing**: Automated tests cannot validate critical user flows

## Non-Goals
- Refactoring modal architecture (works when opened correctly)
- Changing Supabase schema or Edge Functions
- Admin/Cajero panels (not tested)

## First-Slice Boundaries
This proposal covers **only** the 4 bugs above. Modal UX improvements, new features, or Admin panel fixes are out of scope.

---

## Answers to Proposal Questions (User Decisions)

### 1. Cart debounce window
**Decision**: 500ms per-item (same `platilloId`). Different items can be added rapidly.

### 2. 404 resource replacement
**Decision**: Host locally in repo. Add logo to `Cliente/assets/logo-saki.png` and reference relatively.

### 3. Modal test strategy
**Decision**: **Test fix only**. The modals already open correctly via `iniciarProcesoDelivery/Reserva()` (they add `.active` class). The Playwright test must click "Delivery"/"Reserva" buttons first before filling forms. No code change needed for modals.

### 4. Exit confirmation modal (`_salidaAviso`)
**Decision**: Remove from test expectations. The browser native `beforeunload` (in `cliente-init.js` and HTML head) handles exit protection. The custom modal was removed intentionally.

### 5. Scope confirmation
**Decision**: **Single SDD cycle for all 4 bugs**. They're related (testing blockers + data integrity) and small enough to fix together.

---

## Updated Success Criteria (Post-Decisions)

1. **Playwright test updated** to click Delivery/Reserva buttons before filling forms → all 20 fields fillable
2. **Playwright test updated** to open cart sidebar before clicking closeCart → button clickable
3. **Cart debounce**: `agregarAlCarrito` ignores rapid clicks on same `platilloId` within 500ms
4. **Footer logo**: Local asset `assets/logo-saki.png` loads without 404
5. **All existing functionality preserved**

---

## Ready for Spec Phase

Proceed to `sdd-spec` to write executable Gherkin specs for Playwright.