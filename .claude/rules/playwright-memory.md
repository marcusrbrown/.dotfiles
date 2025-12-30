---
description: Memory for Playwright E2E testing patterns, component interaction strategies, and debugging approaches for UI component libraries.
paths: '**/*.spec.ts,**/playwright*.config.ts,**/tests/e2e/**'
---

# Playwright Testing Memory

Patterns for reliable E2E tests with modern UI component libraries and responsive layouts.

## HeroUI Dropdown Components

HeroUI Dropdown menus use React portals and internal state that doesn't respond to standard Playwright clicks.

**Pattern for dropdown interactions:**
```typescript
// Open dropdown with dispatchEvent (not .click())
const menuButton = card.getByRole('button', {name: 'Actions'})
await expect(menuButton).toBeVisible()
await menuButton.dispatchEvent('click')

// Wait for menu item and click with force
const menuItem = page.locator('[data-testid="action-item"]')
await expect(menuItem).toBeVisible({timeout: 10000})
await menuItem.click({force: true})
```

**Why this works:**
- `dispatchEvent('click')` triggers React's synthetic event handlers that HeroUI listens to
- `{force: true}` bypasses Playwright's actionability checks during menu animation
- Extended timeout accounts for portal rendering delay

## Responsive Layout Visibility

Elements with Tailwind's `h-full` class in flex containers may report as "hidden" on small viewports even when present in DOM.

**Use `toBeAttached()` for layout containers:**
```typescript
// For structural elements that may have computed height issues
await expect(page.locator('[data-testid="container"]')).toBeAttached()

// Reserve toBeVisible() for interactive elements
await expect(page.getByRole('button', {name: 'Submit'})).toBeVisible()
```

## Test Data Patterns

Use factory functions for consistent test data:
```typescript
const testGPT = GPTDataFactory.createBasicGPT({name: 'Test GPT'})
```

## UI Architecture Changes

When application routes or page structure change, update test navigation accordingly:

```typescript
// Before: Settings inline in editor
await page.goto('/gpt/new')
await page.getByRole('button', {name: /show api settings/i}).click()

// After: Dedicated settings page
await page.goto('/settings')
```

**Keep navigation helpers centralized** in test setup functions so route changes require single-point updates.

## HeroUI Accordion Components

Accordion content is hidden until expanded. Click the accordion item before testing its contents:

```typescript
const accordionItem = page.locator('[aria-label="Ollama Settings"]')
await expect(accordionItem).toBeVisible()
await accordionItem.click()

// Now content is visible
await page.locator('h2', {hasText: 'Ollama Settings'}).waitFor({state: 'visible'})
```

## Strict Mode Selector Violations

When multiple elements match a selector, Playwright throws strict mode violations. Use specific selectors or `.first()`:

```typescript
// Error: locator resolved to 2 elements (navbar + tab content)
const backupsLink = page.locator('a[href="/backup"]')

// Fix: Use .first() or scope to specific container
const backupsLink = page.locator('[data-testid="data-settings"] a[href="/backup"]').first()
```

## Form Focus Testing

Some HeroUI inputs (hidden password fields, disabled toggles) cannot receive focus. Skip them gracefully:

```typescript
for (const input of inputs) {
  const isDisabled = await input.isDisabled()
  const isVisible = await input.isVisible()
  if (isDisabled || !isVisible) continue

  try {
    await input.focus()
    const isFocused = await input.evaluate(el => document.activeElement === el)
    if (!isFocused) continue
  } catch {
    continue
  }
  // Test focused input...
}
```

## HeroUI Tabs Accessibility

HeroUI tabs may not implement `aria-controls`. Test for accessible names instead:

```typescript
// Fragile: Depends on aria-controls
const ariaControls = await tab.getAttribute('aria-controls')
expect(ariaControls).toBeTruthy()

// Robust: Test accessible name
const tabText = await tab.textContent()
const ariaLabel = await tab.getAttribute('aria-label')
expect(tabText || ariaLabel).toBeTruthy()
```
