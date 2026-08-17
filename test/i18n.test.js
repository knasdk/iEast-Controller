const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadI18n() {
  const document = {
    title: "",
    documentElement: {
      lang: "da",
      style: { setProperty() {} },
    },
    querySelectorAll() { return []; },
  };
  const context = { document, Intl, window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "i18n.js"), "utf8"), context);
  return context.window.I18n;
}

test("all static translation keys exist in every supported language", () => {
  const i18n = loadI18n();
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const keys = new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]));
  for (const match of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const entry of match[1].split(",")) keys.add(entry.split(":")[1]);
  }
  for (const match of app.matchAll(/\bt\("([^"]+)"/g)) keys.add(match[1]);

  for (const language of Object.keys(i18n.localeNames)) {
    i18n.setLocale(language);
    for (const key of keys) assert.notEqual(i18n.t(key), key, `${language} is missing ${key}`);
  }
});

test("translations support locale normalization, plurals, and API errors", () => {
  const i18n = loadI18n();
  assert.equal(i18n.normalize("nb-NO"), "nb");
  assert.equal(i18n.normalize("no"), "nb");
  assert.equal(i18n.normalize("de-DE"), "de");

  i18n.setLocale("en");
  assert.equal(i18n.t("theme.switchToLight"), "Switch to light theme");
  assert.equal(i18n.t("theme.switchToDark"), "Switch to dark theme");
  assert.equal(i18n.t("playlists.entryCount", { count: 1 }), "1 entry");
  assert.equal(i18n.t("playlists.entryCount", { count: 2 }), "2 entries");
  assert.equal(i18n.error({ errorCode: "INVALID_DEVICE_IP" }), "Enter a valid iEast IP address");
  assert.equal(i18n.spotifyError("ACCESS_DENIED"), "Spotify sign-in was denied");
});
