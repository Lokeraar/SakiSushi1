# Proposal: Refactor inline JavaScript to modules

## Intent
Refactor the monolithic inline JavaScript in Cliente/index.html into modular, maintainable, and performant modules to address performance issues on modest devices, preserving functionality while improving CPU usage and responsiveness.

## Scope

### In Scope
- Split ~2630 lines of inline JS into 16 focused modules under Cliente/js/
- Implement performance optimizations: lazy loading, memoization, debouncing, cleanup
- Establish window.Saki namespace with state, utils, and modules
- Maintain backward compatibility for existing onclick handlers
- Add proper cleanup of timers, observers, and WebSocket connections
- Implement event delegation where appropriate

### Out of Scope
- Changes to CSS or HTML structure
- Backend API modifications
- New features beyond refactoring existing functionality
- Styling or theme changes
- Admin or Cajero module modifications

## Structure of Modules
- cliente-utils.js: ID generation, formatting, clipboard, toast
- cliente-theme.js: Theme toggling and persistence
- cliente-favoritos.js: Favorite toggling and checking
- cliente-stock.js: Stock calculation and caching
- cliente-menu.js: Menu loading, rendering, categorization, pagination, search
- cliente-carrito.js: Cart management (levels 1-3, grouping, persistence)
- cliente-customize.js: Customization modal, ingredients, dynamic pricing
- cliente-preview.js: Dish preview modal
- cliente-scroll.js: Scroll overlays and item scrolling
- cliente-notificaciones.js: Realtime notifications, badges, sounds, visibility-aware
- cliente-pedidos.js: Order confirmation and transactional flow
- cliente-delivery.js: Delivery, reservation, 20-min timer, mobile payment
- cliente-historial.js: Previous orders view
- cliente-ui.js: Hamburger menu, event listeners, panel management
- cliente-voz.js: Voice search
- cliente-init.js: App initialization, cleanup, visibility/beforeunload handlers

## Performance Optimizations by Module
- **cliente-menu.js**: Native lazy loading (`loading="lazy"`), memoized search filters, batch rendering (DOM fragments)
- **cliente-carrito.js**: Partial DOM updates, cached cart element references, minimized reflows
- **cliente-notificaciones.js**: WebSocket connection only when page visible, pause/resume on visibilitychange
- **cliente-init.js**: Exhaustive cleanup of timers, MutationObservers, WebSocket channels in beforeunload
- **cliente-stock.js**: Memoized stock calculations with controlled invalidation on menu/cart changes
- **cliente-ui.js**: Event delegation for category menus and product grids
- **cliente-voz.js**: SpeechRecognition only active during voice search, not persistent
- **Global**: window.Saki namespace reduces global pollution; each module registers as Saki.modules.<name>

## Migration Strategy
1. Create modules incrementally, starting with utilities
2. For each module:
   - Copy relevant JS from index.html
   - Wrap in IIFE or ES module pattern
   - Attach to window.Saki.modules and maintain window.* fallbacks
   - Remove processed JS from index.html
   - Add script tag for new module in index.html head
3. After each module, verify functionality manually
4. Final verification: compare behavior before/after for key user flows

## Risks and Mitigations
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Breaking existing onclick handlers | Medium | Maintain window.* fallbacks; test all inline handlers |
| Missing cleanup causing memory leaks | Low | Implement beforeunload/visibilitychange handlers in cliente-init.js |
| Performance regression during transition | Medium | Benchmark key interactions after each module |
| Increased initial load due to multiple files | Low | Minify and bundle in production; keep dev separate |
| Inconsistent state between modules | Low | Use window.Saki.state as single source of truth where needed |

## Effort Estimate
- **Analysis**: 2 hours (completed)
- **Module creation**: 8 hours (16 modules × 30 min each)
- **Optimization implementation**: 4 hours
- **Testing and verification**: 3 hours
- **Total**: ~17 hours

## Success Criteria
- [ ] CPU usage reduced by 30% during typical navigation (measured via Chrome DevTools)
- [ ] No JavaScript errors in console during core user flows
- [ ] All existing functionality preserved (menu browsing, cart, customization, ordering)
- [ ] Proper cleanup observed when navigating away or closing tabs
- [ ] Modules load without blocking initial render