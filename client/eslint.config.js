import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          allowExportNames: ['routerFuture', 'useAuth', 'homeFor', 'hasRole', 'useErrorText', 'useCountdown'],
        },
      ],
      // Secrecy rule 6: ballot selections never go to web storage.
      'no-restricted-properties': [
        'error',
        { object: 'sessionStorage', message: 'Do not store app state in sessionStorage.' },
      ],
    },
  },
  {
    files: ['**/*.test.{js,jsx}', 'src/test/**', '*.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
];
