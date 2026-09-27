"use strict";

/*
 * Privacy design:
 * - no fetch / XMLHttpRequest / WebSocket / EventSource / sendBeacon
 * - no cookies / localStorage / sessionStorage / IndexedDB
 * - imported files are read with File.text() and remain only in this tab's memory
 * - index.html enforces connect-src 'none'
 */

const $ = (id) => document.getElementById(id);

const state = {
  lang: "ru",
  generated: {},
  currentFile: null,
  extraExits: [],
  nextExitId: 2
};

const defaults = {
  "wg-port": "51830",
  "s1-wan": "eth0",
  "s2-wan": "eth0",
  "s2-priority": "10",
  "s1-exit-if": "wg-exit",
  "awg-if": "awg0",
  "wg-in-if": "wg-in",
  "mt-if": "wg-awg-proxy-1",
  "route-table": "200",
  "mt-policy-mode": "policy",
  "mt-route-table": "VPN",
  "mt-dst": "0.0.0.0/0",
  "connmark": "CM_VPN",
  "mt-wan-list": "WAN",
  "bfd-interval": "500",
  "bfd-multiplier": "3"
};

function tr(ru, en) {
  return state.lang === "ru" ? ru : en;
}

function setLanguage(lang) {
  state.lang = lang;
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-ru][data-en]").forEach((el) => {
    const value = el.dataset[lang];
    const textNode = Array.from(el.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim() !== "");
    if (el.children.length === 0) {
      el.textContent = value;
    } else if (textNode) {
      textNode.nodeValue = value;
    }
  });
  document.querySelectorAll("[data-placeholder-ru][data-placeholder-en]").forEach((el) => {
    el.placeholder = el.dataset["placeholder" + (lang === "ru" ? "Ru" : "En")];
  });
  $("lang-ru").classList.toggle("active", lang === "ru");
  $("lang-en").classList.toggle("active", lang === "en");
  if ($("extra-exits")) renderExtraExits();
}

function parseWgIni(text) {
  const result = { interface: {}, peers: [] };
  let section = null;
  let currentPeer = null;

  text.replace(/\r/g, "").split("\n").forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) return;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const name = sectionMatch[1].toLowerCase();
      if (name === "interface") {
        section = "interface";
        currentPeer = null;
      } else if (name === "peer") {
        section = "peer";
        currentPeer = {};
        result.peers.push(currentPeer);
      } else {
        section = "unknown";
        currentPeer = null;
      }
      return;
    }

    const eq = line.indexOf("=");
    if (eq < 0) return;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    if (section === "interface") result.interface[key] = value;
    if (section === "peer" && currentPeer) currentPeer[key] = value;
  });

  return result;
}

function firstAddress(value) {
  return String(value || "").split(",")[0].trim();
}

function firstIpv4Address(value) {
  const parts = String(value || "").split(",").map((x) => x.trim());
  return parts.find((x) => parseCidr(x)) || firstAddress(value);
}

function validLinuxInterface(value) {
  return /^[A-Za-z0-9_.:@-]{1,15}$/.test(String(value || ""));
}

function validNameToken(value) {
  return /^[A-Za-z0-9_.-]+$/.test(String(value || ""));
}

function validEndpointHost(value) {
  const v = String(value || "");
  if (!/^[A-Za-z0-9.-]+$/.test(v)) return false;
  if (/^[0-9.]+$/.test(v)) return isIpv4(v);
  return v.length <= 253 && !v.startsWith(".") && !v.endsWith(".") && !v.includes("..");
}

function splitEndpoint(endpoint) {
  const value = String(endpoint || "").trim();
  if (!value) return { host: "", port: "" };

  const ipv6 = value.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6) return { host: ipv6[1], port: ipv6[2] };

  const pos = value.lastIndexOf(":");
  if (pos > 0 && /^\d+$/.test(value.slice(pos + 1))) {
    return { host: value.slice(0, pos), port: value.slice(pos + 1) };
  }
  return { host: value, port: "" };
}

function ipToInt(ip) {
  const parts = String(ip).trim().split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    value = ((value << 8) | n) >>> 0;
  }
  return value >>> 0;
}

function intToIp(value) {
  const v = value >>> 0;
  return [
    (v >>> 24) & 255,
    (v >>> 16) & 255,
    (v >>> 8) & 255,
    v & 255
  ].join(".");
}

