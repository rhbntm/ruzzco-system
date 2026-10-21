// Answers "where is ruzzco.local?" on every network this PC is on, so phones reach the shop PC by
// one fixed name on any Wi-Fi, whatever address the PC gets there. This is multicast DNS (mDNS,
// RFC 6762), the lookup printers and Chromecasts use; iPhones and recent Android phones ask it for
// every .local name. Plain Node, nothing to install: it shares UDP port 5353 with Windows' own
// mDNS, answers only for its own name, and answers with this PC's IPv4 address on the network the
// question came from. It follows network changes (another Wi-Fi, a new address) while it runs.
// The name is for other devices: Windows ignores mDNS answers from its own address, so this PC
// itself can't look it up (it uses localhost).

import dgram from "node:dgram";
import os from "node:os";

const MDNS_PORT = 5353;
const GROUP = { udp4: "224.0.0.251", udp6: "ff02::fb" };
const TYPE = { A: 1, AAAA: 28, NSEC: 47, ANY: 255 };
const CLASS_IN = 1;
const CLASS_ANY = 255;
const CACHE_FLUSH = 0x8000; // in a record's class: "this replaces what you had for the name"
const UNICAST_RESPONSE = 0x8000; // in a question's class: "answer me directly"
const TTL = 120; // seconds, as RFC 6762 recommends for address records
const ONE_SHOT_TTL = 10; // at most 10 s in answers to one-shot queries (RFC 6762 section 6.7)
const REFRESH_MS = 5_000;
const MULTICAST_GAP_MS = 1_000; // at most one multicast answer of each kind per network per second

// One label, then .local: "ruzzco.local", "ruzzco-2.local".
export const isLocalName = (name) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.local$/.test(name);

const toNumber = (ip) => ip.split(".").reduce((value, part) => value * 256 + Number(part), 0);

// This PC's networks that have an IPv4 address: the address to answer with, and the IPv6 scope
// that link-local questions on the same network arrive with (an interface number on Windows).
export function networks() {
  const found = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    const v4 = entries?.find((entry) => entry.family === "IPv4");
    if (!v4) continue;
    const v6 = entries.find((entry) => entry.family === "IPv6" && /^fe80:/i.test(entry.address));
    const scope = v6 ? (process.platform === "win32" ? String(v6.scopeid) : name) : null;
    found.push({ name, address: v4.address, netmask: v4.netmask, internal: v4.internal, scope });
  }
  return found;
}

// The network a question came from: by subnet for IPv4, by interface (the %scope) for IPv6.
export function networkOf(from, nets) {
  if (!from.address.includes(":")) {
    const ip = toNumber(from.address);
    return nets.find((net) => ((toNumber(net.address) ^ ip) & toNumber(net.netmask)) === 0);
  }
  if (from.address === "::1") return nets.find((net) => net.internal);
  const scope = from.address.split("%")[1];
  return scope ? nets.find((net) => net.scope === scope) : undefined;
}

function readName(message, start) {
  const labels = [];
  let offset = start;
  let end = null;
  for (let jumps = 0; jumps <= 16; ) {
    if (offset >= message.length) return null;
    const length = message[offset];
    if (length === 0) return { name: labels.join(".").toLowerCase(), end: end ?? offset + 1 };
    if ((length & 0xc0) === 0xc0) {
      if (offset + 1 >= message.length) return null;
      end ??= offset + 2;
      offset = ((length & 0x3f) << 8) | message[offset + 1];
      jumps++;
      continue;
    }
    if (length > 63 || offset + 1 + length > message.length) return null;
    labels.push(message.toString("latin1", offset + 1, offset + 1 + length));
    offset += 1 + length;
  }
  return null; // a loop of compression pointers
}

// The questions of a standard query; null for responses, other opcodes and damaged packets.
export function parseQuery(message) {
  if (message.length < 12) return null;
  const flags = message.readUInt16BE(2);
  if (flags & 0x8000 || flags & 0x7800) return null;
  const questions = [];
  let offset = 12;
  for (let i = message.readUInt16BE(4); i > 0; i--) {
    const read = readName(message, offset);
    if (!read || read.end + 4 > message.length) return null;
    const klass = message.readUInt16BE(read.end + 2);
    questions.push({
      name: read.name,
      type: message.readUInt16BE(read.end),
      klass: klass & ~UNICAST_RESPONSE,
      unicast: (klass & UNICAST_RESPONSE) !== 0,
    });
    offset = read.end + 4;
  }
  return { id: message.readUInt16BE(0), flags, questions, questionBytes: message.subarray(12, offset) };
}

