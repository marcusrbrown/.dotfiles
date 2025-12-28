---
description: Memory for TypeScript coding patterns, type safety practices, and testing approaches that enhance code quality and maintainability.
paths: '**/*.ts,**/*.tsx,**/tsconfig.json,**/package.json'
---

# TypeScript Memory

Proven patterns for type-safe, maintainable TypeScript code with modern testing practices.

## Function-Based Architecture

Prefer function declarations over ES6 classes for better composability and testability:

```typescript
// Preferred: Function-based approach
export async function validateConfig(config: unknown): Promise<ConfigResult> {
  // Implementation
}

// Avoid: ES6 class syntax
class ConfigValidator {
  async validate(config: unknown): Promise<ConfigResult> {
    // Implementation
  }
}
```

Functions are easier to test, mock, and compose than class-based approaches.

## Type Safety Best Practices

Always use explicit return types and avoid `any`:

```typescript
// Preferred: Explicit return types and unknown for uncertain types
export function parseUserInput(input: unknown): ParsedInput | null {
  if (typeof input !== 'string') {
    return null;
  }
  // Type narrowing logic
}

// Avoid: Implicit returns and any type
export function parseUserInput(input: any) {
  // Implementation
}
```

Use built-in utility types for precise type manipulation:

```typescript
// Leverage Pick, Omit, Partial, Required for type transformations
type UserUpdate = Partial<Pick<User, 'name' | 'email'>>;
type PublicUser = Omit<User, 'password' | 'apiKey'>;
```

## Strict Boolean Expressions

Follow `@typescript-eslint/strict-boolean-expressions` rule for explicit, type-safe boolean checks:

```typescript
// Preferred: Explicit null/undefined checks for nullable values
let num: number | undefined = 0;
if (num != null) {
  console.log('num is defined');
}

let str: string | null = null;
if (str != null && str.trim().length > 0) {
  console.log('str is non-empty');
}

// Preferred: Explicit boolean conversion for any types
const foo = (arg: any) => (Boolean(arg) ? 1 : 0);

// Preferred: Use nullish coalescing for optional booleans
function foo(bool?: boolean) {
  if (bool ?? false) {
    bar();
  }
}

// Preferred: Explicit type and emptiness checks
if (typeof value !== 'string' || value.trim().length === 0) {
  // value is not a non-empty string
}

// Avoid: Ambiguous falsy checks that hide type safety issues
if (!value) { /* unclear what this checks */ }
if (num) { /* unsafe for number | undefined */ }
if (str) { /* unsafe for string | null */ }
if (bool) { /* unsafe for boolean | undefined */ }
```

This rule prevents subtle bugs by requiring explicit checks for nullable values and type conversions.

## Const Assertions for Fixed Values

Use `as const` for immutable data structures and fixed configurations:

```typescript
// Preferred: Const assertions for type safety
const SUPPORTED_FORMATS = ['json', 'yaml', 'toml'] as const;
type SupportedFormat = typeof SUPPORTED_FORMATS[number];

const CONFIG_DEFAULTS = {
  timeout: 5000,
  retries: 3,
  verbose: false,
} as const;
```

## Meaningful Error Handling

Provide context-specific error messages that help with debugging:

```typescript
// Preferred: Descriptive error messages with context
export function validateAppId(appId: unknown): string {
  if (typeof appId !== 'string') {
    throw new TypeError(`GitHub App ID must be a string, received ${typeof appId}`);
  }

  if (!/^\d+$/.test(appId)) {
    throw new Error(`GitHub App ID must contain only digits, received: ${appId}`);
  }

  return appId;
}

// Avoid: Generic error messages
export function validateAppId(appId: unknown): string {
  if (typeof appId !== 'string' || !/^\d+$/.test(appId)) {
    throw new Error('Invalid input');
  }
  return appId;
}
```

## JSDoc Documentation Standards

Document public APIs with JSDoc, focusing on "why" rather than "what":

```typescript
/**
 * Merges user configuration with base defaults while preserving security boundaries.
 *
 * Security-critical fields like allowedCommands are never overridden to prevent
 * privilege escalation in CI environments.
 *
 * @param userConfig - Configuration provided by workflow author
 * @param baseConfig - Organizational defaults with security boundaries
 * @returns Merged configuration with security constraints enforced
 * @throws {Error} When user config contains prohibited overrides
 */
export function mergeConfig(
  userConfig: unknown,
  baseConfig: BaseConfig
): MergedConfig {
  // Implementation
}
```

## Vitest Testing Patterns

Leverage Vitest's built-in TypeScript support for type-safe testing:

```typescript
// Test structure: src/__tests__/*.test.ts
import {describe, it, expect} from 'vitest';
import {validateConfig} from '../config.js';

describe('validateConfig', () => {
  it('should reject invalid configuration types', async () => {
    // Use expect().rejects.toThrow() for async error validation
    await expect(validateConfig('invalid')).rejects.toThrow(
      'Configuration must be an object'
    );
  });

  it('should accept valid configuration', async () => {
    const config = {platform: 'github'} as const;
    const result = await validateConfig(config);

    // TypeScript ensures type safety in assertions
    expect(result.platform).toBe('github');
  });
});
```

## Type Guards for Runtime Safety

Implement proper type checking before operations:

```typescript
function isValidConfig(value: unknown): value is Config {
  return (
    typeof value === 'object' &&
    value !== null &&
    'platform' in value &&
    typeof (value as any).platform === 'string'
  );
}

export function processConfig(input: unknown): ProcessedConfig {
  if (!isValidConfig(input)) {
    throw new TypeError('Invalid configuration structure');
  }

  // Now TypeScript knows input is Config type
  return {
    platform: input.platform,
    // ... other processing
  };
}
```
