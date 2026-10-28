// Serves the Ruzzco web app over HTTPS on the shop network: the only way phones reach it. The app
// itself listens on 127.0.0.1:3000 only (npm run dev / npm run start pass -H 127.0.0.1), so no
// PIN, owner cookie or phone secret crosses the Wi-Fi unencrypted (slice 15). HTTPS also lets
// phones install the POS as an app (a PWA) that opens even without a connection.
//
//   npm run https        (from web/, while the app runs on port 3000)
//
//   https://ruzzco.local:3443   the app, through this proxy (with its hot-reload socket in dev)
//   http://ruzzco.local:3080    phone setup: the shop certificate and how to install it
//
// ruzzco.local is this PC's name on whatever network it is on (mdns-responder.mjs answers for it),
// so an app installed from that address finds the PC again after it joins another Wi-Fi. Phones
// that can't look up .local names use the PC's number address (https://192.168.x.x:3443), which
// only works while the PC keeps that address. RUZZCO_LOCAL_NAME sets another name, for a second
// PC on the same network.
//
// The first run makes a certificate authority for this PC and a certificate for this PC's
// network addresses signed by it, in web/certs/ (git-ignored; never commit or share it). Each
// phone installs the authority's certificate once. When this PC's address changes, the next run
// issues a new certificate from the same authority, so phones don't install anything again.
// The authority can only sign private network addresses and .local names (name constraints):
// even a stolen key couldn't pass off another website to a phone that trusts it.
// Needs OpenSSL, which comes with Git for Windows; set OPENSSL to its path if it isn't found.

import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answerLocalName, isLocalName } from "./mdns-responder.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CERTS = path.join(WEB, "certs");
const APP_PORT = Number(process.env.RUZZCO_APP_PORT ?? 3000);
const HTTPS_PORT = Number(process.env.RUZZCO_HTTPS_PORT ?? 3443);
const SETUP_PORT = Number(process.env.RUZZCO_SETUP_PORT ?? 3080);
const LOCAL_NAME = (process.env.RUZZCO_LOCAL_NAME || "ruzzco.local").toLowerCase();
const CA_NAME = "Ruzzco Shop Local CA";
const SERVER_DAYS = 800; // Apple accepts at most 825 days for a certificate from a user-installed authority
const RENEW_DAYS = 30;

const FILES = {
  caKey: path.join(CERTS, "ruzzco-ca.key.pem"),
  caCert: path.join(CERTS, "ruzzco-ca.cert.pem"),
  caConfig: path.join(CERTS, "ruzzco-ca.cnf"),
  caSerial: path.join(CERTS, "ruzzco-ca.srl"),
  key: path.join(CERTS, "server.key.pem"),
  cert: path.join(CERTS, "server.cert.pem"),
  csr: path.join(CERTS, "server.csr.pem"),
  config: path.join(CERTS, "server.cnf"),
};

// Private networks (and this PC itself): the only addresses the authority may sign.
const PRIVATE = [
  ["10.0.0.0", "255.0.0.0"],
  ["172.16.0.0", "255.240.0.0"],
  ["192.168.0.0", "255.255.0.0"],
  ["127.0.0.0", "255.0.0.0"],
];

const toNumber = (ip) => ip.split(".").reduce((value, part) => value * 256 + Number(part), 0);
const isPrivate = (ip) =>
  PRIVATE.some(([network, mask]) => {
    const m = toNumber(mask);
    return (toNumber(ip) & m) >>> 0 === (toNumber(network) & m) >>> 0;
  });

function localAddresses() {
  const ips = new Set(["127.0.0.1"]);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === "IPv4" && !entry.internal && isPrivate(entry.address)) ips.add(entry.address);
    }
  }
  return [...ips];
}

function localNames() {
  const names = ["localhost", LOCAL_NAME];
  const host = os.hostname().toLowerCase();
  if (/^[a-z0-9-]+$/.test(host) && `${host}.local` !== LOCAL_NAME) names.push(`${host}.local`); // iPhones resolve .local names on the Wi-Fi
  return names;
}

function findOpenssl() {
  const candidates = [
    process.env.OPENSSL,
    "openssl",
    "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
    "C:\\Program Files\\Git\\ucrt64\\bin\\openssl.exe",
    "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["version"], { stdio: "pipe" });
      return candidate;
    } catch {
      // try the next one
    }
  }
  throw new Error("OpenSSL was not found. Install Git for Windows (it includes OpenSSL) or set OPENSSL to openssl.exe.");
}

