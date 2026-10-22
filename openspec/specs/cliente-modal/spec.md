# Cliente Modal Specification

## Purpose
Define the behavior of Delivery and Reserva modals, cart sidebar, and all close mechanisms in the SakiSushi0 Cliente app.

## Requirements

### Requirement: Delivery Modal Interaction

The system MUST allow users to open, fill, and submit the Delivery modal form.

#### Scenario: Open Delivery modal and verify all fields accessible
- GIVEN the Cliente app is loaded with items in cart
- WHEN the user clicks the "Delivery" button in the cart footer
- THEN the delivery modal becomes visible (has class "active")
- AND the order summary is displayed
- AND the 20-minute timer starts counting down
- AND all form fields are visible and fillable:
  - Parish selector (search + dropdown)
  - Address textarea (min 20 chars)
  - Phone input (+58 format)
  - 6-digit reference code (auto-advance inputs)
  - Comprobante file upload
- AND the "Confirmar Pedido" button is initially disabled

#### Scenario: Delivery modal parish search filters options
- GIVEN the Delivery modal is open
- WHEN the user types "Chacao" in the parish search input
- THEN only matching parishes are shown in the dropdown
- AND selecting "Chacao" updates the delivery cost display

#### Scenario: Fill Delivery form completely enables confirm button
- GIVEN the Delivery modal is open
- WHEN the user selects a parish
- AND enters a valid address (min 20 characters)
- AND enters a valid phone number (+58XXXXXXXXXXX format)
- AND enters a 6-digit reference code (auto-advances between inputs)
- AND uploads a payment proof image (max 5MB)
- THEN all form fields are fillable without timeout
- AND the "Confirmar Pedido" button becomes enabled

#### Scenario: Close Delivery modal via X button
- GIVEN the Delivery modal is open
- WHEN the user clicks the close button (id="closeDeliveryModal")
- THEN the modal closes (class "active" removed)
- AND timers are stopped
- AND form data is preserved in sessionStorage

#### Scenario: Close Delivery modal via Cancel button
- GIVEN the Delivery modal is open
- WHEN the user clicks "Cancelar" button (id="cancelDelivery")
- THEN the modal closes (class "active" removed)
- AND timers are stopped

---

### Requirement: Reserva Modal Interaction

The system MUST allow users to open, fill, and submit the Reserva modal form.

#### Scenario: Open Reserva modal and verify all fields accessible
- GIVEN the Cliente app is loaded with items in cart
- WHEN the user clicks the "Reserva" button in the cart footer
- THEN the reserva modal becomes visible (has class "active")
- AND the order summary is displayed
- AND the 20-minute timer starts counting down
- AND all form fields are visible and fillable:
  - Date picker (future dates only)
  - Name input (min 3 characters)
  - 6-digit reference code (auto-advance inputs)
  - Comprobante file upload
- AND the "Confirmar Reserva" button is initially disabled

#### Scenario: Fill Reserva form completely enables confirm button
- GIVEN the Reserva modal is open
- WHEN the user selects a future date
- AND enters a name (min 3 characters)
- AND enters a 6-digit reference code (auto-advances between inputs)
- AND uploads a payment proof image (max 5MB)
- THEN all form fields are fillable without timeout
- AND the "Confirmar Reserva" button becomes enabled

#### Scenario: Close Reserva modal via X button
- GIVEN the Reserva modal is open
- WHEN the user clicks the close button (id="closeReservaModal")
- THEN the modal closes (class "active" removed)
- AND timers are stopped

#### Scenario: Close Reserva modal via Cancel button
- GIVEN the Reserva modal is open
- WHEN the user clicks "Cancelar" button (id="cancelReserva")
- THEN the modal closes (class "active" removed)

#### Scenario: Date picker minimum date is today
- GIVEN the Reserva modal is open
- WHEN the user opens the date picker
- THEN the minimum selectable date is today
- AND past dates are disabled

---

### Requirement: Cart Sidebar Interaction

The system MUST allow users to open and close the cart sidebar.

#### Scenario: Open and close cart sidebar
- GIVEN the Cliente app is loaded
- WHEN the user clicks the cart toggle button (shopping cart icon)
- THEN the cart sidebar opens (has class "open")
- AND the overlay becomes active

- WHEN the user clicks the close cart button (id="closeCart")
- THEN the cart sidebar closes (class "open" removed)
- AND the overlay becomes inactive

#### Scenario: Cart shows items with 3-level grouping
- GIVEN the cart has multiple items (some with personalization)
- WHEN the cart sidebar is open
- THEN items are grouped by platilloId (nivel 1)
- AND personalized items are sub-grouped (nivel 2)
- AND individual instances are shown (nivel 3)
- AND totals per group are displayed correctly

#### Scenario: Delivery and Reserva buttons appear in cart footer
- GIVEN the cart has at least one item
- WHEN the cart sidebar is open
- THEN both "Delivery" and "Reserva" buttons are visible
- AND clicking "Delivery" opens the Delivery modal
- AND clicking "Reserva" opens the Reserva modal

---

### Requirement: Modal Close Mechanisms

The system MUST provide multiple ways to close modals and sidebars.

#### Scenario: Overlay click closes all modals and sidebars
- GIVEN the Delivery modal is open (or cart sidebar open)
- WHEN the user clicks the overlay (#overlay)
- THEN the modal closes (class "active" removed)
- AND the cart sidebar closes if open (class "open" removed)

---

*Generated from fix-client-bugs change delta — synced 2026-06-09*