import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_|^next$|^req$|^res$' }],
      // Secrecy rule 4: use core/logger.js and never log request bodies.
      'no-console': ['warn', { allow: ['error'] }],
    },
  },
  {
    files: ['scripts/**', 'seeds/**', 'tests/**', 'src/core/logger.js', 'src/modules/notify/index.js'],
    rules: { 'no-console': 'off' },
  },
];
