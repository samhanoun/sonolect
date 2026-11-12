const { withAndroidStyles } = require("expo/config-plugins");

/**
 * Gives the native Android theme the app's dark look (android-7). With
 * userInterfaceStyle "dark", expo-system-ui forces night mode, so a DayNight
 * parent draws dark dialogs (the delete and clear confirmations). Lime
 * accents replace AppCompat teal on dialog buttons, cursors and selection
 * handles, and native text is light by default.
 */
const APP_THEME = "AppTheme";
const APP_THEME_PARENT = "Theme.AppCompat.DayNight.NoActionBar";

/** Items set on AppTheme; an existing value is replaced. */
const THEME_ITEMS = [
  ["colorAccent", "#DDF39A"],
  ["colorControlActivated", "#DDF39A"],
  ["android:textColor", "#EEF2EA"],
];

/** AppTheme with the DayNight parent and the THEME_ITEMS values. */
function darkAppTheme(style) {
  const values = new Map(THEME_ITEMS);
  const items = (style.item ?? []).map((item) => {
    const name = item.$?.name;
    return values.has(name) ? { $: { name }, _: values.get(name) } : item;
  });
  const present = new Set(items.map((item) => item.$?.name));
  for (const [name, value] of THEME_ITEMS) {
    if (!present.has(name)) items.push({ $: { name }, _: value });
  }
  return { ...style, $: { ...style.$, parent: APP_THEME_PARENT }, item: items };
}

/**
 * The styles.xml JSON (as withAndroidStyles reads it) with a dark AppTheme:
 * its parent set to Theme.AppCompat.DayNight.NoActionBar and the THEME_ITEMS
 * set, replacing existing values. Other styles are left alone. Pure, and
 * running it again changes nothing.
 */
function applyDarkTheme(stylesJson) {
  const resources = stylesJson.resources ?? {};
  const styles = resources.style ?? [];
  const hasAppTheme = styles.some((style) => style.$?.name === APP_THEME);
  const style = hasAppTheme
    ? styles.map((entry) =>
        entry.$?.name === APP_THEME ? darkAppTheme(entry) : entry,
      )
    : [...styles, darkAppTheme({ $: { name: APP_THEME }, item: [] })];
  return { ...stylesJson, resources: { ...resources, style } };
}

function withDarkAndroidTheme(config) {
  return withAndroidStyles(config, (modConfig) => {
    modConfig.modResults = applyDarkTheme(modConfig.modResults);
    return modConfig;
  });
}

module.exports = withDarkAndroidTheme;
module.exports.applyDarkTheme = applyDarkTheme;
module.exports.APP_THEME_PARENT = APP_THEME_PARENT;
module.exports.THEME_ITEMS = THEME_ITEMS;
