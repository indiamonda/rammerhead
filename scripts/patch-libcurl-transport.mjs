// Patch @mercuryworkshop/libcurl-transport to use redirect: "follow"
// instead of redirect: "manual" so Google Drive file downloads work.
// This runs automatically after `npm install`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const filePath = join(
  "node_modules",
  "@mercuryworkshop",
  "libcurl-transport",
  "dist",
  "index.js"
);

if (!existsSync(filePath)) {
  console.log(
    "libcurl-transport not found, skipping patch (may not be installed yet)"
  );
  process.exit(0);
}

let content = readFileSync(filePath, "utf8");

if (!content.includes('redirect: "manual"')) {
  console.log("libcurl-transport already patched or redirect is not manual");
  process.exit(0);
}

content = content.replace(/redirect:\s*"manual"/g, 'redirect: "follow"');
writeFileSync(filePath, content);
console.log("Patched libcurl-transport: redirect: 'manual' -> redirect: 'follow'");
