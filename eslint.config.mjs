import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  // TypeScript source files
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.spec.json'],

        tsconfigRootDir: __dirname,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      // Base recommended rule sets
      ...tsPlugin.configs.recommended.rules,
      ...prettierPlugin.configs.recommended.rules,

      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'classProperty',
          modifiers: ['readonly', 'private', 'static'],
          format: ['strictCamelCase', 'UPPER_CASE'],
          leadingUnderscore: 'require',
        },
        {
          selector: 'classProperty',
          modifiers: ['readonly', 'protected', 'static'],
          format: ['strictCamelCase', 'UPPER_CASE'],
          leadingUnderscore: 'require',
        },
        {
          selector: 'classProperty',
          modifiers: ['readonly', 'private'],
          format: ['strictCamelCase'],
          leadingUnderscore: 'require',
        },
        {
          selector: 'classProperty',
          modifiers: ['readonly', 'protected'],
          format: ['strictCamelCase'],
          leadingUnderscore: 'require',
        },
        {
          selector: 'parameterProperty',
          modifiers: ['readonly', 'private'],
          format: ['strictCamelCase'],
          leadingUnderscore: 'require',
        },
        {
          selector: 'parameterProperty',
          modifiers: ['readonly', 'protected'],
          format: ['strictCamelCase'],
          leadingUnderscore: 'require',
        },
      ],

      // Project-specific overrides
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