function parseCidr(cidr) {
  const m = String(cidr || "").trim().match(/^([^/]+)\/(\d{1,2})$/);
  if (!m) return null;
  const ip = ipToInt(m[1]);
  const prefix = Number(m[2]);
  if (ip === null || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return {
    ip: m[1],
    ipInt: ip,
    prefix,
    mask,
    networkInt: (ip & mask) >>> 0,
    network: intToIp((ip & mask) >>> 0) + "/" + prefix
  };
}

function isIpv4(ip) {
  return ipToInt(ip) !== null;
}

function ipPart(cidr) {
  const parsed = parseCidr(cidr);
  return parsed ? parsed.ip : String(cidr || "").trim();
}

function networkFromCidr(cidr) {
  const parsed = parseCidr(cidr);
  return parsed ? parsed.network : "";
}

function isIpInNetwork(ip, cidr) {
  const address = ipToInt(ip);
  const net = parseCidr(cidr);
  if (address === null || !net) return false;
  return ((address & net.mask) >>> 0) === net.networkInt;
}

function sameSubnet(a, b) {
  const aa = parseCidr(a);
  const bb = parseCidr(b);
  if (!aa || !bb || aa.prefix !== bb.prefix) return false;
  return aa.networkInt === bb.networkInt;
}

function safeToken(value) {
  return typeof value === "string" && value.length > 0 && !/[\r\n"]/u.test(value);
}

function validWgKey(value) {
  return /^[A-Za-z0-9+/]{43}=$/.test(String(value || "").trim());
}

function parseDirectRouteDestinations(raw) {
  const tokens = String(raw || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const values = [];
  const invalid = [];

  for (const token of tokens) {
    let normalized = "";
    if (isIpv4(token)) {
      normalized = token + "/32";
    } else {
      const parsed = parseCidr(token);
      if (parsed) normalized = parsed.network;
    }

    if (!normalized) {
      invalid.push(token);
      continue;
    }

    if (!values.includes(normalized)) values.push(normalized);
  }

  return { values, invalid };
}

function updateMikrotikMode() {
  const mode = $("mt-policy-mode").value || "policy";
  $("mt-policy-fields").classList.toggle("hidden", mode !== "policy");
  $("mt-direct-fields").classList.toggle("hidden", mode !== "direct");
}

function setStatus(id, kind, text) {
  const el = $(id);
  el.className = "status " + kind;
  el.textContent = text;
}

function importConfig(role, text) {
  if (!text.trim()) {
    setStatus("status-" + role, "bad", tr("Конфигурация пуста", "Configuration is empty"));
    return;
  }

  const parsed = parseWgIni(text);
  const peer = parsed.peers[0] || {};

  if (role === "s1") {
    if (parsed.interface.Address) $("s1-address").value = firstIpv4Address(parsed.interface.Address);
    if (parsed.interface.PrivateKey) $("s1-private").value = parsed.interface.PrivateKey;
    if (parsed.interface.MTU) $("s1-mtu").value = parsed.interface.MTU;
    if (peer.PublicKey) $("s2-public").value = peer.PublicKey;
    if (peer.PresharedKey) $("s1-psk").value = peer.PresharedKey;
    if (peer.Endpoint) {
      const ep = splitEndpoint(peer.Endpoint);
      if (ep.host) $("s2-endpoint").value = ep.host;
      if (ep.port) $("wg-port").value = ep.port;
    }
  }

  if (role === "s2") {
    if (parsed.interface.Address) $("s2-address").value = firstIpv4Address(parsed.interface.Address);
    if (parsed.interface.PrivateKey) $("s2-private").value = parsed.interface.PrivateKey;
    if (parsed.interface.ListenPort) $("wg-port").value = parsed.interface.ListenPort;
    if (parsed.interface.MTU) $("s2-mtu").value = parsed.interface.MTU;
    if (peer.PublicKey) $("s1-public").value = peer.PublicKey;
    if (peer.PresharedKey) $("s2-psk").value = peer.PresharedKey;
  }

  if (role === "in") {
    const address = firstIpv4Address(parsed.interface.Address);
    const cidr = parseCidr(address);
    if (cidr) {
      $("awg-server").value = cidr.ip;
      $("awg-net").value = cidr.network;
    }

    for (const p of parsed.peers) {
      const allowed = String(p.AllowedIPs || "").split(",").map((x) => x.trim());
      const host = allowed.find((x) => /\/32$/.test(x) && parseCidr(x));
      if (host) {
        $("awg-mt").value = ipPart(host);
        break;
      }
    }
  }

  if (role === "wgin") {
    const address = firstIpv4Address(parsed.interface.Address);
    const cidr = parseCidr(address);
    if (cidr) {
      $("wg-in-address").value = address;
      $("wg-in-net").value = cidr.network;
    }
    if (parsed.interface.ListenPort) $("wg-in-port").value = parsed.interface.ListenPort;
    if (parsed.interface.PrivateKey) $("wg-in-private").value = parsed.interface.PrivateKey;
    if (peer.PublicKey) $("wg-in-peer-public").value = peer.PublicKey;
    if (peer.PresharedKey) $("wg-in-psk").value = peer.PresharedKey;
    if (peer.AllowedIPs) $("wg-in-peer-allowed").value = peer.AllowedIPs;
  }

  setStatus(
    "status-" + role,
    "good",
    tr(
      "Разобрано: Interface + " + parsed.peers.length + " Peer",
      "Parsed: Interface + " + parsed.peers.length + " Peer"
    )
  );
  updateSecretVisibility();
}

function newExtraExit(initial = {}) {
  const id = state.nextExitId++;
  return Object.assign({
    id,
    label: "Server2 #" + id,
    priority: String(id * 10),
    s1Interface: "wg-exit" + id,
    s1Address: "",
    s2Address: "",
    endpoint: "",
    port: "51830",
    s1Private: "",
    s1Public: "",
    s2Private: "",
    s2Public: "",
    psk1: "",
    psk2: "",
    s1Mtu: "",
    s2Mtu: "",
    s2Wan: "eth0",
    s1Text: "",
    s2Text: ""
  }, initial);
}

function updateExtraExit(id, field, value) {
  const exit = state.extraExits.find((item) => item.id === id);
  if (!exit) return;
  exit[field] = value;
}

function parseExtraExitSide(id, side, text) {
  const exit = state.extraExits.find((item) => item.id === id);
  if (!exit) return;

  const parsed = parseWgIni(text);
  const peer = parsed.peers[0] || {};

  if (side === "s1") {
    exit.s1Text = text;
    if (parsed.interface.Address) exit.s1Address = firstIpv4Address(parsed.interface.Address);
    if (parsed.interface.PrivateKey) exit.s1Private = parsed.interface.PrivateKey;
    if (parsed.interface.MTU) exit.s1Mtu = parsed.interface.MTU;
    if (peer.PublicKey) exit.s2Public = peer.PublicKey;
    if (peer.PresharedKey) exit.psk1 = peer.PresharedKey;
    if (peer.Endpoint) {
      const ep = splitEndpoint(peer.Endpoint);
      if (ep.host) exit.endpoint = ep.host;
      if (ep.port) exit.port = ep.port;
    }
  } else {
    exit.s2Text = text;
    if (parsed.interface.Address) exit.s2Address = firstIpv4Address(parsed.interface.Address);
    if (parsed.interface.PrivateKey) exit.s2Private = parsed.interface.PrivateKey;
    if (parsed.interface.ListenPort) exit.port = parsed.interface.ListenPort;
    if (parsed.interface.MTU) exit.s2Mtu = parsed.interface.MTU;
    if (peer.PublicKey) exit.s1Public = peer.PublicKey;
    if (peer.PresharedKey) exit.psk2 = peer.PresharedKey;
  }

  renderExtraExits();
}

function createExtraField(exit, field, labelText, type = "text", placeholder = "") {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = type;
  input.value = exit[field] || "";
  input.placeholder = placeholder;
  if (type === "number") input.min = field === "priority" ? "1" : "1";
  input.addEventListener("input", () => updateExtraExit(exit.id, field, input.value));
  label.appendChild(input);
  return label;
}

function renderExtraExits() {
  const root = $("extra-exits");
  root.innerHTML = "";

  state.extraExits.forEach((exit) => {
    const card = document.createElement("div");
    card.className = "import-box extra-exit-card";

    const head = document.createElement("div");
    head.className = "extra-exit-head";
    const title = document.createElement("h3");
    title.textContent = exit.label || ("Server2 #" + exit.id);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger small";
    remove.textContent = tr("Удалить", "Remove");
    remove.addEventListener("click", () => {
      state.extraExits = state.extraExits.filter((item) => item.id !== exit.id);
      renderExtraExits();
    });
    head.appendChild(title);
    head.appendChild(remove);
    card.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "grid form-grid";
    [
      ["label", tr("Имя/метка", "Name/label"), "text", "backup-eu"],
      ["priority", tr("Приоритет (меньше = выше)", "Priority (lower = preferred)"), "number", "20"],
      ["s1Interface", tr("Интерфейс Server1", "Server1 interface"), "text", "wg-exit2"],
      ["s1Address", "Server1 wg-exit Address", "text", "10.10.20.1/30"],
      ["s2Address", "Server2 wg-exit Address", "text", "10.10.20.2/30"],
      ["endpoint", tr("Публичный endpoint Server2", "Server2 public endpoint"), "text", "vpn2.example.net"],
      ["port", "wg-exit UDP port", "number", "51830"],
      ["s2Wan", "Server2 WAN interface", "text", "eth0"],
      ["s1Mtu", "Server1 MTU (optional)", "number", "1420"],
      ["s2Mtu", "Server2 MTU (optional)", "number", "1420"]
    ].forEach(([field, labelText, type, placeholder]) => grid.appendChild(createExtraField(exit, field, labelText, type, placeholder)));
    card.appendChild(grid);

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = tr("WireGuard ключи и импорт конфигов", "WireGuard keys and config import");
    details.appendChild(summary);

    const importGrid = document.createElement("div");
    importGrid.className = "grid two";

    for (const side of ["s1", "s2"]) {
      const box = document.createElement("div");
      box.className = "import-box";
      const h = document.createElement("h4");
      h.textContent = side === "s1" ? "Server1 side" : "Server2 side";
      const file = document.createElement("input");
      file.type = "file";
      file.accept = ".conf,.txt";
      const ta = document.createElement("textarea");
      ta.rows = 7;
      ta.spellcheck = false;
      ta.value = side === "s1" ? exit.s1Text : exit.s2Text;
      ta.placeholder = side === "s1" ? "wg-exit.conf on Server1" : "wg-exit.conf on Server2";
      ta.addEventListener("input", () => updateExtraExit(exit.id, side === "s1" ? "s1Text" : "s2Text", ta.value));
      file.addEventListener("change", async () => {
        const selected = file.files && file.files[0];
        if (!selected) return;
        const text = await selected.text();
        ta.value = text;
        parseExtraExitSide(exit.id, side, text);
      });
      const parse = document.createElement("button");
      parse.type = "button";
      parse.className = "secondary";
      parse.textContent = tr("Разобрать", "Parse");
      parse.addEventListener("click", () => parseExtraExitSide(exit.id, side, ta.value));
      box.appendChild(h);
      box.appendChild(file);
      box.appendChild(ta);
      box.appendChild(parse);
      importGrid.appendChild(box);
    }
    details.appendChild(importGrid);

    const keyGrid = document.createElement("div");
    keyGrid.className = "grid form-grid";
    [
      ["s1Private", "Server1 PrivateKey"],
      ["s1Public", "Server1 PublicKey"],
      ["s2Private", "Server2 PrivateKey"],
      ["s2Public", "Server2 PublicKey"],
      ["psk1", "Server1 Peer PresharedKey"],
      ["psk2", "Server2 Peer PresharedKey"]
    ].forEach(([field, labelText]) => {
      const label = document.createElement("label");
      label.textContent = labelText;
      const input = document.createElement("input");
      input.type = $("show-secrets").checked ? "text" : "password";
      input.autocomplete = "off";
      input.value = exit[field] || "";
      input.addEventListener("input", () => updateExtraExit(exit.id, field, input.value));
      label.appendChild(input);
      keyGrid.appendChild(label);
    });
    details.appendChild(keyGrid);
    card.appendChild(details);
    root.appendChild(card);
  });
}

function getExitConfigs() {
  const primary = {
    id: 1,
    label: "Server2 #1",
    priority: Number(value("s2-priority")),
    s1Interface: value("s1-exit-if"),
    s1Address: value("s1-address"),
    s2Address: value("s2-address"),
    endpoint: value("s2-endpoint"),
    port: value("wg-port"),
    s1Private: value("s1-private"),
    s1Public: value("s1-public"),
    s2Private: value("s2-private"),
    s2Public: value("s2-public"),
    psk1: value("s1-psk"),
    psk2: value("s2-psk"),
    s1Mtu: value("s1-mtu"),
    s2Mtu: value("s2-mtu"),
    s2Wan: value("s2-wan"),
    outputDir: "server2"
  };

  const extras = state.extraExits.map((exit, index) => Object.assign({}, exit, {
    priority: Number(exit.priority),
    outputDir: "server2-" + (index + 2)
  }));

  return [primary, ...extras];
}

function validateExit(exit, add) {
  const prefix = exit.label || ("Server2 #" + exit.id);
  const s1 = parseCidr(exit.s1Address);
  const s2 = parseCidr(exit.s2Address);

  if (!Number.isInteger(exit.priority) || exit.priority < 1) add("bad", prefix + ": приоритет должен быть положительным целым", prefix + ": priority must be a positive integer");
  if (!validLinuxInterface(exit.s1Interface)) add("bad", prefix + ": неверное имя интерфейса Server1", prefix + ": invalid Server1 interface name");
  if (!s1 || !s2 || !sameSubnet(exit.s1Address, exit.s2Address)) add("bad", prefix + ": адреса wg-exit должны быть в одной IPv4 подсети", prefix + ": wg-exit addresses must share one IPv4 subnet");
  if (!validEndpointHost(exit.endpoint)) add("bad", prefix + ": неверный endpoint", prefix + ": invalid endpoint");

  const port = Number(exit.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) add("bad", prefix + ": UDP port должен быть 1..65535", prefix + ": UDP port must be 1..65535");

  if (!validLinuxInterface(exit.s2Wan)) add("bad", prefix + ": неверный Server2 WAN interface", prefix + ": invalid Server2 WAN interface");
  if (!validWgKey(exit.s1Private)) add("bad", prefix + ": неверный Server1 PrivateKey", prefix + ": invalid Server1 PrivateKey");
  if (!validWgKey(exit.s1Public)) add("bad", prefix + ": неверный Server1 PublicKey", prefix + ": invalid Server1 PublicKey");
  if (!validWgKey(exit.s2Private)) add("bad", prefix + ": неверный Server2 PrivateKey", prefix + ": invalid Server2 PrivateKey");
  if (!validWgKey(exit.s2Public)) add("bad", prefix + ": неверный Server2 PublicKey", prefix + ": invalid Server2 PublicKey");

  if (exit.psk1 || exit.psk2) {
    if (!validWgKey(exit.psk1) || !validWgKey(exit.psk2)) add("bad", prefix + ": PresharedKey должен быть задан с обеих сторон", prefix + ": PresharedKey must be present on both sides");
    else if (exit.psk1 !== exit.psk2) add("bad", prefix + ": PresharedKey не совпадает", prefix + ": PresharedKey values do not match");
  }

  for (const [label, mtu] of [["Server1 MTU", exit.s1Mtu], ["Server2 MTU", exit.s2Mtu]]) {
    if (!mtu) continue;
    const n = Number(mtu);
    if (!Number.isInteger(n) || n < 576 || n > 65535) add("bad", prefix + ": " + label + " должен быть 576..65535", prefix + ": " + label + " must be 576..65535");
  }
}

async function readSelectedFile(inputId, textareaId, role) {
  const input = $(inputId);
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    $(textareaId).value = text;
    importConfig(role, text);
  } catch (err) {
    setStatus("status-" + role, "bad", tr("Ошибка чтения файла", "Unable to read file"));
  }
}

function value(id) {
  return $(id).value.trim();
}

function validate() {
  const checks = [];
  const add = (level, ru, en) => checks.push({ level, text: tr(ru, en) });

  const s1 = parseCidr(value("s1-address"));
  const s2 = parseCidr(value("s2-address"));
  if (!s1) add("bad", "Server1 wg-exit Address должен быть IPv4/CIDR", "Server1 wg-exit Address must be IPv4/CIDR");
  else add("good", "Server1 wg-exit Address корректен", "Server1 wg-exit Address is valid");

  if (!s2) add("bad", "Server2 wg-exit Address должен быть IPv4/CIDR", "Server2 wg-exit Address must be IPv4/CIDR");
  else add("good", "Server2 wg-exit Address корректен", "Server2 wg-exit Address is valid");

  if (s1 && s2) {
    if (sameSubnet(value("s1-address"), value("s2-address"))) {
      add("good", "Server1 и Server2 находятся в одной wg-exit подсети", "Server1 and Server2 are in the same wg-exit subnet");
    } else {
      add("bad", "Server1 и Server2 должны находиться в одной подсети с одинаковым prefix", "Server1 and Server2 must be in the same subnet with the same prefix");
    }
  }

  if (validWgKey(value("s1-private"))) add("good", "PrivateKey Server1 имеет ожидаемый WireGuard-формат", "Server1 PrivateKey has the expected WireGuard format");
  else add("bad", "Не задан корректный PrivateKey Server1", "A valid Server1 PrivateKey is required");

  if (validWgKey(value("s2-private"))) add("good", "PrivateKey Server2 имеет ожидаемый WireGuard-формат", "Server2 PrivateKey has the expected WireGuard format");
  else add("bad", "Не задан корректный PrivateKey Server2", "A valid Server2 PrivateKey is required");

  if (validWgKey(value("s1-public"))) add("good", "PublicKey Server1 получен", "Server1 PublicKey is present");
  else add("bad", "Не задан корректный PublicKey Server1", "A valid Server1 PublicKey is required");

  if (validWgKey(value("s2-public"))) add("good", "PublicKey Server2 получен", "Server2 PublicKey is present");
  else add("bad", "Не задан корректный PublicKey Server2", "A valid Server2 PublicKey is required");

  if (validEndpointHost(value("s2-endpoint"))) add("good", "Endpoint Server2 задан", "Server2 endpoint is present");
  else add("bad", "Endpoint Server2 должен быть IPv4 или DNS-именем без порта", "Server2 endpoint must be an IPv4 address or DNS name without a port");

  const port = Number(value("wg-port"));
  if (Number.isInteger(port) && port >= 1 && port <= 65535) add("good", "UDP port корректен", "UDP port is valid");
  else add("bad", "UDP port должен быть 1..65535", "UDP port must be 1..65535");

  const awgNet = parseCidr(value("awg-net"));
  if (!awgNet) add("bad", "VPN client subnet должен быть IPv4/CIDR", "VPN client subnet must be IPv4/CIDR");
  else add("good", "VPN client subnet корректен", "VPN client subnet is valid");

  if (isIpv4(value("awg-server")) && awgNet && isIpInNetwork(value("awg-server"), value("awg-net"))) {
    add("good", "Server1 AWG IP находится в client subnet", "Server1 AWG IP is inside the client subnet");
  } else {
    add("bad", "Server1 AWG IP должен быть IPv4 внутри VPN client subnet", "Server1 AWG IP must be IPv4 inside the VPN client subnet");
  }

  if (isIpv4(value("awg-mt")) && awgNet && isIpInNetwork(value("awg-mt"), value("awg-net"))) {
    add("good", "MikroTik AWG IP находится в client subnet", "MikroTik AWG IP is inside the client subnet");
  } else {
    add("bad", "MikroTik AWG IP должен быть IPv4 внутри VPN client subnet", "MikroTik AWG IP must be IPv4 inside the VPN client subnet");
  }

  if (value("awg-server") && value("awg-mt") && value("awg-server") === value("awg-mt")) {
    add("bad", "AWG IP Server1 и MikroTik не могут совпадать", "Server1 and MikroTik AWG IPs cannot be identical");
  }

  const wgInNet = value("wg-in-net");
  if (wgInNet && !parseCidr(wgInNet)) add("bad", "Дополнительный WG client subnet некорректен", "Additional WG client subnet is invalid");
  else if (wgInNet) add("good", "Дополнительный WG client subnet будет добавлен", "Additional WG client subnet will be included");

  const wgInAddress = value("wg-in-address");
  const wgInPort = value("wg-in-port");
  const wgInPrivate = value("wg-in-private");
  const wgInPeerPublic = value("wg-in-peer-public");
  const wgInPeerAllowed = value("wg-in-peer-allowed");
  const wgInPsk = value("wg-in-psk");
  const wgInAny = [wgInAddress, wgInPort, wgInPrivate, wgInPeerPublic, wgInPeerAllowed, wgInPsk].some(Boolean);

  if (wgInAny) {
    const parsedWgIn = parseCidr(wgInAddress);
    if (!parsedWgIn) add("bad", "wg-in Address должен быть IPv4/CIDR", "wg-in Address must be IPv4/CIDR");
    else {
      add("good", "wg-in Address корректен", "wg-in Address is valid");
      if (wgInNet && parsedWgIn.network !== networkFromCidr(wgInNet)) {
        add("bad", "wg-in Address и WG client subnet должны относиться к одной подсети", "wg-in Address and WG client subnet must describe the same subnet");
      }
    }

    const wgiPortNum = Number(wgInPort);
    if (!Number.isInteger(wgiPortNum) || wgiPortNum < 1 || wgiPortNum > 65535) add("bad", "wg-in ListenPort должен быть 1..65535", "wg-in ListenPort must be 1..65535");
    if (!validWgKey(wgInPrivate)) add("bad", "Нужен корректный wg-in PrivateKey", "A valid wg-in PrivateKey is required");
    if (!validWgKey(wgInPeerPublic)) add("bad", "Нужен корректный wg-in Peer PublicKey", "A valid wg-in Peer PublicKey is required");
    if (!wgInPeerAllowed || wgInPeerAllowed.split(",").map((x) => x.trim()).some((x) => !parseCidr(x))) {
      add("bad", "wg-in Peer AllowedIPs должны содержать IPv4/CIDR", "wg-in Peer AllowedIPs must contain IPv4/CIDR values");
    }
    if (wgInPsk && !validWgKey(wgInPsk)) add("bad", "wg-in PresharedKey имеет неверный формат", "wg-in PresharedKey has an invalid format");
    if (!wgInNet) add("bad", "Для wg-in требуется WG client subnet", "WG client subnet is required for wg-in");
  }

  ["s1-wan", "s2-wan", "awg-if", "s1-exit-if"].forEach((id) => {
    if (validLinuxInterface(value(id))) add("good", id + " задан", id + " is set");
    else add("bad", id + " должен быть корректным Linux interface name (до 15 символов)", id + " must be a valid Linux interface name (up to 15 characters)");
  });

  if (!safeToken(value("mt-if"))) add("bad", "MikroTik interface не задан или содержит кавычки/перенос строки", "MikroTik interface is missing or contains quotes/newlines");
  else add("good", "MikroTik interface задан", "MikroTik interface is set");

  if (wgInNet && !validLinuxInterface(value("wg-in-if"))) {
    add("bad", "Нужно корректное имя дополнительного WG интерфейса", "A valid additional WG interface name is required");
  }

  const mtPolicyMode = value("mt-policy-mode") || "policy";
  if (!["policy", "direct"].includes(mtPolicyMode)) {
    add("bad", "Неизвестный режим маршрутизации MikroTik", "Unknown MikroTik routing mode");
  }

  if (mtPolicyMode === "policy") {
    if (!parseCidr(value("mt-dst"))) add("bad", "MikroTik dst-address должен быть IPv4/CIDR", "MikroTik dst-address must be IPv4/CIDR");
    else add("good", "MikroTik dst-address корректен", "MikroTik dst-address is valid");

    if (!validNameToken(value("mt-route-table"))) add("bad", "Имя MikroTik routing table некорректно", "MikroTik routing table name is invalid");
    else if (value("mt-route-table") === "main") add("bad", "В режиме address-list + mangle нужна отдельная routing table, например VPN. Используйте direct mode, если маршруты должны находиться в main.", "Address-list + mangle mode requires a dedicated routing table such as VPN. Use direct mode if routes should live in main.");
    if (!validNameToken(value("connmark"))) add("bad", "Connection mark некорректен", "Connection mark is invalid");

    const mtAddressLists = value("mt-address-lists").split(",").map((x) => x.trim()).filter(Boolean);
    if (!mtAddressLists.length) {
      add("bad", "В режиме address-list нужно указать хотя бы один dst-address-list", "Address-list mode requires at least one dst-address-list");
    } else if (mtAddressLists.some((name) => !safeToken(name))) {
      add("bad", "MikroTik address-list содержит недопустимые кавычки или перенос строки", "MikroTik address-list contains quotes or newlines");
    } else {
      add("good", "MikroTik policy selectors будут сгенерированы для " + mtAddressLists.length + " address-list", "MikroTik policy selectors will be generated for " + mtAddressLists.length + " address-list value(s)");
    }

    if (!validNameToken(value("mt-wan-list"))) add("bad", "MikroTik WAN interface-list некорректен", "MikroTik WAN interface-list is invalid");
  }

  if (mtPolicyMode === "direct") {
    const direct = parseDirectRouteDestinations(value("mt-direct-routes"));
    if (direct.invalid.length) {
      add("bad", "Некорректные назначения прямых маршрутов: " + direct.invalid.join(", "), "Invalid direct-route destinations: " + direct.invalid.join(", "));
    }
    if (!direct.values.length) {
      add("bad", "В режиме прямых маршрутов нужно указать хотя бы один IP или CIDR", "Direct-route mode requires at least one IP or CIDR");
    } else if (!direct.invalid.length) {
      add("good", "Будет создано прямых маршрутов: " + direct.values.length, "Direct routes to generate: " + direct.values.length);
    }
    add("warn", "В режиме прямых маршрутов mangle, connection-mark и selective conntrack cleanup на MikroTik не создаются", "Direct-route mode does not generate mangle, connection marks, or selective MikroTik conntrack cleanup");
  }

  const exits = getExitConfigs();
  const primaryPriority = Number(value("s2-priority"));
  if (!Number.isInteger(primaryPriority) || primaryPriority < 1) {
    add("bad", "Приоритет основного Server2 должен быть положительным целым", "Primary Server2 priority must be a positive integer");
  }

  state.extraExits.forEach((exit) => validateExit(Object.assign({}, exit, { priority: Number(exit.priority) }), add));

  const priorities = exits.map((exit) => exit.priority);
  if (priorities.some((p) => !Number.isInteger(p) || p < 1)) {
    add("bad", "Все приоритеты Server2 должны быть положительными целыми", "All Server2 priorities must be positive integers");
  } else if (new Set(priorities).size !== priorities.length) {
    add("bad", "Приоритеты Server2 должны быть уникальными", "Server2 priorities must be unique");
  } else if (exits.length > 1) {
    add("good", "Настроено выходных Server2: " + exits.length, "Configured Server2 exits: " + exits.length);
  }

  const exitInterfaces = exits.map((exit) => exit.s1Interface);
  if (new Set(exitInterfaces).size !== exitInterfaces.length) {
    add("bad", "Интерфейсы Server1 для разных Server2 должны иметь уникальные имена", "Server1 interfaces for different Server2 exits must be unique");
  }

  const exitNetworks = exits.map((exit) => networkFromCidr(exit.s1Address)).filter(Boolean);
  if (new Set(exitNetworks).size !== exitNetworks.length) {
    add("bad", "Каждый wg-exit должен использовать отдельную transfer subnet", "Each wg-exit must use a distinct transfer subnet");
  }

  const table = Number(value("route-table"));
  if (Number.isInteger(table) && table > 0) {
    add("good", "Linux routing table корректна", "Linux routing table is valid");
    if (table + exits.length - 1 > 2147483647) add("bad", "Диапазон Linux routing tables выходит за допустимые значения", "Linux routing-table range is too large");
  } else add("bad", "Linux routing table должна быть положительным числом", "Linux routing table must be a positive integer");

  const s1Mtu = value("s1-mtu");
  const s2Mtu = value("s2-mtu");
  for (const [label, mtu] of [["Server1 MTU", s1Mtu], ["Server2 MTU", s2Mtu]]) {
    if (!mtu) continue;
    const n = Number(mtu);
    if (Number.isInteger(n) && n >= 576 && n <= 65535) add("good", label + " принят", label + " accepted");
    else add("bad", label + " должен быть 576..65535", label + " must be 576..65535");
  }

  const psk1 = value("s1-psk");
  const psk2 = value("s2-psk");
  if (psk1 || psk2) {
    if (!validWgKey(psk1) || !validWgKey(psk2)) {
      add("bad", "PresharedKey должен быть задан на обеих сторонах в WireGuard-формате", "PresharedKey must be present on both sides in WireGuard format");
    } else if (psk1 !== psk2) {
      add("bad", "PresharedKey Server1 и Server2 не совпадают", "Server1 and Server2 PresharedKey values do not match");
    } else {
      add("good", "PresharedKey согласован на обеих сторонах", "PresharedKey matches on both sides");
    }
  }

  const interval = Number(value("bfd-interval"));
  const mult = Number(value("bfd-multiplier"));
  if (interval >= 50 && Number.isFinite(interval)) add("good", "BFD interval принят", "BFD interval accepted");
  else add("bad", "BFD interval должен быть не менее 50 ms", "BFD interval must be at least 50 ms");

  if (Number.isInteger(mult) && mult >= 2 && mult <= 50) add("good", "BFD multiplier принят", "BFD multiplier accepted");
  else add("bad", "BFD multiplier должен быть 2..50", "BFD multiplier must be 2..50");

  if (s1 && s2 && sameSubnet(value("s1-address"), value("s2-address"))) {
    add("good", "BFD peer Server2 непосредственно достижим через wg-exit", "Server2 BFD peer is directly reachable through wg-exit");
  }

  renderValidation(checks);
  return { ok: !checks.some((c) => c.level === "bad"), checks };
}

function renderValidation(checks) {
  const root = $("validation");
  root.innerHTML = "";
  checks.forEach((check) => {
    const line = document.createElement("div");
    line.className = "checkline " + check.level;
    line.textContent = (check.level === "good" ? "✓ " : check.level === "warn" ? "! " : "✗ ") + check.text;
    root.appendChild(line);
  });
}

function qRouter(value) {
  return '"' + String(value).replace(/"/g, "") + '"';
}

function generateFiles() {
  const check = validate();
  if (!check.ok) {
    $("validation").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const s1Addr = value("s1-address");
  const s2Addr = value("s2-address");
  const s1Ip = ipPart(s1Addr);
  const s2Ip = ipPart(s2Addr);
  const s1Private = value("s1-private");
  const s2Private = value("s2-private");
  const s1Psk = value("s1-psk");
  const s2Psk = value("s2-psk");
  const s1Mtu = value("s1-mtu");
  const s2Mtu = value("s2-mtu");
  const s1Public = value("s1-public");
  const s2Public = value("s2-public");
  const endpoint = value("s2-endpoint");
  const port = value("wg-port");
  const s1Wan = value("s1-wan");
  const s2Wan = value("s2-wan");
  const awgServer = value("awg-server");
  const awgMt = value("awg-mt");
  const awgNet = value("awg-net");
  const wgInNet = value("wg-in-net");
  const wgInAddress = value("wg-in-address");
  const wgInPort = value("wg-in-port");
  const wgInPrivate = value("wg-in-private");
  const wgInPeerPublic = value("wg-in-peer-public");
  const wgInPeerAllowed = value("wg-in-peer-allowed");
  const wgInPsk = value("wg-in-psk");
  const awgIf = value("awg-if");
  const s1ExitIf = value("s1-exit-if") || "wg-exit";
  const wgInIf = value("wg-in-if") || "wg-in";
  const hasWgInConfig = Boolean(wgInAddress && wgInPort && wgInPrivate && wgInPeerPublic && wgInPeerAllowed);
  const mtIf = value("mt-if");
  const table = value("route-table");
  const mtPolicyMode = value("mt-policy-mode") || "policy";
  const mtTable = value("mt-route-table");
  const dedicatedMtTable = Boolean(mtTable) && mtTable !== "main";
  const mtDst = value("mt-dst");
  const connmark = value("connmark");
  const mtWanList = value("mt-wan-list");
  const mtAddressLists = value("mt-address-lists").split(",").map((x) => x.trim()).filter(Boolean);
  const mtDirectRoutes = parseDirectRouteDestinations(value("mt-direct-routes")).values;
  const bfd = value("bfd-interval");
  const mult = value("bfd-multiplier");

  const exits = getExitConfigs()
    .sort((a, b) => a.priority - b.priority || a.id - b.id)
    .map((exit, rank) => Object.assign({}, exit, {
      rank,
      tableId: Number(table) + rank,
      s1Ip: ipPart(exit.s1Address),
      s2Ip: ipPart(exit.s2Address)
    }));
  const primaryExit = exits.find((exit) => exit.id === 1);

  const allowedServer2 = [s1Ip + "/32", awgNet];
  if (wgInNet) allowedServer2.push(wgInNet);

  const policyExtraStart = wgInNet && !hasWgInConfig
    ? "\nExecStart=/bin/sh -c '/usr/sbin/ip rule show | grep -Fq \"iif " + wgInIf + " lookup " + table + "\" || /usr/sbin/ip rule add priority 1001 iif " + wgInIf + " lookup " + table + "'"
    : "";
  const policyExtraStop = wgInNet && !hasWgInConfig
    ? "\nExecStop=/bin/sh -c '/usr/sbin/ip rule del priority 1001 iif " + wgInIf + " lookup " + table + " 2>/dev/null || true'"
    : "";

  const monitorExtra = wgInNet
    ? "\n    conntrack -D -s " + wgInNet + " >/dev/null 2>&1 || true"
    : "";

  const s1MtuLine = s1Mtu ? "\nMTU = " + s1Mtu : "";
  const s2MtuLine = s2Mtu ? "\nMTU = " + s2Mtu : "";
  const pskLine = s1Psk && s2Psk && s1Psk === s2Psk ? "\nPresharedKey = " + s1Psk : "";

  const server2NatExtra = wgInNet
    ? "\nPostUp = iptables -t nat -C POSTROUTING -s " + wgInNet + " -o " + s2Wan + " -m comment --comment wg-exit-failover -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s " + wgInNet + " -o " + s2Wan + " -m comment --comment wg-exit-failover -j MASQUERADE" +
      "\nPostDown = iptables -t nat -D POSTROUTING -s " + wgInNet + " -o " + s2Wan + " -m comment --comment wg-exit-failover -j MASQUERADE 2>/dev/null || true"
    : "";

  const fallbackNatExtraStart = wgInNet
    ? "\nExecStart=/bin/sh -c '/usr/sbin/iptables -t nat -C POSTROUTING -s " + wgInNet + " -o " + s1Wan + " -m comment --comment vpn-failover-fallback -j MASQUERADE 2>/dev/null || /usr/sbin/iptables -t nat -A POSTROUTING -s " + wgInNet + " -o " + s1Wan + " -m comment --comment vpn-failover-fallback -j MASQUERADE'"
      + (!hasWgInConfig
        ? "\nExecStart=/bin/sh -c '/usr/sbin/iptables -C FORWARD -i " + wgInIf + " -o " + wgInIf + " -m comment --comment vpn-failover-forward -j DROP 2>/dev/null || /usr/sbin/iptables -I FORWARD 1 -i " + wgInIf + " -o " + wgInIf + " -m comment --comment vpn-failover-forward -j DROP'"
          + "\nExecStart=/bin/sh -c '/usr/sbin/iptables -C FORWARD -i " + wgInIf + " -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || /usr/sbin/iptables -I FORWARD 2 -i " + wgInIf + " -m comment --comment vpn-failover-forward -j ACCEPT'"
          + "\nExecStart=/bin/sh -c '/usr/sbin/iptables -C FORWARD -o " + wgInIf + " -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || /usr/sbin/iptables -I FORWARD 3 -o " + wgInIf + " -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment vpn-failover-forward -j ACCEPT'"
        : "")
    : "";
  const fallbackNatExtraStop = wgInNet
    ? "\nExecStop=/bin/sh -c '/usr/sbin/iptables -t nat -D POSTROUTING -s " + wgInNet + " -o " + s1Wan + " -m comment --comment vpn-failover-fallback -j MASQUERADE 2>/dev/null || true'"
      + (!hasWgInConfig
        ? "\nExecStop=/bin/sh -c '/usr/sbin/iptables -D FORWARD -o " + wgInIf + " -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || true'"
          + "\nExecStop=/bin/sh -c '/usr/sbin/iptables -D FORWARD -i " + wgInIf + " -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || true'"
          + "\nExecStop=/bin/sh -c '/usr/sbin/iptables -D FORWARD -i " + wgInIf + " -o " + wgInIf + " -m comment --comment vpn-failover-forward -j DROP 2>/dev/null || true'"
        : "")
    : "";

  const routingTableClause = mtTable && mtTable !== "main" ? " routing-table=" + qRouter(mtTable) : "";
  const routingTableEnsure = mtTable && mtTable !== "main"
    ? ":if ([:len [/routing table find where name=" + qRouter(mtTable) + "]] = 0) do={ /routing table add fib name=" + qRouter(mtTable) + " }\n\n"
    : "";

  let mikrotikPolicyBlock = "";
  if (mtPolicyMode === "policy" && mtAddressLists.length) {
    mikrotikPolicyBlock += "\n# Policy selectors generated from destination address-lists.\n/ip firewall mangle\n";
    for (const listName of mtAddressLists) {
      mikrotikPolicyBlock += "add chain=prerouting action=mark-connection new-connection-mark=" + qRouter(connmark) +
        " passthrough=yes connection-state=new dst-address-type=!local dst-address-list=" + qRouter(listName) +
        " comment=" + qRouter("VPN_POLICY_MARK") + "\n";
    }
    // In RouterOS v7 new-routing-mark must refer to an existing routing table.
    // Use the actual table name. With the default policy-rules order, a failed
    // mangle-table lookup continues to user rules and then main.
    mikrotikPolicyBlock += "add chain=prerouting action=mark-routing new-routing-mark=" + qRouter(mtTable) +
      " passthrough=yes connection-mark=" + qRouter(connmark) +
      " dst-address-type=!local in-interface-list=!" + mtWanList +
      " comment=" + qRouter("VPN_POLICY_ROUTE") + "\n";

    if (dedicatedMtTable) {
      mikrotikPolicyBlock += `
# Explicit fallback after the mangle lookup in the VPN table fails.
# The default RouterOS policy order is mangle -> ... -> user -> main.
# IMPORTANT when migrating an existing router: remove/disable any backup
# default route already present inside this policy table. If such a route
# remains active, the mangle lookup succeeds there and this fallback rule
# will never be reached.
# This user rule makes the fallback to main explicit without inventing
# a second routing mark/table.
:if ([:len [/routing rule find where comment="VPN_BFD_FALLBACK"]] = 0) do={
    /routing rule add action=lookup routing-mark=${qRouter(mtTable)} table=main comment="VPN_BFD_FALLBACK"
}

# Fasttrack skips mangle. Restrict catch-all fasttrack rules to connections
# without a connection-mark so CM_VPN traffic continues through mangle.
:foreach ftId in=[/ip firewall filter find where chain=forward action=fasttrack-connection] do={
    :local cm [/ip firewall filter get $ftId connection-mark]
    :if ([:len $cm] = 0) do={
        /ip firewall filter set $ftId connection-mark=no-mark
    }
}
`;
    }
  }

  const files = {};

  files["server1/" + s1ExitIf + ".conf"] =
`[Interface]
Address = ${s1Addr}
PrivateKey = ${s1Private}${s1MtuLine}
Table = off

[Peer]
PublicKey = ${s2Public}${pskLine}
Endpoint = ${endpoint}:${port}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`;


  if (hasWgInConfig) {
    const wgInPskLine = wgInPsk ? "\nPresharedKey = " + wgInPsk : "";
    const wgInPriorityBase = exits.length === 1 ? 1001 : 2000;
    let wgInPolicyUp = "";
    let wgInPolicyDown = "";

    exits.forEach((exit) => {
      const inPriority = wgInPriorityBase + exit.rank;
      wgInPolicyUp += "PostUp = ip rule show | grep -Fq \"iif %i lookup " + exit.tableId +
        "\" || ip rule add priority " + inPriority + " iif %i lookup " + exit.tableId + "\n";
      wgInPolicyDown = "PreDown = ip rule del priority " + inPriority + " iif %i lookup " + exit.tableId +
        " 2>/dev/null || true\n" + wgInPolicyDown;
    });

    files["server1/wg-in.conf"] =
`[Interface]
Address = ${wgInAddress}
ListenPort = ${wgInPort}
PrivateKey = ${wgInPrivate}

${wgInPolicyUp}${wgInPolicyDown}
PostUp = iptables -C FORWARD -i %i -o %i -m comment --comment wg-in-failover -j DROP 2>/dev/null || iptables -I FORWARD 1 -i %i -o %i -m comment --comment wg-in-failover -j DROP
PostUp = iptables -C FORWARD -i %i -m comment --comment wg-in-failover -j ACCEPT 2>/dev/null || iptables -I FORWARD 2 -i %i -m comment --comment wg-in-failover -j ACCEPT
PostUp = iptables -C FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment wg-in-failover -j ACCEPT 2>/dev/null || iptables -I FORWARD 3 -o %i -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment wg-in-failover -j ACCEPT
PreDown = iptables -D FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment wg-in-failover -j ACCEPT 2>/dev/null || true
PreDown = iptables -D FORWARD -i %i -m comment --comment wg-in-failover -j ACCEPT 2>/dev/null || true
PreDown = iptables -D FORWARD -i %i -o %i -m comment --comment wg-in-failover -j DROP 2>/dev/null || true

[Peer]
PublicKey = ${wgInPeerPublic}${wgInPskLine}
AllowedIPs = ${wgInPeerAllowed}
`;
  }
  files["server2/wg-exit.conf"] =
`[Interface]
Address = ${s2Addr}
ListenPort = ${port}
PrivateKey = ${s2Private}${s2MtuLine}

# Public WireGuard transport and inner single-hop BFD (UDP/3784).
PostUp = iptables -C INPUT -i ${s2Wan} -p udp --dport ${port} -m comment --comment wg-exit-listen -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i ${s2Wan} -p udp --dport ${port} -m comment --comment wg-exit-listen -j ACCEPT
PostUp = iptables -C INPUT -i %i -p udp -s ${s1Ip}/32 -d ${s2Ip}/32 --dport 3784 -m comment --comment wg-exit-bfd -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i %i -p udp -s ${s1Ip}/32 -d ${s2Ip}/32 --dport 3784 -m comment --comment wg-exit-bfd -j ACCEPT
PostUp = iptables -C FORWARD -i %i -m comment --comment wg-exit-failover -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -i %i -m comment --comment wg-exit-failover -j ACCEPT
PostUp = iptables -C FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment wg-exit-failover -j ACCEPT 2>/dev/null || iptables -I FORWARD 2 -o %i -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment wg-exit-failover -j ACCEPT
PostUp = iptables -t nat -C POSTROUTING -s ${awgNet} -o ${s2Wan} -m comment --comment wg-exit-failover -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s ${awgNet} -o ${s2Wan} -m comment --comment wg-exit-failover -j MASQUERADE${server2NatExtra}
PostDown = iptables -D INPUT -i %i -p udp -s ${s1Ip}/32 -d ${s2Ip}/32 --dport 3784 -m comment --comment wg-exit-bfd -j ACCEPT 2>/dev/null || true
PostDown = iptables -D INPUT -i ${s2Wan} -p udp --dport ${port} -m comment --comment wg-exit-listen -j ACCEPT 2>/dev/null || true
PostDown = iptables -D FORWARD -i %i -m comment --comment wg-exit-failover -j ACCEPT 2>/dev/null || true
PostDown = iptables -D FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment wg-exit-failover -j ACCEPT 2>/dev/null || true
PostDown = iptables -t nat -D POSTROUTING -s ${awgNet} -o ${s2Wan} -m comment --comment wg-exit-failover -j MASQUERADE 2>/dev/null || true

[Peer]
PublicKey = ${s1Public}${pskLine}
AllowedIPs = ${allowedServer2.join(", ")}
`;

  let birdTables = "";
  let birdBfdExits = "";
  let birdExitProtocols = "";

  exits.forEach((exit) => {
    const suffix = exits.length === 1 ? "" : "_" + (exit.rank + 1);
    const tableName = "exit4" + suffix;
    const staticName = "exit_default" + suffix;
    const kernelName = "kernel_exit" + suffix;

    birdTables += "ipv4 table " + tableName + ";\n";
    birdBfdExits +=
`    interface "${exit.s1Interface}" {
        interval ${bfd} ms;
        idle tx interval ${bfd} ms;
        multiplier ${mult};
    };

    neighbor ${exit.s2Ip} dev "${exit.s1Interface}" local ${exit.s1Ip};

`;

    birdExitProtocols +=
`protocol static ${staticName} {
    ipv4 {
        table ${tableName};
    };

    route 0.0.0.0/0 via ${exit.s2Ip} bfd;
}

protocol kernel ${kernelName} {
    kernel table ${exit.tableId};

    ipv4 {
        table ${tableName};
        import none;
        export all;
    };
}

`;
  });

  files["server1/bird.conf"] =
`router id ${s1Ip};

${birdTables}
protocol device {
}

protocol bfd bfd_exit {
${birdBfdExits}    interface "${awgIf}" {
        interval ${bfd} ms;
        idle tx interval ${bfd} ms;
        multiplier ${mult};
    };

    neighbor ${awgMt} dev "${awgIf}" local ${awgServer};
}

${birdExitProtocols}`;
  files["server2/bird.conf"] =
`router id ${s2Ip};

protocol device {
}

protocol bfd bfd_exit {
    interface "wg-exit" {
        interval ${bfd} ms;
        idle tx interval ${bfd} ms;
        multiplier ${mult};
    };

    neighbor ${s1Ip} dev "wg-exit" local ${s2Ip};
}
`;

  for (const exit of exits.filter((item) => item.id !== 1)) {
    const pskLineExit = exit.psk1 && exit.psk2 && exit.psk1 === exit.psk2
      ? "\nPresharedKey = " + exit.psk1
      : "";
    const s1MtuLineExit = exit.s1Mtu ? "\nMTU = " + exit.s1Mtu : "";
    const s2MtuLineExit = exit.s2Mtu ? "\nMTU = " + exit.s2Mtu : "";

    files["server1/" + exit.s1Interface + ".conf"] =
`[Interface]
Address = ${exit.s1Address}
PrivateKey = ${exit.s1Private}${s1MtuLineExit}
Table = off

[Peer]
PublicKey = ${exit.s2Public}${pskLineExit}
Endpoint = ${exit.endpoint}:${exit.port}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`;

    let extraNatUp = "";
    let extraNatDown = "";
    for (const clientNet of [awgNet, wgInNet].filter(Boolean)) {
      extraNatUp += "PostUp = iptables -t nat -C POSTROUTING -s " + clientNet + " -o " + exit.s2Wan +
        " -m comment --comment wg-exit-failover -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s " +
        clientNet + " -o " + exit.s2Wan + " -m comment --comment wg-exit-failover -j MASQUERADE\n";
      extraNatDown += "PostDown = iptables -t nat -D POSTROUTING -s " + clientNet + " -o " + exit.s2Wan +
        " -m comment --comment wg-exit-failover -j MASQUERADE 2>/dev/null || true\n";
    }

    files[exit.outputDir + "/wg-exit.conf"] =
`[Interface]
Address = ${exit.s2Address}
ListenPort = ${exit.port}
PrivateKey = ${exit.s2Private}${s2MtuLineExit}

# Public WireGuard transport and inner single-hop BFD (UDP/3784).
PostUp = iptables -C INPUT -i ${exit.s2Wan} -p udp --dport ${exit.port} -m comment --comment wg-exit-listen -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i ${exit.s2Wan} -p udp --dport ${exit.port} -m comment --comment wg-exit-listen -j ACCEPT
PostUp = iptables -C INPUT -i %i -p udp -s ${exit.s1Ip}/32 -d ${exit.s2Ip}/32 --dport 3784 -m comment --comment wg-exit-bfd -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i %i -p udp -s ${exit.s1Ip}/32 -d ${exit.s2Ip}/32 --dport 3784 -m comment --comment wg-exit-bfd -j ACCEPT
PostUp = iptables -C FORWARD -i %i -m comment --comment wg-exit-failover -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -i %i -m comment --comment wg-exit-failover -j ACCEPT
PostUp = iptables -C FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment wg-exit-failover -j ACCEPT 2>/dev/null || iptables -I FORWARD 2 -o %i -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment wg-exit-failover -j ACCEPT
${extraNatUp}PostDown = iptables -D INPUT -i %i -p udp -s ${exit.s1Ip}/32 -d ${exit.s2Ip}/32 --dport 3784 -m comment --comment wg-exit-bfd -j ACCEPT 2>/dev/null || true
PostDown = iptables -D INPUT -i ${exit.s2Wan} -p udp --dport ${exit.port} -m comment --comment wg-exit-listen -j ACCEPT 2>/dev/null || true
PostDown = iptables -D FORWARD -i %i -m comment --comment wg-exit-failover -j ACCEPT 2>/dev/null || true
PostDown = iptables -D FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment wg-exit-failover -j ACCEPT 2>/dev/null || true
${extraNatDown}
[Peer]
PublicKey = ${exit.s1Public}${pskLineExit}
AllowedIPs = ${[exit.s1Ip + "/32", awgNet, wgInNet].filter(Boolean).join(", ")}
`;

    files[exit.outputDir + "/bird.conf"] =
`router id ${exit.s2Ip};

protocol device {
}

protocol bfd bfd_exit {
    interface "wg-exit" {
        interval ${bfd} ms;
        idle tx interval ${bfd} ms;
        multiplier ${mult};
    };

    neighbor ${exit.s1Ip} dev "wg-exit" local ${exit.s2Ip};
}
`;
  }

  const wgInPriorityBase = exits.length === 1 ? 1001 : 2000;
  let policyStart = "";
  let policyStop = "";

  exits.forEach((exit) => {
    const awgPriority = 1000 + exit.rank;
    policyStart += "ExecStart=/bin/sh -c '/usr/sbin/ip rule show | grep -Fq \"iif " + awgIf + " lookup " + exit.tableId +
      "\" || /usr/sbin/ip rule add priority " + awgPriority + " iif " + awgIf + " lookup " + exit.tableId + "'\n";
    policyStop = "ExecStop=/bin/sh -c '/usr/sbin/ip rule del priority " + awgPriority + " iif " + awgIf +
      " lookup " + exit.tableId + " 2>/dev/null || true'\n" + policyStop;

    if (wgInNet && !hasWgInConfig) {
      const inPriority = wgInPriorityBase + exit.rank;
      policyStart += "ExecStart=/bin/sh -c '/usr/sbin/ip rule show | grep -Fq \"iif " + wgInIf + " lookup " + exit.tableId +
        "\" || /usr/sbin/ip rule add priority " + inPriority + " iif " + wgInIf + " lookup " + exit.tableId + "'\n";
      policyStop = "ExecStop=/bin/sh -c '/usr/sbin/ip rule del priority " + inPriority + " iif " + wgInIf +
        " lookup " + exit.tableId + " 2>/dev/null || true'\n" + policyStop;
    }
  });

  files["server1/awg-policy-routing.service"] =
`[Unit]
Description=Ordered policy routing for VPN client traffic
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
${policyStart}${policyStop}
[Install]
WantedBy=multi-user.target
`;
  let server1BfdInputStart = "";
  let server1BfdInputStop = "";

  // BFD is local control-plane traffic, so it must be accepted in INPUT,
  // not FORWARD. Single-hop BFD control packets use UDP destination port 3784.
  server1BfdInputStart += "\nExecStart=/bin/sh -c \'/usr/sbin/iptables -C INPUT -i " + awgIf +
    " -p udp -s " + awgMt + "/32 -d " + awgServer +
    "/32 --dport 3784 -m comment --comment vpn-failover-bfd -j ACCEPT 2>/dev/null || /usr/sbin/iptables -I INPUT 1 -i " + awgIf +
    " -p udp -s " + awgMt + "/32 -d " + awgServer +
    "/32 --dport 3784 -m comment --comment vpn-failover-bfd -j ACCEPT\'";
  server1BfdInputStop =
    "\nExecStop=/bin/sh -c \'/usr/sbin/iptables -D INPUT -i " + awgIf +
    " -p udp -s " + awgMt + "/32 -d " + awgServer +
    "/32 --dport 3784 -m comment --comment vpn-failover-bfd -j ACCEPT 2>/dev/null || true\'" + server1BfdInputStop;

  exits.forEach((exit) => {
    server1BfdInputStart += "\nExecStart=/bin/sh -c \'/usr/sbin/iptables -C INPUT -i " + exit.s1Interface +
      " -p udp -s " + exit.s2Ip + "/32 -d " + exit.s1Ip +
      "/32 --dport 3784 -m comment --comment vpn-failover-bfd -j ACCEPT 2>/dev/null || /usr/sbin/iptables -I INPUT 1 -i " + exit.s1Interface +
      " -p udp -s " + exit.s2Ip + "/32 -d " + exit.s1Ip +
      "/32 --dport 3784 -m comment --comment vpn-failover-bfd -j ACCEPT\'";
    server1BfdInputStop =
      "\nExecStop=/bin/sh -c \'/usr/sbin/iptables -D INPUT -i " + exit.s1Interface +
      " -p udp -s " + exit.s2Ip + "/32 -d " + exit.s1Ip +
      "/32 --dport 3784 -m comment --comment vpn-failover-bfd -j ACCEPT 2>/dev/null || true\'" + server1BfdInputStop;
  });
  files["server1/vpn-failover-firewall.service"] =
`[Unit]
Description=Persistent forwarding and fallback NAT for VPN client traffic
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes${server1BfdInputStart}
ExecStart=/bin/sh -c '/usr/sbin/iptables -C FORWARD -i ${awgIf} -o ${awgIf} -m comment --comment vpn-failover-forward -j DROP 2>/dev/null || /usr/sbin/iptables -I FORWARD 1 -i ${awgIf} -o ${awgIf} -m comment --comment vpn-failover-forward -j DROP'
ExecStart=/bin/sh -c '/usr/sbin/iptables -C FORWARD -i ${awgIf} -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || /usr/sbin/iptables -I FORWARD 2 -i ${awgIf} -m comment --comment vpn-failover-forward -j ACCEPT'
ExecStart=/bin/sh -c '/usr/sbin/iptables -C FORWARD -o ${awgIf} -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || /usr/sbin/iptables -I FORWARD 3 -o ${awgIf} -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment vpn-failover-forward -j ACCEPT'
ExecStart=/bin/sh -c '/usr/sbin/iptables -t nat -C POSTROUTING -s ${awgNet} -o ${s1Wan} -m comment --comment vpn-failover-fallback -j MASQUERADE 2>/dev/null || /usr/sbin/iptables -t nat -A POSTROUTING -s ${awgNet} -o ${s1Wan} -m comment --comment vpn-failover-fallback -j MASQUERADE'${fallbackNatExtraStart}
ExecStop=/bin/sh -c '/usr/sbin/iptables -t nat -D POSTROUTING -s ${awgNet} -o ${s1Wan} -m comment --comment vpn-failover-fallback -j MASQUERADE 2>/dev/null || true'${fallbackNatExtraStop}
ExecStop=/bin/sh -c '/usr/sbin/iptables -D FORWARD -o ${awgIf} -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || true'
ExecStop=/bin/sh -c '/usr/sbin/iptables -D FORWARD -i ${awgIf} -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || true'
ExecStop=/bin/sh -c '/usr/sbin/iptables -D FORWARD -i ${awgIf} -o ${awgIf} -m comment --comment vpn-failover-forward -j DROP 2>/dev/null || true'${server1BfdInputStop}

[Install]
WantedBy=multi-user.target
`;

  const tableList = exits.map((exit) => exit.tableId).join(" ");
  files["server1/vpn-exit-monitor.sh"] =
`#!/bin/bash
set -u

TAG="vpn-exit-monitor"
TABLES=(${tableList})

flush_vpn_conntrack() {
    logger -t "$TAG" "Flushing VPN conntrack"
    conntrack -D -s ${awgNet} >/dev/null 2>&1 || true${monitorExtra}
}

selected_exit() {
    local table route
    for table in "\${TABLES[@]}"; do
        route="$(ip -4 route show table "$table" default proto bird 2>/dev/null | head -n 1)"
        if [[ -n "$route" ]]; then
            printf '%s|%s\n' "$table" "$route"
            return
        fi
    done
    printf 'main\n'
}

last_exit="$(selected_exit)"
logger -t "$TAG" "Initial selected exit: $last_exit"

ip monitor route | while IFS= read -r line
do
    case "$line" in
        *default*" proto bird"*)
            relevant=0
            for table in "\${TABLES[@]}"; do
                if [[ "$line" == *" table $table "* ]]; then
                    relevant=1
                    break
                fi
            done
            [[ "$relevant" -eq 1 ]] || continue

            # Coalesce BIRD delete/add route events before selecting the active exit.
            sleep 0.1
            current_exit="$(selected_exit)"
            if [[ "$current_exit" != "$last_exit" ]]; then
                logger -t "$TAG" "Selected VPN exit changed: $last_exit -> $current_exit"
                flush_vpn_conntrack
                last_exit="$current_exit"
            fi
            ;;
    esac
done
`;
  files["server1/vpn-exit-monitor.service"] =
`[Unit]
Description=Monitor selected BIRD VPN exit and flush VPN conntrack on path changes
After=network-online.target bird.service
Wants=network-online.target bird.service

[Service]
Type=simple
ExecStart=/usr/local/sbin/vpn-exit-monitor.sh
Restart=always
RestartSec=1

[Install]
WantedBy=multi-user.target
`;

  const mikrotikBase =
`# Generated by mikrotik-bfd-vpn-failover local configurator
# Review existing RouterOS objects before import.

/ip address
add address=${awgMt}/32 network=${awgServer} interface=${qRouter(mtIf)} comment="AWG BFD point-to-point"

# Single-hop BFD terminates on the router itself: allow UDP/3784 in INPUT.
# If an INPUT drop rule exists, insert this narrow accept before the first drop.
:if ([:len [/ip firewall filter find where comment="VPN_BFD_INPUT"]] = 0) do={
    :local inputDrop [/ip firewall filter find where chain=input action=drop]
    :if ([:len $inputDrop] > 0) do={
        /ip firewall filter add action=accept chain=input protocol=udp dst-port=3784 src-address=${awgServer}/32 dst-address=${awgMt}/32 in-interface=${qRouter(mtIf)} comment="VPN_BFD_INPUT" place-before=($inputDrop->0)
    } else={
        /ip firewall filter add action=accept chain=input protocol=udp dst-port=3784 src-address=${awgServer}/32 dst-address=${awgMt}/32 in-interface=${qRouter(mtIf)} comment="VPN_BFD_INPUT"
    }
}

/routing bfd configuration
add interfaces=${qRouter(mtIf)} addresses=${awgServer}/32 min-rx=${bfd}ms min-tx=${bfd}ms multiplier=${mult}

`;

  if (mtPolicyMode === "direct") {
    let directRouteBlock = "/ip route\n";
    for (const destination of mtDirectRoutes) {
      directRouteBlock += "add check-gateway=bfd comment=" + qRouter("VPN_BFD_DIRECT") +
        " disabled=no distance=1 dst-address=" + destination +
        " gateway=" + qRouter(awgServer + "%" + mtIf) +
        " routing-table=main scope=30 target-scope=10\n";
    }

    files["mikrotik/bfd-failover.rsc"] = mikrotikBase +
`# Direct-route mode:
# - no mangle rules;
# - no connection marks;
# - no selective MikroTik conntrack cleanup.
# When BFD is DOWN these routes become inactive and RouterOS falls back
# to other matching routes in main, normally the regular Internet default.

/ip route
` + directRouteBlock.replace("/ip route\n", "");
  } else {
    files["mikrotik/bfd-failover.rsc"] = mikrotikBase +
`${routingTableEnsure}/ip route
add check-gateway=bfd comment="VPN_BFD_PRIMARY" disabled=no distance=1 dst-address=${mtDst} gateway=${qRouter(awgServer + "%" + mtIf)}${routingTableClause} scope=30 target-scope=10

/system script
add name=VPN-BFD-Conntrack policy=read,write,test source={
    :global vpnBfdLastState

    :local routeId [/ip route find where comment="VPN_BFD_PRIMARY"]
    :if ([:len $routeId] = 0) do={
        :log warning "VPN-BFD: monitored route not found"
        :return
    }

    :local routeActive [/ip route get $routeId active]
    :local currentState "DOWN"
    :if ($routeActive = true) do={ :set currentState "UP" }

    :if ([:typeof $vpnBfdLastState] = "nothing") do={
        :set vpnBfdLastState $currentState
        :log info ("VPN-BFD: initial state = " . $currentState)
        :return
    }

    :if ($currentState != $vpnBfdLastState) do={
        :local connCount [:len [/ip firewall connection find where connection-mark=${qRouter(connmark)}]]
        :log warning ("VPN-BFD: state changed " . $vpnBfdLastState . " -> " . $currentState . ", removing " . $connCount . " connections")
        /ip firewall connection remove [find where connection-mark=${qRouter(connmark)}]
        :set vpnBfdLastState $currentState
    }
}

/system scheduler
add name=VPN-BFD-Watch interval=1s on-event=VPN-BFD-Conntrack start-time=startup
${mikrotikPolicyBlock}`;
  }

  const mtModeInstallRu = mtPolicyMode === "direct"
    ? "Режим MikroTik: прямые маршруты в main. Mangle/connection-mark и selective conntrack cleanup на MikroTik не создаются."
    : dedicatedMtTable
      ? "Режим MikroTik: address-list + mangle + отдельная routing table. Routing mark совпадает с именем таблицы. При BFD DOWN lookup этой таблицы не находит маршрут, explicit routing rule делает fallback в main. Fasttrack ограничивается соединениями без connection-mark."
      : "Режим MikroTik: address-list + mangle, BFD-маршрут в main. Неактивный маршрут освобождает обычный default. Selective conntrack cleanup по connection-mark сохраняется.";
  const mtModeInstallEn = mtPolicyMode === "direct"
    ? "MikroTik mode: direct routes in main. No mangle/connection-mark or selective MikroTik conntrack cleanup is generated."
    : dedicatedMtTable
      ? "MikroTik mode: address-list + mangle + dedicated routing table. The routing mark is the table name. When BFD is DOWN, that lookup fails and an explicit routing rule falls back to main. Fasttrack is limited to connections without a connection-mark."
      : "MikroTik mode: address-list + mangle, with the BFD route in main. An inactive route leaves the regular default in place. Selective conntrack cleanup by connection-mark is preserved.";

  const wgInInstallRu = hasWgInConfig
    ? "\n   server1/wg-in.conf                   -> /etc/wireguard/" + wgInIf + ".conf"
    : "";
  const wgInStartRu = hasWgInConfig
    ? "\n   systemctl enable --now wg-quick@" + wgInIf
    : "";
  const wgInInstallEn = hasWgInConfig
    ? "\n   server1/wg-in.conf                   -> /etc/wireguard/" + wgInIf + ".conf"
    : "";
  const wgInStartEn = hasWgInConfig
    ? "\n   systemctl enable --now wg-quick@" + wgInIf
    : "";

  const server1ExitInstallRu = exits.map((exit) =>
    "   server1/" + exit.s1Interface + ".conf -> /etc/wireguard/" + exit.s1Interface + ".conf").join("\n");
  const server1ExitInstallEn = server1ExitInstallRu;
  const server1ExitChmodRu = exits.map((exit) => "   chmod 600 /etc/wireguard/" + exit.s1Interface + ".conf").join("\n");
  const server1ExitStartRu = exits.map((exit) => "   systemctl enable --now wg-quick@" + exit.s1Interface).join("\n");
  const exitTableCheckRu = exits.map((exit) => "   ip route show table " + exit.tableId + "   # priority " + exit.priority + ", " + exit.label).join("\n");

  const server2InstallRu = exits.map((exit) =>
`SERVER2 ${exit.label} — priority ${exit.priority}
----------------------------------------
1. Установить:
   apt update && apt install -y wireguard bird2 conntrack

2. Включить forwarding:
   sysctl -w net.ipv4.ip_forward=1

3. Установить файлы из каталога ${exit.outputDir}:
   ${exit.outputDir}/wg-exit.conf -> /etc/wireguard/wg-exit.conf
   ${exit.outputDir}/bird.conf    -> /etc/bird/bird.conf

4. NAT и FORWARD уже включены в wg-exit.conf как PostUp/PostDown.

5. Запустить:
   systemctl enable --now wg-quick@wg-exit
   systemctl enable bird
   systemctl restart bird
`
  ).join("\n");

  const server2InstallEn = exits.map((exit) =>
`SERVER2 ${exit.label} — priority ${exit.priority}
----------------------------------------
1. Install:
   apt update && apt install -y wireguard bird2 conntrack

2. Enable forwarding:
   sysctl -w net.ipv4.ip_forward=1

3. Install files from ${exit.outputDir}:
   ${exit.outputDir}/wg-exit.conf -> /etc/wireguard/wg-exit.conf
   ${exit.outputDir}/bird.conf    -> /etc/bird/bird.conf

4. NAT and FORWARD are already included in wg-exit.conf as PostUp/PostDown.

5. Start:
   systemctl enable --now wg-quick@wg-exit
   systemctl enable bird
   systemctl restart bird
`
  ).join("\n");

  const exitOrderRu = exits.map((exit) =>
    "   " + (exit.rank + 1) + ". priority " + exit.priority + " -> " + exit.label +
    " via " + exit.s1Interface + ", Linux table " + exit.tableId).join("\n");
  const exitOrderEn = exitOrderRu;
  files["INSTALL.txt"] = state.lang === "ru"
    ? `MikroTik BFD VPN Failover — сгенерированный комплект
==================================================

ВАЖНО
-----
Конфиги содержат реальные импортированные WireGuard PrivateKey.
Храните скачанный архив как секрет.

${server2InstallRu}

ПОРЯДОК ВЫХОДОВ
---------------
${exitOrderRu}

SERVER1
-------
1. Установить:
   apt update && apt install -y wireguard bird2 conntrack

2. Включить forwarding:
   sysctl -w net.ipv4.ip_forward=1

3. Рекомендуемый rp_filter:
   sysctl -w net.ipv4.conf.all.rp_filter=2
   sysctl -w net.ipv4.conf.default.rp_filter=2

4. Установить:
${server1ExitInstallRu}${wgInInstallRu}
   server1/bird.conf                    -> /etc/bird/bird.conf
   server1/awg-policy-routing.service   -> /etc/systemd/system/awg-policy-routing.service
   server1/vpn-failover-firewall.service -> /etc/systemd/system/vpn-failover-firewall.service
   server1/vpn-exit-monitor.sh          -> /usr/local/sbin/vpn-exit-monitor.sh
   server1/vpn-exit-monitor.service     -> /etc/systemd/system/vpn-exit-monitor.service

5. Права:
${server1ExitChmodRu}${hasWgInConfig ? "\n   chmod 600 /etc/wireguard/" + wgInIf + ".conf" : ""}
   chmod 755 /usr/local/sbin/vpn-exit-monitor.sh

6. Запустить:
   systemctl daemon-reload
${server1ExitStartRu}${wgInStartRu}
   systemctl enable --now awg-policy-routing.service
   systemctl enable --now vpn-failover-firewall.service
   systemctl enable bird
   systemctl restart bird
   systemctl enable --now vpn-exit-monitor.service

ПРОВЕРКА
--------
Server1:
   birdc show bfd sessions
   ip rule
${exitTableCheckRu}
   journalctl -t vpn-exit-monitor -f

Server2:
   birdc show bfd sessions
   wg show wg-exit

Failover test:
   Остановите wg-exit на текущем Server2 с наивысшим приоритетом.
   Server1 должен выбрать следующий доступный table по порядку выше.
   После возврата более приоритетного Server2 трафик должен вернуться на него.

MIKROTIK
--------
${mtModeInstallRu}
Проверьте mikrotik/bfd-failover.rsc перед импортом.
Не создавайте дубликаты уже существующих адресов, BFD-конфигураций или маршрутов.
`
    : `MikroTik BFD VPN Failover — generated bundle
=================================================

IMPORTANT
---------
The generated configs contain the imported WireGuard PrivateKey values.
Treat the downloaded archive as a secret.

${server2InstallEn}

EXIT ORDER
----------
${exitOrderEn}

SERVER1
-------
1. Install:
   apt update && apt install -y wireguard bird2 conntrack

2. Enable forwarding:
   sysctl -w net.ipv4.ip_forward=1

3. Recommended rp_filter:
   sysctl -w net.ipv4.conf.all.rp_filter=2
   sysctl -w net.ipv4.conf.default.rp_filter=2

4. Install:
${server1ExitInstallEn}${wgInInstallEn}
   server1/bird.conf -> /etc/bird/bird.conf
   server1/awg-policy-routing.service -> /etc/systemd/system/awg-policy-routing.service
   server1/vpn-failover-firewall.service -> /etc/systemd/system/vpn-failover-firewall.service
   server1/vpn-exit-monitor.sh -> /usr/local/sbin/vpn-exit-monitor.sh
   server1/vpn-exit-monitor.service -> /etc/systemd/system/vpn-exit-monitor.service

5. Start:
   systemctl daemon-reload
${server1ExitStartRu}${wgInStartEn}
   systemctl enable --now awg-policy-routing.service
   systemctl enable --now vpn-failover-firewall.service
   systemctl enable bird
   systemctl restart bird
   systemctl enable --now vpn-exit-monitor.service

CHECK
-----
   birdc show bfd sessions
   ip rule
   ip route show table ${table}
   journalctl -t vpn-exit-monitor -f

Failover test:
   Stop wg-exit on the currently preferred Server2.
   Server1 should select the next available routing table by priority.
   When the higher-priority Server2 returns, traffic should move back to it.

MIKROTIK
--------
${mtModeInstallEn}
Review mikrotik/bfd-failover.rsc before import.
Do not duplicate existing addresses, BFD configuration entries, or routes.
`;

  state.generated = files;
  state.currentFile = Object.keys(files)[0];
  renderResults();
}

function maskSecrets(content) {
  if ($("show-secrets").checked) return content;
  return content
    .replace(/^(PrivateKey\s*=\s*).+$/gm, "$1<hidden>")
    .replace(/^(PresharedKey\s*=\s*).+$/gm, "$1<hidden>");
}

function renderResults() {
  const card = $("results-card");
  const tabs = $("result-tabs");
  tabs.innerHTML = "";

  Object.keys(state.generated).forEach((name) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.classList.toggle("active", name === state.currentFile);
    button.addEventListener("click", () => {
      state.currentFile = name;
      renderResults();
    });
    tabs.appendChild(button);
  });

  const current = state.generated[state.currentFile] || "";
  $("preview").querySelector("code").textContent = maskSecrets(current);
  card.classList.remove("hidden");
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateSecretVisibility() {
  const show = $("show-secrets").checked;
  ["s1-private", "s1-public", "s2-private", "s2-public", "s1-psk", "s2-psk",
   "wg-in-private", "wg-in-peer-public", "wg-in-psk"].forEach((id) => {
    $(id).type = show ? "text" : "password";
  });
  if (state.currentFile) {
    $("preview").querySelector("code").textContent = maskSecrets(state.generated[state.currentFile] || "");
  }
  if ($("extra-exits")) renderExtraExits();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCurrent() {
  if (!state.currentFile) return;
  const content = state.generated[state.currentFile];
  const filename = state.currentFile.replaceAll("/", "__");
  downloadBlob(new Blob([content], { type: "text/plain;charset=utf-8" }), filename);
}

async function copyCurrent() {
  const text = $("preview").querySelector("code").textContent;
  try {
    await navigator.clipboard.writeText(text);
    $("copy-current").textContent = tr("Скопировано ✓", "Copied ✓");
    setTimeout(() => {
      $("copy-current").textContent = tr("Копировать", "Copy");
    }, 1200);
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function writeAscii(target, offset, length, text) {
  const bytes = new TextEncoder().encode(text);
  target.set(bytes.slice(0, length), offset);
}

function octal(value, length) {
  const s = Math.floor(value).toString(8);
  return s.padStart(length - 1, "0") + "\0";
}

function tarHeader(name, size) {
  const h = new Uint8Array(512);
  writeAscii(h, 0, 100, name);
  writeAscii(h, 100, 8, octal(0o644, 8));
  writeAscii(h, 108, 8, octal(0, 8));
  writeAscii(h, 116, 8, octal(0, 8));
  writeAscii(h, 124, 12, octal(size, 12));
  writeAscii(h, 136, 12, octal(Math.floor(Date.now() / 1000), 12));
  for (let i = 148; i < 156; i++) h[i] = 0x20;
  h[156] = "0".charCodeAt(0);
  writeAscii(h, 257, 6, "ustar\0");
  writeAscii(h, 263, 2, "00");
  writeAscii(h, 265, 32, "browser");
  writeAscii(h, 297, 32, "browser");

  let sum = 0;
  for (const b of h) sum += b;
  const check = sum.toString(8).padStart(6, "0") + "\0 ";
  writeAscii(h, 148, 8, check);
  return h;
}

function createTar(files) {
  const encoder = new TextEncoder();
  const parts = [];

  Object.entries(files).forEach(([name, content]) => {
    const data = encoder.encode(content);
    parts.push(tarHeader(name, data.length));
    parts.push(data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding) parts.push(new Uint8Array(padding));
  });

  parts.push(new Uint8Array(1024));
  return new Blob(parts, { type: "application/x-tar" });
}

function downloadAll() {
  if (!Object.keys(state.generated).length) return;
  downloadBlob(createTar(state.generated), "mikrotik-bfd-vpn-failover-generated.tar");
}

function privacyCheck() {
  const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
  const externalScripts = Array.from(document.scripts).filter((s) => s.src && new URL(s.src, location.href).origin !== location.origin).length;
  const externalStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter((l) => {
    try { return new URL(l.href, location.href).origin !== location.origin; } catch (_) { return false; }
  }).length;

  const report = [
    tr("Проверка архитектуры страницы", "Page architecture check"),
    "--------------------------------",
    "CSP connect-src 'none': " + (csp.includes("connect-src 'none'") ? "YES" : "NO"),
    "External JavaScript: " + externalScripts,
    "External stylesheets: " + externalStyles,
    "Network API required: NO",
    "Cookies used by app: NO",
    "localStorage used: NO",
    "sessionStorage used: NO",
    "IndexedDB used: NO",
    "Service Worker used: NO",
    "Imported config persistence: memory only",
    "Current protocol: " + location.protocol,
    "",
    tr(
      "Примечание: открытие/обновление самой GitHub Pages страницы загружает статические файлы сайта. Импортированные конфиги и ключи приложением не отправляются.",
      "Note: opening/reloading the GitHub Pages site downloads the static site files. Imported configs and keys are not sent by the application."
    )
  ].join("\n");

  $("privacy-report").textContent = report;
  $("privacy-dialog").showModal();
}

function clearAll() {
  ["paste-s1", "paste-s2", "paste-in", "paste-wgin", "s1-address", "s2-address", "s2-endpoint",
   "s1-private", "s1-public", "s2-private", "s2-public", "s1-psk", "s2-psk",
   "wg-in-private", "wg-in-peer-public", "wg-in-psk", "wg-in-address", "wg-in-port",
   "wg-in-peer-allowed", "s1-mtu", "s2-mtu", "awg-server", "awg-mt", "awg-net",
   "wg-in-net", "mt-address-lists", "mt-direct-routes"].forEach((id) => { $(id).value = ""; });

  ["file-s1", "file-s2", "file-in", "file-wgin"].forEach((id) => { $(id).value = ""; });

  Object.entries(defaults).forEach(([id, val]) => {
    if ($(id)) $(id).value = val;
  });

  $("show-secrets").checked = false;
  updateSecretVisibility();
  setStatus("status-s1", "neutral", "—");
  setStatus("status-s2", "neutral", "—");
  setStatus("status-in", "neutral", "—");
  setStatus("status-wgin", "neutral", "—");
  $("validation").innerHTML = "";
  $("result-tabs").innerHTML = "";
  $("preview").querySelector("code").textContent = "";
  $("results-card").classList.add("hidden");
  state.generated = {};
  state.currentFile = null;
  state.extraExits = [];
  state.nextExitId = 2;
  renderExtraExits();
  updateMikrotikMode();
}

$("lang-ru").addEventListener("click", () => setLanguage("ru"));
$("lang-en").addEventListener("click", () => setLanguage("en"));

$("file-s1").addEventListener("change", () => readSelectedFile("file-s1", "paste-s1", "s1"));
$("file-s2").addEventListener("change", () => readSelectedFile("file-s2", "paste-s2", "s2"));
$("file-in").addEventListener("change", () => readSelectedFile("file-in", "paste-in", "in"));
$("file-wgin").addEventListener("change", () => readSelectedFile("file-wgin", "paste-wgin", "wgin"));

$("parse-s1").addEventListener("click", () => importConfig("s1", $("paste-s1").value));
$("parse-s2").addEventListener("click", () => importConfig("s2", $("paste-s2").value));
$("parse-in").addEventListener("click", () => importConfig("in", $("paste-in").value));
$("parse-wgin").addEventListener("click", () => importConfig("wgin", $("paste-wgin").value));
$("add-exit").addEventListener("click", () => {
  state.extraExits.push(newExtraExit());
  renderExtraExits();
});
$("mt-policy-mode").addEventListener("change", updateMikrotikMode);

$("validate").addEventListener("click", validate);
$("generate").addEventListener("click", generateFiles);
$("show-secrets").addEventListener("change", updateSecretVisibility);
$("download-current").addEventListener("click", downloadCurrent);
$("download-all").addEventListener("click", downloadAll);
$("copy-current").addEventListener("click", copyCurrent);
$("clear-all").addEventListener("click", clearAll);
$("privacy-check").addEventListener("click", privacyCheck);
$("privacy-close").addEventListener("click", () => $("privacy-dialog").close());

Object.entries(defaults).forEach(([id, val]) => {
  if ($(id) && !$(id).value) $(id).value = val;
});

setLanguage("ru");
updateSecretVisibility();
renderExtraExits();
updateMikrotikMode();
