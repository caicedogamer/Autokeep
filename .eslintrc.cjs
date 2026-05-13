/* eslint-env node */
/**
 * ESLint config for AutoKeep.
 *
 * The two project-specific rules below enforce non-negotiable constitution
 * principles:
 *  - Principle III (Persistencia Local Primero): direct localStorage /
 *    sessionStorage access is banned outside `src/core/storage/**`. Every
 *    module routes through `StorageAdapter`.
 *  - Principle II (Separación Lógica/Presentación): DOM globals (`document`,
 *    `window`) are banned inside any `domain/` or `services/` folder under
 *    `src/modules/**`. UI work belongs in `ui/` only.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'import', 'promise', 'unicorn'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
    'plugin:@typescript-eslint/strict-type-checked',
    'plugin:promise/recommended',
  ],
  env: {
    browser: true,
    es2022: true,
  },
  rules: {
    // Enforce Principle VI: explicit error handling
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/only-throw-error': 'error',
    '@typescript-eslint/switch-exhaustiveness-check': 'error',

    // Style baselines
    'unicorn/filename-case': ['error', { case: 'kebabCase' }],

    // Rules from the strict-type-checked preset that produce too many
    // false positives in cross-environment code (defensive
    // `globalThis.location?.x` checks, async methods that satisfy an
    // interface contract with a sync body, generics that document the
    // call-site shape, etc.). Each is downgraded with a justification.
    'no-restricted-syntax': 'off',
    // Defensive null-checks against globals (location/addEventListener)
    // that the DOM lib types declare as always-defined but that are
    // genuinely missing in pure-Node test contexts.
    '@typescript-eslint/no-unnecessary-condition': 'off',
    // StorageAdapter / WorkspaceService use methods that MUST be async
    // (interface contract) even when the body is synchronous.
    '@typescript-eslint/require-await': 'off',
    // `readPayload<T>(...)` documents the caller's expected shape even
    // though `T` only appears in the return type.
    '@typescript-eslint/no-unnecessary-type-parameters': 'off',
    // BufferSource casts and other cross-DOM-version assertions are
    // intentional — they document a known TS narrowing.
    '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    // DOMException.code is deprecated for consumers but still the
    // canonical signal for QuotaExceededError detection across browsers.
    '@typescript-eslint/no-deprecated': 'off',
    // `arrow shorthand returning void` is fine in test helpers.
    '@typescript-eslint/no-confusing-void-expression': 'off',

    // The import plugin's resolver is not configured (it would require an
    // additional TS resolver package). Keep ordering rules; turn off the
    // unresolved check that needs the resolver.
    'import/no-unresolved': 'off',
    'import/order': [
      'error',
      {
        groups: [
          ['builtin', 'external'],
          'internal',
          ['parent', 'sibling', 'index'],
        ],
        'newlines-between': 'always',
      },
    ],
  },
  overrides: [
    /*
     * Constitution Principle III — direct browser-storage access is banned
     * outside the storage adapter folder.
     */
    {
      files: ['src/**/*.ts'],
      excludedFiles: ['src/core/storage/**', 'src/**/__tests__/**'],
      rules: {
        'no-restricted-globals': [
          'error',
          {
            name: 'localStorage',
            message:
              'Direct localStorage access is banned outside src/core/storage/**. Use StorageAdapter (Constitution Principle III).',
          },
          {
            name: 'sessionStorage',
            message:
              'Direct sessionStorage access is banned. Use StorageAdapter (Constitution Principle III).',
          },
        ],
      },
    },

    /*
     * Constitution Principle II — business logic must not import the DOM.
     * Any file under modules/<m>/{domain,services}/ that touches `document`,
     * `window`, or DOM types is a layer violation.
     */
    {
      files: [
        'src/modules/*/domain/**/*.ts',
        'src/modules/*/services/**/*.ts',
        'src/core/**/*.ts',
      ],
      excludedFiles: [
        'src/**/__tests__/**',
        'src/core/router/**',
        'src/core/storage/local-storage-adapter.ts',
        'src/core/storage/encrypted-store.ts',
        'src/core/crypto/**',
        'src/core/workers/**',
      ],
      rules: {
        'no-restricted-globals': [
          'error',
          {
            name: 'document',
            message:
              'Business logic must not touch the DOM. Move this to src/modules/<m>/ui/ (Constitution Principle II).',
          },
          {
            name: 'window',
            message:
              'Business logic must not touch the DOM. Move this to src/modules/<m>/ui/ (Constitution Principle II).',
          },
        ],
      },
    },

    /*
     * Test files: relax some strict rules that get noisy in test setup.
     */
    {
      files: ['src/**/__tests__/**/*.ts', 'tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },

    /*
     * Node/tool files (vite.config, vitest.config, playwright.config, scripts,
     * e2e) are excluded from the browser tsconfig — point ESLint at the node
     * tsconfig so type-aware rules still work for them. Relax rules that are
     * noisy in config/e2e/script contexts (unsafe-any from dynamic imports,
     * non-null assertions in test assertions, numbers in template literals).
     */
    {
      files: [
        'vite.config.ts',
        'vitest.config.ts',
        'playwright.config.ts',
        'scripts/**/*.ts',
        'e2e/**/*.ts',
      ],
      parserOptions: {
        project: './tsconfig.node.json',
        tsconfigRootDir: __dirname,
      },
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      },
    },
  ],
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    'coverage',
    'playwright-report',
    'test-results',
    '*.cjs',
  ],
};
