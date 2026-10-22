# Cliente Cart Specification

## Purpose
Define the behavior of the shopping cart in the SakiSushi0 Cliente app, including debounce protection against duplicate items.

## Requirements

### Requirement: Cart Debounce Protection

The system MUST prevent duplicate cart items when a user rapidly clicks the "Add to cart" button on the same product within 500ms.

#### Scenario: Rapid clicks on same item within debounce window
- GIVEN the Cliente app is loaded with menu items visible
- WHEN the user clicks "Add to cart" on the same item 5 times within 500ms
- THEN only 1 cart item is created for that platilloId
- AND the cart badge shows quantity 1
- AND only a single success toast appears

#### Scenario: Rapid clicks on different items create multiple items
- GIVEN the Cliente app is loaded with multiple menu items visible
- WHEN the user clicks "Add to cart" on item A, then item B, then item C within 500ms
- THEN 3 separate cart items are created (one per platilloId)
- AND the cart badge shows quantity 3
- AND 3 success toasts appear

#### Scenario: Clicks spaced beyond debounce window create multiple items
- GIVEN the Cliente app is loaded
- WHEN the user clicks "Add to cart" on item A
- AND waits 600ms (beyond 500ms debounce window)
- AND clicks "Add to cart" on item A again
- THEN 2 cart items are created for that platilloId
- AND the cart badge shows quantity 2
- AND the items are grouped under the same nivel1 group with quantity "2 uds"

### Requirement: Cart Persistence

The system MUST persist cart state to localStorage with 1-hour TTL.

#### Scenario: Cart restores on page reload
- GIVEN the user has items in cart
- WHEN the page is reloaded within 1 hour
- THEN the cart items are restored from localStorage
- AND the cart badge shows correct count

#### Scenario: Expired cart is cleared
- GIVEN the cart data in localStorage is older than 1 hour
- WHEN the page loads
- THEN the cart is empty
- AND localStorage cart entry is removed

### Requirement: Cart 3-Level Grouping

The system MUST display cart items grouped hierarchically:
- Level 1: By platilloId (product)
- Level 2: By personalización (customization)
- Level 3: Individual item instances

#### Scenario: Cart displays grouped items correctly
- GIVEN the cart has multiple items (some with personalización)
- WHEN the cart sidebar is opened
- THEN items are grouped by platilloId at nivel1
- AND personalized items are sub-grouped at nivel2
- AND individual instances shown at nivel3
- AND totals per group displayed correctly

---

*Generated from fix-client-bugs change delta — synced 2026-06-09*