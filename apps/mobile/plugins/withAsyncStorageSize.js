const { withGradleProperties } = require("expo/config-plugins");

/**
 * Raises the cap of Android's AsyncStorage database from its 6 MB default
 * to 64 MB (data-1). AsyncStorage 2.2.0 reads the root Gradle property
 * AsyncStorage_db_size_in_MB (android/config.gradle, getDatabaseSize). The
 * cap is on the whole database; the ~2 MB limit on one value is handled by
 * storing one key per note.
 */
const DB_SIZE_PROPERTY = "AsyncStorage_db_size_in_MB";
const DB_SIZE_MB = "64";

/**
 * The gradle.properties items with `key` set to `value`: every entry of the
 * key gets the value, or one entry is appended. Pure, and running it again
 * changes nothing.
 */
function setGradleProperty(properties, key, value) {
  let found = false;
  const next = properties.map((item) => {
    if (item.type !== "property" || item.key !== key) return item;
    found = true;
    return { ...item, value };
  });
  return found ? next : [...next, { type: "property", key, value }];
}

function withAsyncStorageSize(config) {
  return withGradleProperties(config, (modConfig) => {
    modConfig.modResults = setGradleProperty(
      modConfig.modResults,
      DB_SIZE_PROPERTY,
      DB_SIZE_MB,
    );
    return modConfig;
  });
}

module.exports = withAsyncStorageSize;
module.exports.setGradleProperty = setGradleProperty;
module.exports.DB_SIZE_PROPERTY = DB_SIZE_PROPERTY;
module.exports.DB_SIZE_MB = DB_SIZE_MB;
