module.exports = {
  env: {
    es6: true,
    node: true,
  },
  extends: ['airbnb-base', 'prettier'],
  plugins: ['prettier'],
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly',
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    'prettier/prettier': 'error',
    'class-methods-use-this': 'off',
    'no-param-reassign': 'off',
    camelcase: 'off',
    'no-unused-vars': ['error', { argsIgnorePattern: 'next' }],
    quotes: ['error', 'single'],
    'no-console': 'off',
    'no-plusplus': 'off',
    'no-bitwise': 'off',
    'no-restricted-syntax': 'off',
    'no-await-in-loop': 'off',
    'import/no-cycle': 'off',
    'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
    'import/extensions': ['error', 'ignorePackages', { js: 'always' }],
  },
};
