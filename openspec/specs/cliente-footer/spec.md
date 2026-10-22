# Cliente Footer Specification

## Purpose
Define the behavior of the footer brand logo loading without 404 errors.

## Requirements

### Requirement: Local Footer Logo Asset

The system MUST load the footer brand logo from a local asset instead of an external Googleusercontent URL to prevent 404 errors.

#### Scenario: Footer brand logo loads successfully from local asset
- GIVEN the Cliente app is loaded
- WHEN the page finishes loading (networkidle)
- THEN the footer brand logo (img.footer-brand-logo) is visible
- AND its src attribute points to a local asset (assets/logo-saki.svg)
- AND the src does NOT contain "googleusercontent.com" or "lh3.googleusercontent.com"
- AND the image loads completely (naturalWidth > 0)
- AND no 404 network error occurs for the logo

### Requirement: Zero Network 404 Errors on Page Load

The system MUST not produce any 404 network errors during initial page load.

#### Scenario: Page load produces no 404 errors
- GIVEN the Cliente app is loaded
- WHEN the page finishes loading (networkidle)
- AND a brief wait for late-loading resources completes
- THEN no network responses have status 404
- AND no network responses have status >= 500
- AND specifically no 404 errors for images, scripts, or stylesheets

---

*Generated from fix-client-bugs change delta — synced 2026-06-09*