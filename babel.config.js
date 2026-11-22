module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Must run first. Worklets stays last.
    [
      'babel-plugin-react-compiler',
      {
        target: '19',
        // Phase 1 skips the player; delete `sources` in phase 2. Both slash kinds (Windows).
        sources: f =>
          !/[\\/](hooks[\\/]video-player|components[\\/]VideoPlayer)[\\/]|VideoPlayerScreen/.test(f),
      },
    ],
    [
      'module-resolver',
      {
        root: ['./'],
        alias: {'@': './src'},
        extensions: ['.ts', '.tsx', '.js'],
      },
    ],
    'react-native-worklets/plugin',
  ],
  env: {
    production: {
      plugins: [['transform-remove-console', {exclude: ['error', 'warn']}]],
    },
  },
};
