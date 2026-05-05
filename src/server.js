import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { hostname } from "node:os";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicPath = path.join(__dirname, "../public");

logging.set_level(logging.WARN);
Object.assign(wisp.options, {
  allow_udp_streams: false,
  dns_servers: ["1.1.1.3", "1.0.0.3"],
});

const BLOCKED_EMAILS = new Set([
  "weeee@outlook.com",
]);

const BLOCKED_USERNAMES = new Set([
  "dick",
]);

const BLOCKED_DISPLAY_NAMES = new Set([
  "dick",
]);

const adBlockRulesPath = path.join(__dirname, "../public/adblock-rules.json");

function generateAdBlockRules() {
  const adBlockerSrc = path.join(__dirname, "util/adBlocker.js");
  if (!fs.existsSync(adBlockerSrc)) return;
  try {
    const code = fs.readFileSync(adBlockerSrc, "utf-8");

    const exactMatch = code.match(
      /const AD_DOMAINS_EXACT\s*=\s*new Set\(\[([\s\S]*?)\]\)/
    );
    const exact = exactMatch
      ? exactMatch[1]
          .match(/'([^']+)'/g)
          ?.map((s) => s.replace(/'/g, "")) || []
      : [];

    const suffixMatch = code.match(
      /const AD_DOMAINS_SUFFIX\s*=\s*\[([\s\S]*?)\];/
    );
    const suffix = suffixMatch
      ? suffixMatch[1]
          .match(/'([^']+)'/g)
          ?.map((s) => s.replace(/'/g, "")) || []
      : [];

    // Extract the AD_PATH_RE by finding the array contents and eval-ing
    // the array to get the actual strings (preserving regex escapes).
    let pathReSource = "";
    const pathArrayMatch = code.match(
      /const AD_PATH_RE\s*=\s*new RegExp\(\[([\s\S]*?)\]\.join\('([^']*)'\),\s*'([^']*)'\)/
    );
    if (pathArrayMatch) {
      try {
        // Evaluate the array literal in a sandbox to get proper strings
        const arr = new Function("return [" + pathArrayMatch[1] + "]")();
        const sep = pathArrayMatch[2] || "|";
        const flags = pathArrayMatch[3] || "i";
        const joined = arr.join(sep);
        // Validate the regex compiles
        new RegExp(joined, flags);
        pathReSource = joined;
      } catch (_) {}
    }

    const rules = {
      exactDomains: exact,
      suffixDomains: suffix,
      pathReSource: pathReSource,
    };
    fs.writeFileSync(adBlockRulesPath, JSON.stringify(rules));
  } catch (e) {
    console.error("Failed to generate adblock rules:", e.message);
  }
}

generateAdBlockRules();

const fastify = Fastify({
  serverFactory: (handler) => {
    return createServer()
      .on("request", (req, res) => {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
        handler(req, res);
      })
      .on("upgrade", (req, socket, head) => {
        if (req.url?.endsWith("/wisp/")) wisp.routeRequest(req, socket, head);
        else socket.end();
      });
  },
});

fastify.register(fastifyStatic, {
  root: publicPath,
  decorateReply: true,
});

fastify.register(fastifyStatic, {
  root: scramjetPath,
  prefix: "/scram/",
  decorateReply: false,
});

fastify.register(fastifyStatic, {
  root: libcurlPath,
  prefix: "/libcurl/",
  decorateReply: false,
});

fastify.register(fastifyStatic, {
  root: baremuxPath,
  prefix: "/baremux/",
  decorateReply: false,
});

fastify.get("/health", async () => ({ status: "ok" }));

fastify.post("/api/check-access", async (req, reply) => {
  try {
    const { email, username, displayName } = req.body || {};
    if (email && BLOCKED_EMAILS.has(email.toLowerCase().trim())) {
      return reply.code(403).send({ blocked: true, reason: "email" });
    }
    if (username && BLOCKED_USERNAMES.has(username.toLowerCase().replace(/^@/, "").trim())) {
      return reply.code(403).send({ blocked: true, reason: "username" });
    }
    if (displayName && BLOCKED_DISPLAY_NAMES.has(displayName.toLowerCase().trim())) {
      return reply.send({ blocked: false, displayNameWarning: true });
    }
    return reply.send({ blocked: false });
  } catch (_) {
    return reply.send({ blocked: false });
  }
});

fastify.setNotFoundHandler((_req, reply) => {
  return reply.code(404).type("text/html").send("Not Found");
});

fastify.server.on("listening", () => {
  const address = fastify.server.address();
  console.log("Listening on:");
  console.log(`\thttp://localhost:${address.port}`);
  console.log(`\thttp://${hostname()}:${address.port}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  console.log("Shutting down...");
  fastify.close();
  process.exit(0);
}

let port = parseInt(process.env.PORT || "");
if (isNaN(port)) port = 8080;

fastify.listen({ port, host: "0.0.0.0" });