// The IPv4 address records in a response: [{ name, address }].
export function parseAddresses(message) {
  if (message.length < 12 || !(message.readUInt16BE(2) & 0x8000)) return [];
  let offset = 12;
  for (let i = message.readUInt16BE(4); i > 0; i--) {
    const read = readName(message, offset);
    if (!read) return [];
    offset = read.end + 4;
  }
  const found = [];
  const records = message.readUInt16BE(6) + message.readUInt16BE(8) + message.readUInt16BE(10);
  for (let i = 0; i < records; i++) {
    const read = readName(message, offset);
    if (!read || read.end + 10 > message.length) break;
    const data = read.end + 10;
    const length = message.readUInt16BE(read.end + 8);
    if (data + length > message.length) break;
    if (message.readUInt16BE(read.end) === TYPE.A && length === 4) {
      found.push({ name: read.name, address: [...message.subarray(data, data + 4)].join(".") });
    }
    offset = data + length;
  }
  return found;
}

function encodeName(name) {
  const labels = name.split(".").map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label, "latin1")]));
  return Buffer.concat([...labels, Buffer.from([0])]);
}

function header(id, flags, [questions, answers, authority, additional]) {
  const bytes = Buffer.alloc(12);
  bytes.writeUInt16BE(id, 0);
  bytes.writeUInt16BE(flags, 2);
  bytes.writeUInt16BE(questions, 4);
  bytes.writeUInt16BE(answers, 6);
  bytes.writeUInt16BE(authority, 8);
  bytes.writeUInt16BE(additional, 10);
  return bytes;
}

function record(name, type, klass, ttl, data) {
  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(type, 0);
  fixed.writeUInt16BE(klass, 2);
  fixed.writeUInt32BE(ttl, 4);
  fixed.writeUInt16BE(data.length, 8);
  return Buffer.concat([encodeName(name), fixed, data]);
}

const addressRecord = (name, address, ttl, klass) =>
  record(name, TYPE.A, klass, ttl, Buffer.from(address.split(".").map(Number)));

// "This name has an IPv4 address and nothing else" (RFC 6762 section 6.1), so a phone that also
// asks for an IPv6 address gets an answer at once instead of waiting for one.
const onlyAddressRecord = (name) =>
  record(name, TYPE.NSEC, CLASS_IN | CACHE_FLUSH, TTL, Buffer.concat([encodeName(name), Buffer.from([0, 1, 0x40])]));

export function queryFor(name) {
  return Buffer.concat([header(0, 0, [1, 0, 0, 0]), encodeName(name), Buffer.from([0, TYPE.A, 0, CLASS_IN])]);
}

// The answer to one message for `name` at `address`, or null when it doesn't ask for that name.
// One-shot queries (from a port other than 5353, which is how Android asks) get an ordinary DNS
// answer sent straight back. Full mDNS queriers (iPhones, Macs, Windows) get the mDNS form, sent
// to the whole network unless every question asked for a direct answer. `kind` names the records
// answered, for the once-a-second limit on multicast answers.
export function replyTo(message, fromPort, name, address) {
  const query = parseQuery(message);
  if (!query) return null;
  const asked = query.questions.filter(
    (q) => q.name === name && (q.klass === CLASS_IN || q.klass === CLASS_ANY) && [TYPE.A, TYPE.AAAA, TYPE.ANY].includes(q.type),
  );
  if (!asked.length) return null;
  const wantsAddress = asked.some((q) => q.type !== TYPE.AAAA);
  const wantsIpv6 = asked.some((q) => q.type !== TYPE.A);

  if (fromPort !== MDNS_PORT) {
    const answers = wantsAddress ? [addressRecord(name, address, ONE_SHOT_TTL, CLASS_IN)] : [];
    const flags = 0x8400 | (query.flags & 0x0100); // a response, authoritative; echo "recursion desired"
    return {
      packet: Buffer.concat([header(query.id, flags, [query.questions.length, answers.length, 0, 0]), query.questionBytes, ...answers]),
      unicast: true,
      kind: "one-shot",
    };
  }
  const answers = [];
  const additional = [];
  (wantsAddress ? answers : additional).push(addressRecord(name, address, TTL, CLASS_IN | CACHE_FLUSH));
  (wantsIpv6 ? answers : additional).push(onlyAddressRecord(name));
  return {
    packet: Buffer.concat([header(0, 0x8400, [0, answers.length, 0, additional.length]), ...answers, ...additional]),
    unicast: asked.every((q) => q.unicast),
    kind: `${wantsAddress ? "A" : ""}${wantsIpv6 ? "NSEC" : ""}`,
  };
}

