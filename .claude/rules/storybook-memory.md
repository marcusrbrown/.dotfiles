---
description: Memory for Storybook patterns, component documentation practices, and mocking strategies that ensure stories render without errors.
paths: '**/*.stories.js,**/*.stories.jsx,**/*.stories.ts,**/*.stories.tsx,**/.storybook/**'
---

# Storybook Memory

Proven patterns for reliable Storybook stories, comprehensive component documentation, and effective mocking strategies that ensure stories render without errors.

## Use Real Components in Stories

**CRITICAL RULE: Always use the actual, imported component in stories - never mock the component itself.**

When creating stories, import and use the real component implementation:

```tsx
// ✅ CORRECT: Import and use the real component
import {WalletConnectionModal} from './wallet-connection-modal'

const meta: Meta<typeof WalletConnectionModal> = {
  component: WalletConnectionModal, // Real component
  // ...
}

export const Default: Story = {} // Uses real component with mock providers
```

```tsx
// ❌ WRONG: Don't mock the component itself
const MockWalletConnectionModal = () => <div>Mock Component</div>

const meta: Meta<typeof MockWalletConnectionModal> = {
  component: MockWalletConnectionModal, // Mock component defeats the purpose
  // ...
}
```

**Rationale:**
- Stories are for documenting and testing the actual component behavior
- Mock components don't reveal real integration issues or prop handling
- Real components catch TypeScript errors and prop validation issues
- Component behavior changes require updating mock components manually
- Storybook's primary value is showing actual component appearance and interaction

**When external dependencies are needed:** Mock the dependencies (providers, hooks, services) while keeping the component real.

## External Dependencies Mocking with Decorators

When creating stories for components that depend on external data sources, APIs, or context providers (Web3 hooks, authentication, data fetching, etc.), use Storybook decorators to provide the necessary context:

```tsx
import type {Decorator, Meta, StoryObj} from '@storybook/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {AuthProvider} from '@/lib/auth/provider'
import {ThemeProvider} from '@/lib/theme/provider'

// Create test QueryClient with retry disabled for faster feedback
const testQueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

// Mock auth state for components requiring authentication
const mockAuthState = {
  user: { id: '1', name: 'Test User', email: 'test@example.com' },
  isAuthenticated: true,
  loading: false,
}

// Provider decorator using actual providers with mock data
const withProviders: Decorator = story => (
  <QueryClientProvider client={testQueryClient}>
    <AuthProvider initialState={mockAuthState}>
      <ThemeProvider defaultTheme="light">
        {story()}
      </ThemeProvider>
    </AuthProvider>
  </QueryClientProvider>
)

// For Web3 components specifically:
const withWeb3Provider: Decorator = story => (
  <WagmiProvider config={wagmiAdapter.wagmiConfig}>
    <QueryClientProvider client={testQueryClient}>
      {story()}
    </QueryClientProvider>
  </WagmiProvider>
)

const meta: Meta<typeof Component> = {
  component: Component,
  decorators: [withProviders], // Apply to all stories
  // ... rest of meta
}
```

**Key principles:**
- Use actual providers with mock data instead of mocking individual hooks when possible - more reliable and matches production behavior
- Disable retries in test QueryClient for faster story loading and feedback
- Provide realistic mock data that represents typical use cases
- Apply decorator at meta level to cover all stories for the component
- Follow strict import ordering to satisfy ESLint rules

## Provider-Specific Patterns

**Authentication/User Context:**
```tsx
const mockAuthStates = {
  authenticated: { user: {...}, isAuthenticated: true },
  loading: { user: null, isAuthenticated: false, loading: true },
  unauthenticated: { user: null, isAuthenticated: false },
}

// Apply different auth states per story
export const AuthenticatedUser: Story = {
  decorators: [story => <AuthProvider initialState={mockAuthStates.authenticated}>{story()}</AuthProvider>],
}
```

**Data Fetching Context:**
```tsx
const mockApiData = {
  users: [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }],
  loading: false,
  error: null,
}

const withApiProvider: Decorator = story => (
  <ApiProvider mockData={mockApiData}>
    {story()}
  </ApiProvider>
)
```

**External Service Integration:**
```tsx
// For components depending on external services (maps, payment, etc.)
const withExternalServices: Decorator = story => (
  <ServiceProvider
    config={{
      apiKey: 'mock-key',
      environment: 'test',
      enableMocking: true
    }}
  >
    {story()}
  </ServiceProvider>
)
```

## Story Structure for Complex Components

Create comprehensive story variants that demonstrate different component states:

```tsx
// Full-featured default state
export const Default: Story = {
  args: {
    open: true,
    showAllFeatures: true,
  },
}

// Minimal variant focusing on core functionality
export const Minimal: Story = {
  args: {
    open: true,
    showOptionalFeatures: false,
  },
}

// Feature-specific variants for documentation
export const SpecificFeature: Story = {
  args: {
    open: true,
    focusFeature: true,
  },
}

// Closed/hidden state for testing visibility
export const Closed: Story = {
  args: {
    open: false,
  },
}
```

## Context Provider Debugging

When stories fail with "hook must be used within provider" or similar external dependency errors:
1. **Check decorator placement** - Apply at meta level, not individual story level
2. **Verify provider hierarchy** - Match the same provider structure used in your app
3. **Use actual providers with mock data** - Real providers are more reliable than complex mock setups
4. **Test in isolation** - Create minimal reproduction with just the failing component
5. **Validate mock data** - Ensure mock data structure matches what the real provider would supply

**Common external dependency errors:**
- Authentication hooks failing: Missing AuthProvider or UserProvider decorator
- Data fetching hooks failing: Missing QueryClient or API provider context
- Theme/styling hooks failing: Missing ThemeProvider or styled-components provider
- Routing hooks failing: Missing Router provider (use memory router for stories)
- External service hooks failing: Missing service provider or API key configuration

## Build and Validation Process

Always validate Storybook integration after implementing stories:
1. **Build test**: `pnpm build-storybook` - ensures no compilation errors
2. **Development server**: `pnpm storybook` - verify stories render correctly
3. **Runtime verification**: Open stories in browser to check for JavaScript errors and proper rendering
4. **Component tests**: Ensure existing test suite still passes with new dependencies
5. **ESLint compliance**: Fix import ordering and naming convention issues

**Critical validation steps:**
- **Build errors**: TypeScript compilation, missing dependencies, configuration issues
- **Runtime errors**: Provider setup, hook dependencies, environment variable validation
- **Rendering issues**: Component display, styling problems, interaction failures
- **Console errors**: JavaScript runtime errors, warning messages, network failures

**Storybook error patterns:**
- "Invalid environment variables": Missing or incorrect environment setup in stories
- "Hook must be used within provider": Missing provider decorators
- "createAppKit before useAppKit": Web3 provider initialization order issues
- Blank/broken component display: Provider context not properly established
- Network errors: Mock data not provided for API-dependent components

**Common ESLint fixes for stories:**
- Import ordering: Type imports first, then external libs, then internal modules
- Naming: Use camelCase for parameters (story => story, not Story => Story)
- Usage: Apply decorators to avoid "assigned but never used" errors
