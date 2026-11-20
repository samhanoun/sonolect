const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const withDarkAndroidTheme = require("./withDarkAndroidTheme");

const { applyDarkTheme, APP_THEME_PARENT } = withDarkAndroidTheme;

const item = (name, value) => ({ $: { name }, _: value });

const SPLASH = {
  $: { name: "Theme.App.SplashScreen", parent: "Theme.SplashScreen" },
  item: [
    item("windowSplashScreenBackground", "@color/splashscreen_background"),
    item("postSplashScreenTheme", "@style/AppTheme"),
  ],
};

/** What expo prebuild generates for SDK 58, before this plugin. */
const BASE = {
  resources: {
    $: { "xmlns:tools": "http://schemas.android.com/tools" },
    style: [
      {
        $: { name: "AppTheme", parent: "Theme.AppCompat.DayNight.NoActionBar" },
        item: [
          item("android:editTextBackground", "@drawable/rn_edit_text_material"),
          item("colorPrimary", "@color/colorPrimary"),
          item("android:windowBackground", "@color/activityBackground"),
        ],
      },
      SPLASH,
    ],
  },
};

const DARK_ITEMS = [
  item("colorAccent", "#DDF39A"),
  item("colorControlActivated", "#DDF39A"),
  item("android:textColor", "#EEF2EA"),
];

const appTheme = (json) =>
  json.resources.style.find((style) => style.$.name === "AppTheme");

describe("applyDarkTheme", () => {
  it("adds colorAccent, colorControlActivated and android:textColor", () => {
    const result = applyDarkTheme(BASE);
    assert.deepEqual(appTheme(result).item, [
      ...appTheme(BASE).item,
      ...DARK_ITEMS,
    ]);
  });

  it("replaces existing values in place", () => {
    const light = structuredClone(BASE);
    appTheme(light).item.unshift(
      item("android:textColor", "@android:color/black"),
      item("colorAccent", "#03DAC5"),
    );
    const result = applyDarkTheme(light);
    assert.deepEqual(appTheme(result).item, [
      item("android:textColor", "#EEF2EA"),
      item("colorAccent", "#DDF39A"),
      ...appTheme(BASE).item,
      item("colorControlActivated", "#DDF39A"),
    ]);
  });

  it("sets the DayNight parent on a light AppTheme", () => {
    const light = structuredClone(BASE);
    appTheme(light).$.parent = "Theme.AppCompat.Light.NoActionBar";
    const result = applyDarkTheme(light);
    assert.equal(APP_THEME_PARENT, "Theme.AppCompat.DayNight.NoActionBar");
    assert.deepEqual(appTheme(result).$, {
      name: "AppTheme",
      parent: "Theme.AppCompat.DayNight.NoActionBar",
    });
  });

  it("is idempotent and leaves its input alone", () => {
    const before = structuredClone(BASE);
    const once = applyDarkTheme(BASE);
    assert.deepEqual(applyDarkTheme(once), once);
    assert.deepEqual(BASE, before);
  });

  it("leaves other styles and the resources attributes alone", () => {
    const result = applyDarkTheme(BASE);
    assert.deepEqual(result.resources.style[1], SPLASH);
    assert.equal(result.resources.style.length, 2);
    assert.deepEqual(result.resources.$, BASE.resources.$);
  });

  it("creates AppTheme when styles.xml has none", () => {
    const result = applyDarkTheme({ resources: { style: [SPLASH] } });
    assert.deepEqual(result.resources.style, [
      SPLASH,
      {
        $: { name: "AppTheme", parent: "Theme.AppCompat.DayNight.NoActionBar" },
        item: DARK_ITEMS,
      },
    ]);
  });
});

describe("withDarkAndroidTheme", () => {
  it("applies the dark theme through the styles mod", async () => {
    const config = withDarkAndroidTheme({ name: "Sonolect", slug: "sonolect" });
    const mod = config.mods.android.styles;
    const result = await mod({
      modRequest: {
        platform: "android",
        modName: "styles",
        projectRoot: "/project",
        platformProjectRoot: "/project/android",
        introspect: false,
      },
      modResults: structuredClone(BASE),
    });
    assert.deepEqual(result.modResults, applyDarkTheme(BASE));
  });
});
