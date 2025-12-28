---
description: Memory for Astro Starlight integration patterns, React component hydration, and MDX layout debugging strategies that prevent wasted time on ineffective solutions.
paths: '**/astro.config.*,**/*.astro,**/*.mdx,**/src/content/docs/**'
---

# Astro Starlight Memory

Critical patterns for Astro Starlight documentation sites, especially React component integration in MDX pages and layout debugging strategies.

## React Components Breaking Starlight Layout - The Real Diagnosis Process

**CRITICAL KNOWLEDGE GAP: When React components cause Starlight layout issues (sidebar overlap, navbar broken), the problem is NOT solved by:**

❌ **Ineffective approaches that waste time:**
- Adding wrapper `<div>` elements with width constraints in Astro components
- Adding `overflow: hidden`, `max-width: 100%`, or `box-sizing: border-box` styles to wrappers
- Modifying inline styles in React components (position, width, z-index)
- Adding `position: relative`, `display: flow-root`, or containment strategies to Astro wrappers
- Removing `:global()` CSS from Astro `<style>` blocks
- Moving styles from Astro to inline React styles
- Adding child selector rules like `.wrapper > * { max-width: 100%; }`

**These approaches all assume the problem is CSS containment, but they don't address the actual root cause.**

### The Real Problem Pattern

When a Starlight MDX page shows:
1. **Sidebar overlapping main content**
2. **Navbar rendering incorrectly**
3. **Sidebar indentation broken**
4. **Issue isolated to ONE specific page** (other pages work fine)

This indicates a **hydration/integration issue**, not a CSS layout problem.

### Actual Root Causes to Investigate

**Before attempting any CSS fixes, systematically check:**

1. **Direct React Component Imports in MDX**
   ```mdx
   // ❌ WRONG: Direct React import in MDX
   import {MultiViewportPreview} from '../../../components/interactive/responsive-preview'

   // ✅ CORRECT: Import Astro wrapper
   import MultiViewportPreview from '../../../components/interactive/MultiViewportPreview.astro'
   ```

2. **Duplicate Hydration Directives**
   ```mdx
   // ❌ WRONG: Redundant client:load in MDX when Astro wrapper handles it
   <MultiViewportPreview client:load viewports={['mobile', 'tablet']}>

   // ✅ CORRECT: Let Astro wrapper handle hydration
   <MultiViewportPreview viewports={['mobile', 'tablet']}>
   ```

3. **Missing Astro Wrappers**
   - Every React component used in MDX should have a corresponding `.astro` wrapper
   - The wrapper handles hydration strategy (`client:load`, `client:idle`, etc.)
   - Compare working pages to broken pages - what pattern do working pages follow?

4. **Starlight-Specific Layout Requirements**
   - Starlight may have specific requirements for how components integrate
   - Check if working examples wrap components differently
   - Look for Starlight-specific CSS classes or data attributes

### Diagnostic Workflow

**When facing Starlight layout issues:**

1. **Compare Working vs Broken Pages FIRST**
   - Find a working MDX page with similar complexity
   - Compare import statements line-by-line
   - Identify pattern differences (Astro wrapper vs direct React import)
   - Check for differences in component usage

2. **Check Astro Wrapper Existence**
   - Verify `.astro` wrapper exists for the React component
   - Confirm wrapper uses proper hydration directive
   - Ensure wrapper exports match React component props

3. **Verify Import Patterns**
   - MDX should import `.astro` files, not `.tsx` files
   - Check if `client:*` directive is in Astro wrapper, not MDX usage
   - Confirm import paths are correct

4. **Test Hydration Strategy**
   - Try different hydration strategies: `client:load`, `client:idle`, `client:visible`
   - Some components may need specific hydration timing
   - Check browser console for hydration mismatch errors

5. **Only After Ruling Out Integration Issues: Try CSS**
   - If all integration checks pass, THEN try CSS containment
   - But integration issues are the most common cause

### Pattern: Astro Wrapper for Starlight React Components

**Standard pattern for integrating React components in Starlight MDX:**

```astro
---
// ComponentWrapper.astro
import {ReactComponent} from './react-component'

export interface Props {
  // Mirror React component props
}

const props = Astro.props
---

<div class="component-wrapper">
  <ReactComponent client:load {...props}>
    <slot />
  </ReactComponent>
</div>

<style>
  .component-wrapper {
    /* Minimal containment only if needed */
    width: 100%;
    max-width: 100%;
  }
</style>
```

```mdx
---
# page.mdx
import ComponentWrapper from '../../../components/ComponentWrapper.astro'
---

<ComponentWrapper prop="value">
  Content here
</ComponentWrapper>
```

### Time-Saving Principle

**Before spending time on CSS debugging:**
- ✅ 5 minutes: Compare working vs broken page imports
- ✅ 5 minutes: Verify Astro wrapper exists and is used correctly
- ✅ 5 minutes: Check hydration directives
- ❌ 30+ minutes: Trying various CSS containment strategies that don't address root cause

**If multiple CSS fixes fail, STOP and revisit integration patterns.**

## Starlight CSS Custom Properties

Starlight provides CSS custom properties for consistent theming. React components should use these for proper integration:

```tsx
// ✅ CORRECT: Use Starlight CSS custom properties
const style: React.CSSProperties = {
  background: 'var(--sl-color-gray-1)',
  border: '1px solid var(--sl-color-gray-3)',
  color: 'var(--sl-color-text)',
}
```

Common Starlight CSS variables:
- `--sl-color-gray-1` through `--sl-color-gray-6` (backgrounds, borders)
- `--sl-color-text` (primary text color)
- `--sl-color-text-accent` (accent text)
- `--sl-color-blue` (brand color)
- `--sl-color-white` (white)

## Debugging Checklist for Starlight Layout Issues

When encountering layout problems:

- [ ] Compare working page imports to broken page imports
- [ ] Verify React component has corresponding `.astro` wrapper
- [ ] Confirm MDX imports `.astro` file, not `.tsx` file
- [ ] Check that `client:*` directive is in `.astro` wrapper, not MDX
- [ ] Test different hydration strategies (`client:load`, `client:idle`)
- [ ] Check browser console for hydration errors
- [ ] Verify CSS custom properties are used correctly
- [ ] Only after all above: Try CSS containment strategies

## Lesson Learned: Avoid Premature CSS Solutions

**What happened:** Multiple attempts to fix Starlight layout issues through CSS modifications (wrapper divs, overflow properties, positioning, containment strategies) all failed because the actual problem was import/hydration-related.

**Why it matters:** CSS debugging is time-intensive and creates unnecessary complexity when the root cause is an integration pattern issue. Starlight has specific expectations for how React components are integrated in MDX pages.

**Correct approach:** Always investigate integration patterns (imports, wrappers, hydration) BEFORE attempting CSS fixes. Compare working pages to broken pages to identify pattern mismatches.
