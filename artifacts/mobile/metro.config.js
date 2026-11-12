const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const repoRoot = path.resolve(__dirname, "../..");

config.watchFolders = [repoRoot];
config.resolver.unstable_enableSymlinks = true;
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.join(repoRoot, "node_modules")
];

// Release entry-file resolution (2026-11-10).
// The Android Gradle task passes a project-relative entry
// (`../../node_modules/expo-router/entry.js`) to `expo export:embed`, and Metro
// resolves that path against its *server root*. Expo SDK 54 sets the server
// root to the detected monorepo root, so the relative path pointed outside the
// repository ("Unable to resolve module ./../../node_modules/expo-router/entry.js").
// Pinning the server root to this app reproduces the configuration of the
// known-good 1.0.8 AAB build (bundle-debug-metro-fixed.log). It is equivalent
// to Expo's documented EXPO_NO_METRO_WORKSPACE_ROOT=1. watchFolders and
// nodeModulesPaths above still let Metro read hoisted packages from the root.
config.server = { ...config.server, unstable_serverRoot: __dirname };

module.exports = config;