function makeAuthority(openssl) {
  const constraints = [
    ...PRIVATE.map(([network, mask]) => `permitted;IP:${network}/${mask}`),
    "permitted;DNS:localhost",
    "permitted;DNS:local",
  ].join(", ");
  fs.writeFileSync(
    FILES.caConfig,
    [
      "[req]",
      "distinguished_name = dn",
      "x509_extensions = v3_ca",
      "prompt = no",
      "[dn]",
      `CN = ${CA_NAME}`,
      `O = Ruzzco Barbers (${os.hostname()})`,
      "[v3_ca]",
      "basicConstraints = critical, CA:TRUE, pathlen:0",
      "keyUsage = critical, keyCertSign, cRLSign",
      "subjectKeyIdentifier = hash",
      `nameConstraints = critical, ${constraints}`,
      "",
    ].join("\n"),
  );
  execFileSync(openssl, [
    "req", "-x509", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "3650",
    "-keyout", FILES.caKey, "-out", FILES.caCert, "-config", FILES.caConfig,
  ], { stdio: "pipe" });
  console.log(`  made a new certificate authority, "${CA_NAME}" (phones need its certificate once)`);
}

function makeServerCertificate(openssl, ips, names) {
  fs.writeFileSync(
    FILES.config,
    [
      "[req]",
      "distinguished_name = dn",
      "prompt = no",
      "[dn]",
      "CN = Ruzzco shop server",
      "[v3_server]",
      "basicConstraints = critical, CA:FALSE",
      "keyUsage = critical, digitalSignature, keyEncipherment",
      "extendedKeyUsage = serverAuth",
      "subjectKeyIdentifier = hash",
      "authorityKeyIdentifier = keyid",
      "subjectAltName = @alt",
      "[alt]",
      ...names.map((name, i) => `DNS.${i + 1} = ${name}`),
      ...ips.map((ip, i) => `IP.${i + 1} = ${ip}`),
      "",
    ].join("\n"),
  );
  execFileSync(openssl, [
    "req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", FILES.key, "-out", FILES.csr, "-config", FILES.config,
  ], { stdio: "pipe" });
  execFileSync(openssl, [
    "x509", "-req", "-in", FILES.csr, "-CA", FILES.caCert, "-CAkey", FILES.caKey,
    "-CAserial", FILES.caSerial, "-CAcreateserial", "-out", FILES.cert, "-days", String(SERVER_DAYS),
    "-sha256", "-extfile", FILES.config, "-extensions", "v3_server",
  ], { stdio: "pipe" });
  fs.rmSync(FILES.csr, { force: true });
  console.log(`  issued a certificate for ${[...ips, ...names].join(", ")}`);
}

// Reuses the certificates while they still fit; renews the server's when an address is new,
// it expires within RENEW_DAYS, or the authority changed.
function certificates() {
  fs.mkdirSync(CERTS, { recursive: true });
  const ips = localAddresses();
  const names = localNames();
  let openssl;
  const tool = () => (openssl ??= findOpenssl());

  if (!fs.existsSync(FILES.caCert) || !fs.existsSync(FILES.caKey)) makeAuthority(tool());
  const authority = new X509Certificate(fs.readFileSync(FILES.caCert));

  let fits = false;
  if (fs.existsSync(FILES.cert) && fs.existsSync(FILES.key)) {
    const current = new X509Certificate(fs.readFileSync(FILES.cert));
    const covered = current.subjectAltName ?? "";
    fits =
      current.verify(authority.publicKey) &&
      new Date(current.validTo).getTime() - Date.now() > RENEW_DAYS * 86_400_000 &&
      ips.every((ip) => covered.includes(`IP Address:${ip}`)) &&
      names.every((name) => covered.includes(`DNS:${name}`));
  }
  if (!fits) makeServerCertificate(tool(), ips, names);

  return {
    key: fs.readFileSync(FILES.key),
    cert: fs.readFileSync(FILES.cert),
    authorityDer: authority.raw,
    fingerprint: authority.fingerprint256,
    ips,
    names,
  };
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer"]);

function withoutHopHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_BY_HOP.has(name.toLowerCase())));
}

function forwardedHeaders(req) {
  const headers = withoutHopHeaders(req.headers);
  const client = req.socket.remoteAddress ?? "";
  headers["x-forwarded-for"] = req.headers["x-forwarded-for"] ? `${req.headers["x-forwarded-for"]}, ${client}` : client;
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-host"] = req.headers.host ?? "";
  return headers;
}

