import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

// ESLint finds mistakes in the code that the compiler accepts, for example a promise that the code forgets to await.
// This is a "flat config": an array of objects. ESLint applies each object in order, and a later object can
// add or change rules for the files in its `files` list. `defineConfig` only adds type checks for this file.
export default defineConfig(
  globalIgnores(['**/node_modules/', '**/dist/', '**/coverage/']),
  // The recommended JavaScript rules, then the strict TypeScript rules that use type information.
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    // `projectService` lets ESLint use the TypeScript projects (the tsconfig files), so the rules know the type
    // of each value. `import.meta.dirname` is the folder of this file.
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // JavaScript config files are not in a TypeScript project.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // The rules of hooks for React components: call hooks in the same order, and list all effect dependencies.
    // The React Refresh rule (from the Vite template) makes sure that a component file exports only components,
    // so the development server can update a component without a full reload of the page.
    files: ['web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
  },
  {
    // The core layer must not know about HTTP, Yahoo or other infrastructure.
    files: ['api/src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infrastructure/**', '**/http/**', 'fastify', '@fastify/*'],
              message: 'The core layer must not import infrastructure or HTTP code.',
            },
          ],
        },
      ],
    },
  },
  {
    // The infrastructure layer must not know about HTTP.
    files: ['api/src/infrastructure/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/http/**', 'fastify', '@fastify/*'],
              message: 'The infrastructure layer must not import HTTP code.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
