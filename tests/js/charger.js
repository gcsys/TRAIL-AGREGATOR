// Charge un script du site (IIFE qui s'attache à globalThis) dans Node.
const path = require("node:path");
module.exports = (...files) => files.forEach((f) => require(path.join(__dirname, "..", "..", "site", f)));
