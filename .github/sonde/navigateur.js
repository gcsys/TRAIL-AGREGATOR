// Test en vrai navigateur (Chromium) de l'API isochrone IGN, depuis le site servi en local :
// CORS, temps de réponse, captures avec les vrais fonds de carte.
const { chromium, devices } = require("playwright");
const fs = require("fs");
const OUT = process.env.OUT || "captures";
fs.mkdirSync(OUT, { recursive: true });
const URL0 = "http://localhost:8000/?autour=43.8367,4.3601,30,N%C3%AEmes&route=60&tri=near:1";

setTimeout(() => { console.log("DÉLAI GLOBAL DÉPASSÉ"); process.exit(2); }, 240000);
(async () => {
  const b = await chromium.launch();
  const log = [];
  const step = (m) => console.log(new Date().toISOString().slice(11, 19), m);
  const watch = (p) => {
    p.on("pageerror", (e) => log.push("ERREUR JS " + e.message));
    p.on("console", (m) => m.type() === "error" && log.push("console " + m.text()));
    p.on("requestfinished", async (r) => {
      if (!/isochrone/.test(r.url())) return;
      const t = r.timing(), res = await r.response();
      log.push(`isochrone ${new URL(r.url()).searchParams.get("costValue") / 60} min : HTTP ${res.status()} en ${Math.round(t.responseEnd)} ms, CORS ${res.headers()["access-control-allow-origin"]}`);
    });
    p.on("requestfailed", (r) => /isochrone/.test(r.url()) && log.push("ÉCHEC " + r.url() + " " + r.failure().errorText));
  };
  // 1. petit test direct : fetch depuis une page du site
  step("fetch direct");
  let p = await b.newPage();
  p.setDefaultTimeout(20000);
  watch(p);
  await p.goto("http://localhost:8000/style.css", { waitUntil: "domcontentloaded" }).catch((e) => step("goto " + e.message));
  const direct = await p.evaluate(async () => {
    const t = performance.now();
    try {
      const r = await fetch("https://data.geopf.fr/navigation/isochrone?point=4.36,43.837&resource=bdtopo-valhalla&costValue=1800&costType=time&timeUnit=second&profile=car&direction=departure&geometryFormat=geojson");
      const j = await r.json();
      return `fetch direct : HTTP ${r.status}, ${j.geometry && j.geometry.type}, ${Math.round(performance.now() - t)} ms`;
    } catch (e) {
      return "fetch direct : ÉCHEC " + e.message;
    }
  });
  log.push(direct);
  await p.close();

  // 2. ordinateur
  const ctxD = await b.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
  step(direct);
  p = await ctxD.newPage();
  p.setDefaultTimeout(30000);
  watch(p);
  const t0 = Date.now();
  step("ordinateur");
  await p.goto(URL0, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => document.querySelectorAll(".ev-near").length && /min/.test(document.querySelector(".ev-near").textContent), null, { timeout: 60000 });
  log.push(`ordinateur : zone 1 h affichée en ${Date.now() - t0} ms`);
  await p.waitForTimeout(6000); // paliers + tuiles
  log.push("ordinateur : " + (await p.textContent("#count-sub")) + " ; " + (await p.$$eval("#cards .ev-near", (l) => l.slice(0, 8).map((x) => x.textContent).join(" | "))));
  step("capture ordinateur");
  await p.screenshot({ path: `${OUT}/ordinateur.png` });
  await p.click("#open-zone");
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/ordinateur-zone.png` });
  await ctxD.close();

  // 3. mobile
  const ctxM = await b.newContext({ ...devices["iPhone 13"] });
  step("mobile");
  p = await ctxM.newPage();
  p.setDefaultTimeout(30000);
  watch(p);
  await p.goto(URL0, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => document.querySelectorAll(".ev-near").length && /min/.test(document.querySelector(".ev-near").textContent), null, { timeout: 60000 });
  await p.waitForTimeout(4000);
  await p.evaluate(() => document.querySelector("#cards").scrollIntoView());
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/mobile-liste.png` });
  await p.click("#view-toggle");
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `${OUT}/mobile-carte.png` });
  step("zone mobile");
  await p.click("#map-zone-lbl", { timeout: 5000 }).catch((e) => step("zone : " + e.message.split("\n")[0]));
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/mobile-zone.png` });
  await ctxM.close();

  fs.writeFileSync(`${OUT}/journal.txt`, log.join("\n") + "\n");
  console.log(log.join("\n"));
  process.exit(0); // b.close() peut rester bloqué sur des requêtes de tuiles en cours
})().catch((e) => { console.log("ÉCHEC", e.message); process.exit(1); });
