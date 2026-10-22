import { Page, Locator, expect } from '@playwright/test';

/**
 * Shared selectors extracted from Cliente app DOM
 * Update these if DOM structure changes
 */
export const SELECTORS = {
  // Cart
  cartToggle: '#cartToggle',
  cartSidebar: '#cartSidebar',
  closeCart: '#closeCart',
  cartItems: '#cartItems',
  cartBadge: '#cartBadge',
  deliveryOrderBtn: '#deliveryOrderBtn',
  reservaOrderBtn: '#reservaOrderBtn',

  // Delivery Modal
  deliveryModal: '#deliveryModal',
  closeDeliveryModal: '#closeDeliveryModal',
  cancelDelivery: '#cancelDelivery',
  confirmDelivery: '#confirmDelivery',
  parroquiaSearch: '#parroquiaSearch',
  parroquiaSelect: '#parroquiaSelect',
  selectedParroquiaText: '#selectedParroquiaText',
  direccion: '#direccion',
  telefono: '#telefono',
  deliveryRefInputs: '.ref-digit[data-type="delivery"]',
  comprobante: '#comprobante',
  deliveryTotal: '#deliveryTotal',

  // Reserva Modal
  reservaModal: '#reservaModal',
  closeReservaModal: '#closeReservaModal',
  cancelReserva: '#cancelReserva',
  confirmReserva: '#confirmReserva',
  fechaReserva: '#fechaReserva',
  nombreReserva: '#nombreReserva',
  reservaRefInputs: '.ref-digit[data-type="reserva"]',
  comprobanteReserva: '#comprobanteReserva',
  reservaTotal: '#reservaTotal',

  // Footer
  footerLogo: '.footer-brand-logo',

  // Toasts
  toast: '.toast',
} as const;

export type SelectorKey = keyof typeof SELECTORS;