// Starts answering for `name` and keeps up with network changes. `onNetwork(net)` runs when this
// PC joins a network after the start. Returns { close() }.
export function answerLocalName(name, { port = MDNS_PORT, log = console.log, onNetwork = () => {} } = {}) {
  let nets = networks();
  const lastMulticast = new Map();
  const warned = new Set();
  const via = (type, net) => (type === "udp4" ? net.address : net.scope && `::%${net.scope}`);
  const groupOn = (type, net) => (type === "udp4" ? GROUP.udp4 : `${GROUP.udp6}%${net.scope}`);

  // Choosing the outgoing network and sending are separate calls, and a send completes later:
  // one send at a time per socket, so each packet leaves on the network chosen for it.
  function sendOn(socket, net, packet, address, toPort = port) {
    socket.queue = socket.queue.then(
      () =>
        new Promise((resolve) => {
          try {
            if (net) socket.setMulticastInterface(via(socket.type, net));
            socket.send(packet, toPort, address, () => resolve());
          } catch {
            resolve(); // closed, or that network just went away
          }
        }),
    );
  }

  function join(socket) {
    if (!socket.ready) return;
    for (const net of nets) {
      const where = via(socket.type, net);
      if (!where) continue;
      try {
        socket.addMembership(GROUP[socket.type], where);
      } catch {
        // already joined, or this network has no multicast
      }
    }
  }

  // Ask once on a network, so a device already answering to the name there shows itself.
  function ask(net, on = sockets) {
    for (const socket of on) {
      if (socket.ready && !net.internal && via(socket.type, net)) sendOn(socket, net, queryFor(name), groupOn(socket.type, net));
    }
  }

  function noticeOthers(message) {
    const mine = new Set(nets.map((net) => net.address));
    for (const { name: answered, address } of parseAddresses(message)) {
      if (answered !== name || mine.has(address) || warned.has(address)) continue;
      warned.add(address);
      log(`  warning: ${address} also answers to ${name}, so phones may open that device instead of this PC.`);
      log(`  Give this PC its own name with RUZZCO_LOCAL_NAME (for example ruzzco-2.local) and install the app from it.`);
    }
  }

  function handle(socket, message, from) {
    if (message.length >= 12 && message[2] & 0x80) {
      noticeOthers(message);
      return;
    }
    const net = networkOf(from, nets);
    if (!net) return;
    const reply = replyTo(message, from.port, name, net.address);
    if (!reply) return;
    if (reply.unicast) {
      sendOn(socket, null, reply.packet, from.address, from.port);
      return;
    }
    // Phones ask for IPv4 and IPv6 addresses separately, a moment apart: each kind of answer has
    // its own once-a-second limit, or the second question would go unanswered.
    const key = `${socket.type} ${net.address} ${reply.kind}`;
    if (Date.now() - (lastMulticast.get(key) ?? 0) < MULTICAST_GAP_MS) return;
    lastMulticast.set(key, Date.now());
    sendOn(socket, net, reply.packet, groupOn(socket.type, net));
  }

  function open(type) {
    const socket = dgram.createSocket({ type, reuseAddr: true, ipv6Only: type === "udp6" });
    Object.assign(socket, { type, ready: false, queue: Promise.resolve() });
    socket.on("error", (error) => {
      // IPv6 is optional (often switched off); without IPv4 phones can't find the name at all.
      if (type === "udp4") log(`  ${name} can't be answered (${error.code ?? error.message}); phones need the number address`);
      socket.ready = false;
      try {
        socket.close();
      } catch {
        // already closed
      }
    });
    socket.on("message", (message, from) => {
      try {
        handle(socket, message, from);
      } catch {
        // a damaged packet: ignore it
      }
    });
    socket.bind(port, () => {
      socket.ready = true;
      socket.setMulticastTTL(255);
      socket.setTTL(255);
      join(socket);
      for (const net of nets) ask(net, [socket]);
    });
    return socket;
  }

  const sockets = [open("udp4"), open("udp6")];

  const timer = setInterval(() => {
    const known = new Set(nets.map((net) => `${net.name} ${net.address}`));
    nets = networks();
    for (const socket of sockets) join(socket);
    for (const net of nets) {
      if (known.has(`${net.name} ${net.address}`) || net.internal) continue;
      ask(net);
      onNetwork(net);
    }
  }, REFRESH_MS);
  timer.unref();

  return {
    close() {
      clearInterval(timer);
      for (const socket of sockets) {
        socket.ready = false;
        try {
          socket.close();
        } catch {
          // already closed
        }
      }
    },
  };
}
