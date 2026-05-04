#!/usr/bin/env node
// Patches a known bug in @mercuryworkshop/scramjet v1.1.0 where the SW cookie
// dispatch sends array indices instead of actual Set-Cookie header values.
// `for(let t in x) ... cookie:t` should be `cookie:x[t]`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(
  __dirname,
  "../node_modules/@mercuryworkshop/scramjet/dist/scramjet.all.js"
);

if (!fs.existsSync(target)) {
  console.log("patch-scramjet: scramjet.all.js not found, skipping");
  process.exit(0);
}

let js = fs.readFileSync(target, "utf-8");

const buggy =
  'for(let t in x)if(h){let r=f.dispatch(h,{scramjet$type:"cookie",cookie:t,url:e.href})';
const fixed =
  'for(let t in x)if(h){let r=f.dispatch(h,{scramjet$type:"cookie",cookie:x[t],url:e.href})';

if (js.includes(fixed)) {
  console.log("patch-scramjet: already patched");
} else if (js.includes(buggy)) {
  js = js.replace(buggy, fixed);
  fs.writeFileSync(target, js);
  console.log("patch-scramjet: patched cookie dispatch bug");
} else {
  console.log("patch-scramjet: pattern not found (different version?), skipping");
}
