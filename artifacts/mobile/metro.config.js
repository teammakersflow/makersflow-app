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

module.exports = config;