function startProxy({ key, cert }) {
  const server = https.createServer({ key, cert }, (req, res) => {
    const upstream = http.request(
      { host: "127.0.0.1", port: APP_PORT, method: req.method, path: req.url, headers: forwardedHeaders(req) },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.statusMessage, withoutHopHeaders(answer.headers));
        answer.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`The Ruzzco app isn't answering on port ${APP_PORT} (${error.code}). Start it first: npm run dev or npm run start.`);
    });
    req.pipe(upstream);
  });

  // WebSockets (the dev server's hot reload): pass the raw connection through.
  server.on("upgrade", (req, socket, head) => {
    const upstream = net.connect(APP_PORT, "127.0.0.1", () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      lines.push("X-Forwarded-Proto: https", "", "");
      upstream.write(lines.join("\r\n"));
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  return server;
}

const escapeHtml = (text) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// For a value inside the page's <script>.
const scriptValue = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

// Step 3 offers the app by name, which keeps working on any Wi-Fi; the page asks the name first
// and offers the number address only when this phone can't find the shop PC by name.
function setupPage({ nameUrl, numberUrl, foundUrl, fingerprint }) {
  const byName = escapeHtml(nameUrl);
  const byNumber = escapeHtml(numberUrl);
  const name = escapeHtml(LOCAL_NAME);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Set up this phone · Ruzzco Barbers</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px 16px 40px; background: #0c0b0a; color: #f5f0e8; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 34rem; margin: 0 auto; }
  h1, h2 { font-family: "Oswald", "Arial Narrow", "Roboto Condensed", sans-serif; text-transform: uppercase; letter-spacing: 0.02em; line-height: 1.15; }
  h1 { font-size: 1.9rem; margin: 0 0 8px; }
  h2 { font-size: 1.15rem; margin: 28px 0 8px; }
  p, li { color: #d8d0c4; }
  ol { padding-left: 1.25rem; }
  li { margin: 6px 0; }
  .muted { color: #a69e93; font-size: 0.9rem; }
  code { font-size: 0.8rem; word-break: break-all; color: #a69e93; }
  a.button { display: flex; align-items: center; justify-content: center; min-height: 52px; margin: 12px 0; border-radius: 12px; text-decoration: none; font: 700 1rem "Oswald", "Arial Narrow", sans-serif; letter-spacing: 0.06em; text-transform: uppercase; }
  .primary { background: #c41f29; color: #f5f0e8; }
  .secondary { background: #1e1c1a; color: #f5f0e8; border: 1px solid #5f6268; }
  a:focus-visible { outline: 3px solid #f5f0e8; outline-offset: 3px; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <h1>Set up this phone</h1>
  <p>Once per phone, on the same Wi-Fi as the shop PC. Afterwards Ruzzco installs like an app, and the POS opens even when the shop PC can't be reached.</p>

  <h2>1. Get the shop certificate</h2>
  <a class="button primary" href="/ruzzco-ca.crt">Download the certificate</a>
  <p class="muted">"${escapeHtml(CA_NAME)}". It only works for this shop's network addresses. Fingerprint (SHA-256):<br><code>${escapeHtml(fingerprint)}</code></p>

  <h2>2. Install it</h2>
  <p><strong>Android:</strong></p>
  <ol>
    <li>Open Settings and search for <strong>CA certificate</strong> (often under Security, then Encryption &amp; credentials, then Install a certificate).</li>
    <li>Choose <strong>CA certificate</strong>, then <strong>Install anyway</strong>, and pick <strong>ruzzco-ca.crt</strong> from Downloads.</li>
  </ol>
  <p><strong>iPhone:</strong></p>
  <ol>
    <li>When Safari asks to download a configuration profile, tap <strong>Allow</strong>.</li>
    <li>Open Settings, tap <strong>Profile Downloaded</strong>, then <strong>Install</strong>.</li>
    <li>Open Settings, General, About, <strong>Certificate Trust Settings</strong>, and turn on <strong>${escapeHtml(CA_NAME)}</strong>.</li>
  </ol>

  <h2>3. Open Ruzzco and install it</h2>
  <p id="name-status" class="muted">Checking whether this phone finds the shop PC by name…</p>
  <a class="button secondary" id="by-name" href="${byName}">Open ${byName}</a>
  <div id="by-number" hidden>
    <a class="button secondary" href="${byNumber}">Open ${byNumber}</a>
    <p class="muted">The number address only works while the shop PC keeps it. After the PC joins another Wi-Fi, set the app up again from this page there.</p>
  </div>
  <ol>
    <li><strong>Android (Chrome):</strong> menu (⋮), then <strong>Install app</strong> or <strong>Add to Home screen</strong>, then <strong>Install</strong>.</li>
    <li><strong>iPhone (Safari):</strong> Share, then <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
  </ol>
  <p class="muted">Each address is its own device for the POS: the barber picks their name again there, and sales waiting at an old address stay there until that address syncs them. Before switching, open the old address and check that the POS shows everything synced.</p>
</main>
<script>
(() => {
  const status = document.getElementById("name-status");
  const show = (text, byName) => {
    status.textContent = text;
    document.getElementById("by-name").hidden = !byName;
    document.getElementById("by-number").hidden = byName;
  };
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 8000);
  fetch(${scriptValue(foundUrl)}, { cache: "no-store", signal: stop.signal })
    .then((answer) => answer.json())
    .then((found) => {
      if (found.fingerprint === ${scriptValue(fingerprint)}) {
        show("This phone finds the shop PC by name, on any Wi-Fi they share. Install from this address:", true);
      } else {
        show("Another device on this network also answers to ${name}. Use the number address, and give the shop PC its own name (see the README).", false);
      }
    })
    .catch(() => show("This phone can't find ${name}. Older phones can't, and Android can't while it is the hotspot itself or on mobile data. Use the number address:", false))
    .finally(() => clearTimeout(timer));
})();
</script>
</body>
</html>`;
}

function startSetup({ authorityDer, fingerprint }) {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://setup.invalid");
    // The setup page (opened by name or by number) asks this to tell whether the name reaches this PC.
    if (url.pathname === "/found") {
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify({ name: LOCAL_NAME, fingerprint }));
      return;
    }
    if (url.pathname === "/ruzzco-ca.crt") {
      res.writeHead(200, {
        "content-type": "application/x-x509-ca-cert",
        "content-disposition": 'attachment; filename="ruzzco-ca.crt"',
        "cache-control": "no-store",
      });
      res.end(authorityDer);
      return;
    }
    if (url.pathname !== "/") {
      res.writeHead(302, { location: "/" });
      res.end();
      return;
    }
    // This PC's address on the network the phone came from (IPv4 only: the servers listen on 0.0.0.0).
    const address = (req.socket.localAddress ?? "").replace(/^::ffff:/, "");
    const number = net.isIPv4(address) ? address : "localhost";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(
      setupPage({
        nameUrl: `https://${LOCAL_NAME}:${HTTPS_PORT}/`,
        numberUrl: `https://${number}:${HTTPS_PORT}/`,
        foundUrl: `http://${LOCAL_NAME}:${SETUP_PORT}/found`,
        fingerprint,
      }),
    );
  });
}

function listen(server, port, label) {
  server.on("error", (error) => {
    console.error(error.code === "EADDRINUSE" ? `Port ${port} (${label}) is already in use. Is npm run https already running?` : error);
    process.exit(1);
  });
  server.listen(port, "0.0.0.0");
}

if (!isLocalName(LOCAL_NAME)) {
  console.error(`RUZZCO_LOCAL_NAME must be one word and .local, like ruzzco-2.local (got "${LOCAL_NAME}").`);
  process.exit(1);
}

console.log("Ruzzco over HTTPS");
const tls = certificates();
const proxy = startProxy(tls);
listen(proxy, HTTPS_PORT, "app over HTTPS");
listen(startSetup(tls), SETUP_PORT, "phone setup");
const numbers = (ips, port, scheme) => ips.filter((ip) => ip !== "127.0.0.1").map((ip) => `${scheme}://${ip}:${port}`).join("  ");
console.log(`  app:          https://${LOCAL_NAME}:${HTTPS_PORT}  -> http://localhost:${APP_PORT}`);
console.log(`  phone setup:  http://${LOCAL_NAME}:${SETUP_PORT}  (by number: ${numbers(tls.ips, SETUP_PORT, "http") || "no network"})`);
console.log(`  certificates: ${path.relative(process.cwd(), CERTS) || CERTS} (never commit or share; Ctrl+C stops)`);
// Windows blocks phones on networks it treats as public, which a Wi-Fi it hasn't seen before is.
// Asking Windows needs PowerShell, which antivirus flags when another program starts it hidden.
if (process.platform === "win32") {
  console.log("  phones can't connect on a new Wi-Fi? Run scripts\\phone-firewall.ps1 once (see the README).");
}

answerLocalName(LOCAL_NAME, {
  onNetwork(found) {
    console.log(`  joined ${found.name} (${found.address}): phones there open https://${LOCAL_NAME}:${HTTPS_PORT}, setup http://${found.address}:${SETUP_PORT}`);
    // The number address needs a certificate that names it; the name's certificate still fits.
    try {
      const fresh = certificates();
      proxy.setSecureContext({ key: fresh.key, cert: fresh.cert });
    } catch (error) {
      console.error(`  couldn't renew the certificate for ${found.address}: ${error.message}`);
    }
  },
});
