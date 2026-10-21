// Tests for ruzzco.local (scripts/mdns-responder.mjs): the answers to phones' questions, then a
// real round trip over this PC's loopback.
//
//   npm run test:local-name              no servers needed
//   npm run test:local-name -- --live    also asks the network the way an Android phone does,
//                                        checks the proxy's certificate, and opens
//                                        https://ruzzco.local:3443/api/v1/health by this PC's
//                                        address (needs npm run https and the app)

import { X509Certificate } from "node:crypto";
import dgram from "node:dgram";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  answerLocalName,
  isLocalName,
  networkOf,
  networks,
  parseAddresses,
  parseQuery,
  replyTo,
} from "./mdns-responder.mjs";

const failures = [];
let passed = 0;
function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` (${detail})` : ""}`);
  }
}

const A = 1;
const AAAA = 28;
const NSEC = 47;
const QU = 0x8000;
const NAME = "ruzzco.local";
const HERE = "192.168.1.9";

// Built here by hand, so the module isn't tested against itself.
function query({ id = 0, flags = 0, questions }) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id, 0);
  head.writeUInt16BE(flags, 2);
  head.writeUInt16BE(questions.length, 4);
  const parts = [head];
  for (const { name, raw, type, klass = 1 } of questions) {
    if (raw) parts.push(Buffer.from(raw));
    else for (const label of name.split(".")) parts.push(Buffer.from([label.length]), Buffer.from(label));
    if (!raw) parts.push(Buffer.from([0]));
    parts.push(Buffer.from([type >> 8, type & 255, klass >> 8, klass & 255]));
  }
  return Buffer.concat(parts);
}

// Reads the records after `offset` of an answer (the responder never compresses names).
function records(packet, offset, count) {
  const found = [];
  for (let i = 0; i < count; i++) {
    const labels = [];
    while (packet[offset] !== 0) {
      labels.push(packet.toString("latin1", offset + 1, offset + 1 + packet[offset]));
      offset += 1 + packet[offset];
    }
    offset++;
    const length = packet.readUInt16BE(offset + 8);
    found.push({
      name: labels.join("."),
      type: packet.readUInt16BE(offset),
      klass: packet.readUInt16BE(offset + 2),
      ttl: packet.readUInt32BE(offset + 4),
      data: packet.subarray(offset + 10, offset + 10 + length),
    });
    offset += 10 + length;
  }
  return found;
}

const counts = (packet) => [4, 6, 8, 10].map((at) => packet.readUInt16BE(at));
const ipOf = (data) => [...data].join(".");

console.log("Answers (scripts/mdns-responder.mjs)");
{
  // Android: a one-shot query from its own port, "answer me directly" bit set, recursion desired.
  const asked = query({ id: 0x1234, flags: 0x0100, questions: [{ name: NAME, type: A, klass: 1 | QU }] });
  const reply = replyTo(asked, 40000, NAME, HERE);
  check("a one-shot query is answered straight back", reply?.unicast === true);
  const packet = reply.packet;
  check("  with the query's ID", packet.readUInt16BE(0) === 0x1234);
  check("  as an authoritative response that keeps 'recursion desired'", packet.readUInt16BE(2) === 0x8500);
  check("  repeating the question as asked", packet.subarray(12, asked.length).equals(asked.subarray(12)));
  check("  with one answer", JSON.stringify(counts(packet)) === "[1,1,0,0]", JSON.stringify(counts(packet)));
  const [answer] = records(packet, asked.length, 1);
  check("  this PC's address on that network", answer.type === A && ipOf(answer.data) === HERE, ipOf(answer.data));
  check("  for at most 10 seconds, without the cache-flush bit", answer.ttl === 10 && answer.klass === 1, `${answer.ttl}, ${answer.klass}`);
}
{
  const asked = query({ id: 7, questions: [{ name: NAME, type: AAAA }] });
  const reply = replyTo(asked, 40001, NAME, HERE);
  check("a one-shot IPv6 question gets an empty answer at once (no IPv6 address)", JSON.stringify(counts(reply.packet)) === "[1,0,0,0]");
}
{
  // Two questions, the second naming the first by pointer (name compression).
  const asked = query({ id: 9, questions: [{ name: NAME, type: AAAA }, { raw: [0xc0, 0x0c], type: A }] });
  const reply = replyTo(asked, 40002, NAME, HERE);
  check("compressed questions are read and repeated", reply && JSON.stringify(counts(reply.packet)) === "[2,1,0,0]");
}
{
  // iPhone, Mac, Windows: full mDNS from port 5353.
  const asked = query({ questions: [{ name: NAME, type: A }] });
  const reply = replyTo(asked, 5353, NAME, HERE);
  check("an mDNS query is answered to the whole network", reply?.unicast === false);
  check("  with ID 0 and no questions", reply.packet.readUInt16BE(0) === 0 && JSON.stringify(counts(reply.packet)) === "[0,1,0,1]");
  const [answer, extra] = records(reply.packet, 12, 2);
  check("  the address, 120 seconds, cache-flush bit", answer.type === A && ipOf(answer.data) === HERE && answer.ttl === 120 && answer.klass === 0x8001);
  check("  and 'no IPv6 address' (NSEC listing only A)", extra.type === NSEC && extra.data.subarray(-3).equals(Buffer.from([0, 1, 0x40])));
  const direct = replyTo(query({ questions: [{ name: NAME, type: A, klass: 1 | QU }] }), 5353, NAME, HERE);
  check("an mDNS query asking for a direct answer gets one", direct?.unicast === true);
  const ipv6 = replyTo(query({ questions: [{ name: NAME, type: AAAA }] }), 5353, NAME, HERE);
  const [first] = records(ipv6.packet, 12, 1);
  check("an mDNS IPv6 question gets 'no IPv6 address' first", first.type === NSEC);
  check("  and is limited apart from IPv4 answers (they come a moment apart)", ipv6.kind !== reply.kind, `${ipv6.kind} / ${reply.kind}`);
  const both = replyTo(query({ questions: [{ name: NAME, type: A }, { name: NAME, type: AAAA }] }), 5353, NAME, HERE);
  check("one query asking both gets both as answers", JSON.stringify(counts(both.packet)) === "[0,2,0,0]", JSON.stringify(counts(both.packet)));
}
check("names match in any letter case", replyTo(query({ questions: [{ name: "RUZZCO.Local", type: A }] }), 40000, NAME, HERE) !== null);
check("other names are left to others", replyTo(query({ questions: [{ name: "printer.local", type: A }] }), 40000, NAME, HERE) === null);
{
  const response = replyTo(query({ questions: [{ name: NAME, type: A }] }), 5353, NAME, HERE).packet;
  check("responses are never answered", replyTo(response, 5353, NAME, HERE) === null);
  check("  but their addresses are read (to spot another device using the name)", JSON.stringify(parseAddresses(response)) === JSON.stringify([{ name: NAME, address: HERE }]));
}
check("a loop of name pointers is refused", parseQuery(query({ questions: [{ raw: [0xc0, 0x0c], type: A }] })) === null);
check("a cut-off packet is refused", parseQuery(query({ questions: [{ name: NAME, type: A }] }).subarray(0, 20)) === null);

console.log("Networks");
{
  const nets = [
    { name: "Wi-Fi", address: HERE, netmask: "255.255.255.0", internal: false, scope: "31" },
    { name: "Loopback", address: "127.0.0.1", netmask: "255.0.0.0", internal: true, scope: null },
  ];
  check("an IPv4 question is matched to its subnet", networkOf({ address: "192.168.1.50" }, nets)?.name === "Wi-Fi");
  check("a question from another subnet isn't answered", networkOf({ address: "10.0.0.5" }, nets) === undefined);
  check("an IPv6 question is matched by its interface", networkOf({ address: "fe80::1%31" }, nets)?.name === "Wi-Fi");
  check("names: one word, then .local", ["ruzzco.local", "ruzzco-2.local"].every(isLocalName) && !["ruzzco.com", "a.b.local", "-x.local", "ruzzco"].some(isLocalName));
}

console.log("Round trip over loopback");
await new Promise((resolve) => {
  const port = 53535;
  const responder = answerLocalName("rz-test.local", { port, log: () => {} });
  const asker = dgram.createSocket("udp4");
  const done = (ok, detail) => {
    check("a question sent to the responder is answered with 127.0.0.1", ok, detail);
    responder.close();
    asker.close();
    resolve();
  };
  const timer = setTimeout(() => done(false, "no answer in 2 s"), 2000);
  asker.on("message", (message) => {
    clearTimeout(timer);
    const [found] = parseAddresses(message);
    done(found?.address === "127.0.0.1", JSON.stringify(found));
  });
  setTimeout(() => asker.send(query({ id: 1, questions: [{ name: "rz-test.local", type: A }] }), port, "127.0.0.1"), 300);
});

// Asks for `name` on the network of `address` the way Android does: once, from a port of its own.
function askLikeAndroid(name, address) {
  return new Promise((resolve) => {
    const asker = dgram.createSocket("udp4");
    const timer = setTimeout(() => finish(null), 3000);
    function finish(value) {
      clearTimeout(timer);
      asker.close();
      resolve(value);
    }
    asker.on("message", (message) => finish(parseAddresses(message).find((found) => found.name === name)?.address ?? null));
    asker.bind(0, () => {
      asker.setMulticastInterface(address);
      asker.send(query({ id: 2, questions: [{ name, type: A, klass: 1 | QU }] }), 5353, "224.0.0.251");
    });
  });
}

// GET /api/v1/health at `host` as https://<name>: the name goes in the handshake and the Host header.
function health(host, name, port, ca, verify) {
  return new Promise((resolve) => {
    const request = https.get(
      { host, port, servername: name, path: "/api/v1/health", headers: { host: `${name}:${port}` }, ca, rejectUnauthorized: verify, timeout: 10_000 },
      (answer) => {
        const peer = answer.socket.getPeerCertificate();
        answer.resume();
        resolve({ status: String(answer.statusCode), peer });
      },
    );
    request.on("timeout", () => request.destroy(new Error("timed out")));
    request.on("error", (error) => resolve({ status: error.code ?? error.message }));
  });
}

if (process.argv.includes("--live")) {
  const name = (process.env.RUZZCO_LOCAL_NAME || NAME).toLowerCase();
  const port = Number(process.env.RUZZCO_HTTPS_PORT ?? 3443);
  console.log(`Live: ${name} on this PC's networks (needs npm run https)`);
  const answered = [];
  for (const net of networks().filter((found) => !found.internal)) {
    const answer = await askLikeAndroid(name, net.address);
    check(`${net.name} (${net.address}): answered like Android asks`, answer === net.address, answer ?? "no answer in 3 s");
    if (answer) answered.push(answer);
  }

  const certs = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "certs");
  const authority = new X509Certificate(fs.readFileSync(path.join(certs, "ruzzco-ca.cert.pem")));
  const server = new X509Certificate(fs.readFileSync(path.join(certs, "server.cert.pem")));
  check(`the proxy's certificate names ${name} and comes from the shop authority`, server.checkHost(name) === name && server.verify(authority.publicKey));

  // By number: Windows ignores mDNS answers from this PC's own address, so this PC can't look up
  // its own name (phones can; that is what the questions above checked).
  const via = answered[0] ?? "127.0.0.1";
  let result = await health(via, name, port, authority.toString(), true);
  if (/CERT|SIGNATURE|ISSUER|SELF_SIGNED/.test(result.status)) {
    const seen = await health(via, name, port, undefined, false);
    if (seen.peer?.fingerprint256 && seen.peer.fingerprint256 !== server.fingerprint256) {
      // Antivirus HTTPS scanning (Avast's Web Shield, for one) re-signs this PC's own connections.
      console.log(`    (${seen.peer.issuer?.O ?? "something on this PC"} re-signs HTTPS made on this PC; phones aren't affected)`);
      result = seen;
    }
  }
  // 503 is the app answering without its database: the way there (certificate, proxy) works.
  check(`https://${name}:${port}/api/v1/health (at ${via}) reaches the app`, result.status === "200" || result.status === "503", result.status === "502" ? "502: start the app (npm run dev)" : result.status);
  if (result.status === "503") console.log("    (the app answers, but its database doesn't: start Docker Desktop)");
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
