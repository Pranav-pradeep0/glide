module.exports = {
  preset: '@react-native/jest-preset',
  // The default RN preset only transforms react-native* scoped packages. Several
  // deps here ship untranspiled ESM (react-native-mmkv, nitro-modules), which makes
  // any test importing them fail to parse.
  transformIgnorePatterns: [
    'node_modules/(?!(?:jest-)?react-native|@react-native(-community)?|react-native-|@react-navigation/|@shopify/|@dr.pogodin/)',
  ],
};
