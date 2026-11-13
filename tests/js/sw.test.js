const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const racine = path.join(__dirname, "..", "..");
const lire = (f) => fs.readFileSync(path.join(racine, f), "utf8");
const ecoutes = {};
const ctx = { self: { addEventListener: (t, f) => (ecoutes[t] = f), location: { origin: "https://x" } }, URL };
vm.runInNewContext(lire("site/sw.js"), ctx);

test("service worker : met en cache tout ce que charge index.html, rien d'externe", () => {
  const html = lire("site/index.html");
  const l = ctx.locales(html);
  for (const m of html.matchAll(/<script src="([^"]+)"/g)) assert.ok(l.includes(m[1]), m[1]);
  assert.ok(l.includes("style.css?v=__BUILD__"));
  assert.ok(l.includes("manifest.webmanifest"));
  assert.ok(l.every((u) => !/^https?:|^\/\//.test(u)), "aucune adresse externe");
  assert.ok(!l.some((u) => u.endsWith(".xml") || u.endsWith("/")), "ni flux ni pages");
  assert.deepEqual(Object.keys(ecoutes).sort(), ["activate", "fetch", "install"]);
});

test("service worker : la version change à chaque déploiement", () => {
  assert.match(lire("site/sw.js"), /const VERSION = "__BUILD__"/);
  assert.match(lire(".github/workflows/build-deploy.yml"), /sed -i "s\/__BUILD__\/.*site\/index\.html site\/sw\.js/);
});

test("manifeste : installable (nom, démarrage relatif, icônes 192 et 512, maskable)", () => {
  const m = JSON.parse(lire("site/manifest.webmanifest"));
  assert.equal(m.start_url, "./");
  assert.equal(m.scope, "./");
  assert.equal(m.display, "standalone");
  const tailles = m.icons.map((i) => i.sizes);
  assert.ok(tailles.includes("192x192") && tailles.includes("512x512"));
  assert.ok(m.icons.some((i) => i.purpose === "maskable"));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(racine, "site", i.src)), i.src);
});
