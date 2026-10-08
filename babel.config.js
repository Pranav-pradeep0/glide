module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./'],  // Base directory for resolution (matches baseUrl: ".")
        alias: {
          '@': './src',  // Maps "@/*" to "src/*"
        },
        extensions: ['.android.js', '.js', '.ts', '.tsx', '.json'],  // Support common extensions
      },
    ],
    'react-native-worklets/plugin',
  ],
  env: {
    production: {
      plugins: [['transform-remove-console', { exclude: ['error', 'warn'] }]],
    },
  },
};
