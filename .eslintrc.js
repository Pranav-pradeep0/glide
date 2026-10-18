module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    '@typescript-eslint/no-unused-vars': 'warn',
    'react-hooks/exhaustive-deps': 'warn',
  },
  // PC-side dev scripts run under Node, not the app's JS engine.
  overrides: [{ files: ['scripts/**/*.js'], env: { node: true, es2020: true } }],
};
