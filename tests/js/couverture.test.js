const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("couverture.js");
const C = globalThis.Couverture;

const regName = new Map([["76", "Occitanie"], ["93", "Provence-Alpes-Côte d'Azur"], ["84", "Auvergne-Rhône-Alpes"],
  ["53", "Bretagne"], ["11", "Île-de-France"], ["03", "Guyane"]]);
const ev = (c, n) => Array.from({ length: n }, () => [{ region_code: c }]);

test("calcul : régions complètes d'abord, métropole même vide, outre-mer seulement si présent", () => {
  const l = C.calculer([...ev("76", 3), ...ev("53", 5), ...ev("84", 4), ...ev("93", 1), [{ region_code: null }]], regName);
  assert.deepEqual(l.map((x) => [x.code, x.n, x.complete]),
    [["84", 4, true], ["76", 3, true], ["93", 1, true], ["53", 5, false], ["11", 0, false]]);
});

test("résumé et tableau", () => {
  const l = C.calculer([...ev("76", 2), ...ev("53", 1)], regName);
  assert.equal(C.resume(l), "Couverture complète en Occitanie, PACA et Auvergne-Rhône-Alpes, partielle ailleurs");
  const h = C.html(l, (s) => s.replace(/'/g, "&#39;"));
  assert.ok(h.includes('<span class="couv-nom">Occitanie</span><span class="couv-n">2</span>'));
  assert.ok(h.includes("Provence-Alpes-Côte d&#39;Azur"));
  assert.ok(h.includes('--p:100%'));
  assert.equal((h.match(/>partielle</g) || []).length, 2);
  assert.equal(C.resume([]), "");
});
