/**
 * expo's own react-native.config.js requires expo-modules-autolinking, which
 * pnpm's isolated node_modules hides from it, so its config silently loads as
 * null and Android autolinking guesses the wrong class (expo.core.*).
 * Declare expo's entry here so the generated PackageList is correct.
 */
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        ios: {},
        android: {
          packageImportPath: "import expo.modules.ExpoModulesPackage;",
        },
      },
    },
  },
};
