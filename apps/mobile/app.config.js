// The static config is app.json; this adds what comes from the environment
// (config/release.cjs, docs/mobile-release.md).
const { resolveReleaseConfig } = require("./config/release.cjs");

module.exports = ({ config }) => resolveReleaseConfig(config, process.env);
