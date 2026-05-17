import dgram from "node:dgram";
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

const DNS_PORT = parseInt(process.env.DNS_PORT || "");
const BIND_HOST = process.env.DNS_HOST || "0.0.0.0";
const DOH_SERVER = process.env.DOH_SERVER || "https://cloudflare-dns.com/dns-query";

const DNS_SERVERS = (process.env.DNS_SERVERS || "1.1.1.1,1.0.0.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function parseDnsQuery(buf) {
  if (buf.length < 12) return null;

  const transactionId = buf.readUInt16BE(0);
  const flags = buf.readUInt16BE(2);
  const questionsCount = buf.readUInt16BE(4);

  if (questionsCount < 1) return null;

  let offset = 12;
  let name = "";
  while (offset < buf.length) {
    const labelLen = buf[offset++];
    if (labelLen === 0) break;
    if (labelLen > 63) break; // compression not supported in query
    name += buf.slice(offset, offset + labelLen).toString("ascii") + ".";
    offset += labelLen;
  }

  const qtype = buf.readUInt16BE(offset + 2);
  const qclass = buf.readUInt16BE(offset + 6);

  return {
    transactionId,
    flags,
    name: name.slice(0, -1),
    qtype,
    qclass,
    headerLength: offset + 8,
  };
}

function buildDnsResponse(query, ip) {
  const nameBytes = [];
  const labels = query.name.split(".");
  for (const label of labels) {
    nameBytes.push(label.length);
    nameBytes.push(...Buffer.from(label));
  }
  nameBytes.push(0);

  const ipBuf = Buffer.isBuffer(ip) ? ip : Buffer.from(ip);
  const response = Buffer.alloc(query.headerLength + ipBuf.length + 16);

  response.writeUInt16BE(query.transactionId, 0);
  response.writeUInt16BE(0x8180, 2);
  response.writeUInt16BE(1, 4);
  response.writeUInt16BE(1, 6);
  response.writeUInt16BE(0, 8);
  response.writeUInt16BE(0, 10);

  const nameStart = 12;
  nameBytes.forEach((b, i) => (response[nameStart + i] = b));
  const qsection = nameStart + nameBytes.length + 1;
  response.writeUInt16BE(1, qsection);
  response.writeUInt16BE(1, qsection + 4);

  const ansStart = query.headerLength;
  response.writeUInt16BE(0xc00c, ansStart);
  response.writeUInt16BE(1, ansStart + 2);
  response.writeUInt16BE(1, ansStart + 4);
  response.writeUInt16BE(300, ansStart + 6);
  response.writeUInt16BE(ipBuf.length, ansStart + 10);
  ipBuf.copy(response, ansStart + 12);

  return response;
}

function buildServFail(transactionId) {
  const resp = Buffer.alloc(12);
  resp.writeUInt16BE(transactionId, 0);
  resp.writeUInt16BE(0x8183, 2);
  resp.writeUInt16BE(0, 4);
  return resp;
}

async function resolveDoH(name, type = "A") {
  return new Promise((resolve, reject) => {
    const url = new URL(DOH_SERVER);
    url.searchParams.set("name", name);
    url.searchParams.set("type", type);

    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, { method: "GET", headers: { Accept: "application/dns-json" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.Status === 0 && json.Answer) {
            const a = json.Answer.find((a) => a.type === 1);
            const aaaa = json.Answer.find((a) => a.type === 28);
            const ip = a || aaaa;
            if (ip) {
              if (ip.type === 1) {
                resolve(ip.data);
              } else {
                resolve(ip.data);
              }
            }
          }
          reject(new Error("No valid answer"));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

async function resolveFallback(name) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket("udp4");

    const labels = name.split(".");
    let queryLen = 12;
    for (const label of labels) {
      queryLen += 1 + label.length;
    }
    queryLen += 5;

    const query = Buffer.alloc(queryLen);
    query.writeUInt16BE(Math.floor(Math.random() * 0xffff), 0);
    query.writeUInt16BE(0x0100, 2);
    query.writeUInt16BE(1, 4);
    query.writeUInt16BE(0, 6);
    query.writeUInt16BE(0, 8);
    query.writeUInt16BE(0, 10);

    let offset = 12;
    for (const label of labels) {
      query[offset++] = label.length;
      Buffer.from(label).copy(query, offset);
      offset += label.length;
    }
    query[offset++] = 0;
    query.writeUInt16BE(1, offset);
    query.writeUInt16BE(1, offset + 4);

    const server = DNS_SERVERS[0] || "1.1.1.1";
    const serverParts = server.split(".").map(Number);

    const timeout = setTimeout(() => {
      client.close();
      reject(new Error("DNS timeout"));
    }, 5000);

    client.on("message", (msg) => {
      clearTimeout(timeout);
      const answerCount = msg.readUInt16BE(6);
      if (answerCount < 1) {
        client.close();
        reject(new Error("No answer"));
        return;
      }
      const answerOffset = 12 + (labels.length + 1 + 4) * labels.reduce((acc, l) => acc + 1 + l.length, 0);
      if (msg.length < answerOffset + 12) {
        client.close();
        reject(new Error("Malformed response"));
        return;
      }
      const rdLength = msg.readUInt16BE(answerOffset + 10);
      const ip = msg.slice(answerOffset + 12, answerOffset + 12 + rdLength);
      client.close();
      resolve(ip);
    });

    client.on("error", (err) => {
      clearTimeout(timeout);
      client.close();
      reject(err);
    });

    client.send(query, 53, server, (err) => {
      if (err) {
        clearTimeout(timeout);
        client.close();
        reject(err);
      }
    });
  });
}

async function resolveName(name) {
  try {
    const ip = await resolveDoH(name);
    return ip;
  } catch (_) {
    return resolveFallback(name);
  }
}

export function startDnsServer() {
  const port = isNaN(DNS_PORT) ? 5353 : DNS_PORT;
  const server = dgram.createSocket("udp4");

  server.on("message", async (msg, rinfo) => {
    let transactionId = 0;
    try {
      const query = parseDnsQuery(msg);
      if (!query) {
        const failResp = buildServFail(transactionId);
        server.send(failResp, rinfo.port, rinfo.address);
        return;
      }

      transactionId = query.transactionId;
      const ip = await resolveName(query.name);
      const response = buildDnsResponse(query, ip);
      server.send(response, rinfo.port, rinfo.address);
    } catch (e) {
      try {
        server.send(buildServFail(transactionId || 0), rinfo.port, rinfo.address);
      } catch (_) {}
    }
  });

  server.on("error", (err) => {
    console.error("DNS server error:", err.message);
  });

  server.bind(port, BIND_HOST, () => {
    console.log(`DNS server listening on ${BIND_HOST}:${port}`);
  });

  return server;
}