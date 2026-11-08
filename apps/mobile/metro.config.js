// pnpm monorepo: the desktop app pulls React 19, and packages without a React
// peer link can fall back to the hoisted copy. Force every import of these
// singletons to resolve from this app so the bundle has exactly one React.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const SINGLETONS = new Set([
  "react",
  "react-dom",
  "react-native",
  "react-native-web",
]);
const appEntry = path.join(__dirname, "package.json");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const pkg = moduleName.startsWith("@")
    ? moduleName.split("/").slice(0, 2).join("/")
    : moduleName.split("/")[0];
  if (SINGLETONS.has(pkg)) {
    return context.resolveRequest(
      { ...context, originModulePath: appEntry },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
