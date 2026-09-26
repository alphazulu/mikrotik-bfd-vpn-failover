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
  currentFile: null
};

const defaults = {
  "wg-port": "51830",
  "s1-wan": "eth0",
  "s2-wan": "eth0",
  "awg-if": "awg0",
  "wg-in-if": "wg-in",
  "mt-if": "wg-awg-proxy-1",
  "route-table": "200",
  "mt-route-table": "main",
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

  ["s1-wan", "s2-wan", "awg-if"].forEach((id) => {
    if (validLinuxInterface(value(id))) add("good", id + " задан", id + " is set");
    else add("bad", id + " должен быть корректным Linux interface name (до 15 символов)", id + " must be a valid Linux interface name (up to 15 characters)");
  });

  if (!safeToken(value("mt-if"))) add("bad", "MikroTik interface не задан или содержит кавычки/перенос строки", "MikroTik interface is missing or contains quotes/newlines");
  else add("good", "MikroTik interface задан", "MikroTik interface is set");

  if (wgInNet && !validLinuxInterface(value("wg-in-if"))) {
    add("bad", "Нужно корректное имя дополнительного WG интерфейса", "A valid additional WG interface name is required");
  }

  if (!parseCidr(value("mt-dst"))) add("bad", "MikroTik dst-address должен быть IPv4/CIDR", "MikroTik dst-address must be IPv4/CIDR");
  else add("good", "MikroTik dst-address корректен", "MikroTik dst-address is valid");

  if (!validNameToken(value("mt-route-table"))) add("bad", "Имя MikroTik routing table некорректно", "MikroTik routing table name is invalid");
  if (!validNameToken(value("connmark"))) add("bad", "Connection mark некорректен", "Connection mark is invalid");

  const mtAddressLists = value("mt-address-lists").split(",").map((x) => x.trim()).filter(Boolean);
  if (mtAddressLists.some((name) => !safeToken(name))) {
    add("bad", "MikroTik address-list содержит недопустимые кавычки или перенос строки", "MikroTik address-list contains quotes or newlines");
  } else if (mtAddressLists.length) {
    add("good", "MikroTik policy selectors будут сгенерированы для " + mtAddressLists.length + " address-list", "MikroTik policy selectors will be generated for " + mtAddressLists.length + " address-list value(s)");
  }
  if (!validNameToken(value("mt-wan-list"))) add("bad", "MikroTik WAN interface-list некорректен", "MikroTik WAN interface-list is invalid");
  if (mtAddressLists.length && value("mt-route-table") === "main") add("warn", "Для address-list policy routing обычно используется отдельная routing table, а не main", "Address-list policy routing normally uses a dedicated routing table rather than main");

  const table = Number(value("route-table"));
  if (Number.isInteger(table) && table > 0) add("good", "Linux routing table корректна", "Linux routing table is valid");
  else add("bad", "Linux routing table должна быть положительным числом", "Linux routing table must be a positive integer");

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
  const awgIf = value("awg-if");
  const wgInIf = value("wg-in-if") || "wg-in";
  const mtIf = value("mt-if");
  const table = value("route-table");
  const mtTable = value("mt-route-table");
  const mtDst = value("mt-dst");
  const connmark = value("connmark");
  const mtWanList = value("mt-wan-list");
  const mtAddressLists = value("mt-address-lists").split(",").map((x) => x.trim()).filter(Boolean);
  const bfd = value("bfd-interval");
  const mult = value("bfd-multiplier");

  const allowedServer2 = [s1Ip + "/32", awgNet];
  if (wgInNet) allowedServer2.push(wgInNet);

  const policyExtraStart = wgInNet
    ? "\nExecStart=/bin/sh -c '/usr/sbin/ip rule show | grep -Fq \"iif " + wgInIf + " lookup " + table + "\" || /usr/sbin/ip rule add priority 1001 iif " + wgInIf + " lookup " + table + "'"
    : "";
  const policyExtraStop = wgInNet
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
      + "\nExecStart=/bin/sh -c '/usr/sbin/iptables -C FORWARD -i " + wgInIf + " -o " + wgInIf + " -m comment --comment vpn-failover-forward -j DROP 2>/dev/null || /usr/sbin/iptables -I FORWARD 1 -i " + wgInIf + " -o " + wgInIf + " -m comment --comment vpn-failover-forward -j DROP'"
      + "\nExecStart=/bin/sh -c '/usr/sbin/iptables -C FORWARD -i " + wgInIf + " -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || /usr/sbin/iptables -I FORWARD 2 -i " + wgInIf + " -m comment --comment vpn-failover-forward -j ACCEPT'"
      + "\nExecStart=/bin/sh -c '/usr/sbin/iptables -C FORWARD -o " + wgInIf + " -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || /usr/sbin/iptables -I FORWARD 3 -o " + wgInIf + " -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment vpn-failover-forward -j ACCEPT'"
    : "";
  const fallbackNatExtraStop = wgInNet
    ? "\nExecStop=/bin/sh -c '/usr/sbin/iptables -t nat -D POSTROUTING -s " + wgInNet + " -o " + s1Wan + " -m comment --comment vpn-failover-fallback -j MASQUERADE 2>/dev/null || true'"
      + "\nExecStop=/bin/sh -c '/usr/sbin/iptables -D FORWARD -o " + wgInIf + " -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || true'"
      + "\nExecStop=/bin/sh -c '/usr/sbin/iptables -D FORWARD -i " + wgInIf + " -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || true'"
      + "\nExecStop=/bin/sh -c '/usr/sbin/iptables -D FORWARD -i " + wgInIf + " -o " + wgInIf + " -m comment --comment vpn-failover-forward -j DROP 2>/dev/null || true'"
    : "";

  const routingTableClause = mtTable && mtTable !== "main" ? " routing-table=" + qRouter(mtTable) : "";
  const routingTableEnsure = mtTable && mtTable !== "main"
    ? "/routing table\n:if ([:len [find where name=" + qRouter(mtTable) + "]] = 0) do={ add fib name=" + qRouter(mtTable) + " }\n\n"
    : "";

  let mikrotikPolicyBlock = "";
  if (mtAddressLists.length) {
    mikrotikPolicyBlock += "\n# Optional policy selectors generated from destination address-lists.\n/ip firewall mangle\n";
    for (const listName of mtAddressLists) {
      mikrotikPolicyBlock += "add chain=prerouting action=mark-connection new-connection-mark=" + qRouter(connmark) +
        " passthrough=yes connection-state=new dst-address-list=" + qRouter(listName) +
        " comment=" + qRouter("VPN_POLICY_MARK") + "\n";
    }
    mikrotikPolicyBlock += "add chain=prerouting action=mark-routing new-routing-mark=" + qRouter(mtTable) +
      " passthrough=yes connection-mark=" + qRouter(connmark) +
      " in-interface-list=!" + mtWanList +
      " comment=" + qRouter("VPN_POLICY_ROUTE") + "\n";
  }

  const files = {};

  files["server1/wg-exit.conf"] =
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

  files["server2/wg-exit.conf"] =
`[Interface]
Address = ${s2Addr}
ListenPort = ${port}
PrivateKey = ${s2Private}${s2MtuLine}

PostUp = iptables -C FORWARD -i %i -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -i %i -j ACCEPT
PostUp = iptables -C FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -I FORWARD 2 -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
PostUp = iptables -t nat -C POSTROUTING -s ${awgNet} -o ${s2Wan} -m comment --comment wg-exit-failover -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s ${awgNet} -o ${s2Wan} -m comment --comment wg-exit-failover -j MASQUERADE${server2NatExtra}
PostDown = iptables -D FORWARD -i %i -j ACCEPT 2>/dev/null || true
PostDown = iptables -D FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
PostDown = iptables -t nat -D POSTROUTING -s ${awgNet} -o ${s2Wan} -m comment --comment wg-exit-failover -j MASQUERADE 2>/dev/null || true

[Peer]
PublicKey = ${s1Public}${pskLine}
AllowedIPs = ${allowedServer2.join(", ")}
`;

  files["server1/bird.conf"] =
`router id ${s1Ip};

ipv4 table exit4;

protocol device {
}

protocol bfd bfd_exit {
    interface "wg-exit" {
        interval ${bfd} ms;
        idle tx interval ${bfd} ms;
        multiplier ${mult};
    };

    interface "${awgIf}" {
        interval ${bfd} ms;
        idle tx interval ${bfd} ms;
        multiplier ${mult};
    };

    neighbor ${s2Ip} dev "wg-exit" local ${s1Ip};
    neighbor ${awgMt} dev "${awgIf}" local ${awgServer};
}

protocol static exit_default {
    ipv4 {
        table exit4;
    };

    route 0.0.0.0/0 via ${s2Ip} bfd;
}

protocol kernel kernel_exit {
    kernel table ${table};

    ipv4 {
        table exit4;
        import none;
        export all;
    };
}
`;

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

  files["server1/awg-policy-routing.service"] =
`[Unit]
Description=Policy routing for VPN client traffic
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c '/usr/sbin/ip rule show | grep -Fq "iif ${awgIf} lookup ${table}" || /usr/sbin/ip rule add priority 1000 iif ${awgIf} lookup ${table}'${policyExtraStart}
ExecStop=/bin/sh -c '/usr/sbin/ip rule del priority 1000 iif ${awgIf} lookup ${table} 2>/dev/null || true'${policyExtraStop}

[Install]
WantedBy=multi-user.target
`;

  files["server1/vpn-failover-firewall.service"] =
`[Unit]
Description=Persistent forwarding and fallback NAT for VPN client traffic
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c '/usr/sbin/iptables -C FORWARD -i ${awgIf} -o ${awgIf} -m comment --comment vpn-failover-forward -j DROP 2>/dev/null || /usr/sbin/iptables -I FORWARD 1 -i ${awgIf} -o ${awgIf} -m comment --comment vpn-failover-forward -j DROP'
ExecStart=/bin/sh -c '/usr/sbin/iptables -C FORWARD -i ${awgIf} -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || /usr/sbin/iptables -I FORWARD 2 -i ${awgIf} -m comment --comment vpn-failover-forward -j ACCEPT'
ExecStart=/bin/sh -c '/usr/sbin/iptables -C FORWARD -o ${awgIf} -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || /usr/sbin/iptables -I FORWARD 3 -o ${awgIf} -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment vpn-failover-forward -j ACCEPT'
ExecStart=/bin/sh -c '/usr/sbin/iptables -t nat -C POSTROUTING -s ${awgNet} -o ${s1Wan} -m comment --comment vpn-failover-fallback -j MASQUERADE 2>/dev/null || /usr/sbin/iptables -t nat -A POSTROUTING -s ${awgNet} -o ${s1Wan} -m comment --comment vpn-failover-fallback -j MASQUERADE'${fallbackNatExtraStart}
ExecStop=/bin/sh -c '/usr/sbin/iptables -t nat -D POSTROUTING -s ${awgNet} -o ${s1Wan} -m comment --comment vpn-failover-fallback -j MASQUERADE 2>/dev/null || true'${fallbackNatExtraStop}
ExecStop=/bin/sh -c '/usr/sbin/iptables -D FORWARD -o ${awgIf} -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || true'
ExecStop=/bin/sh -c '/usr/sbin/iptables -D FORWARD -i ${awgIf} -m comment --comment vpn-failover-forward -j ACCEPT 2>/dev/null || true'
ExecStop=/bin/sh -c '/usr/sbin/iptables -D FORWARD -i ${awgIf} -o ${awgIf} -m comment --comment vpn-failover-forward -j DROP 2>/dev/null || true'

[Install]
WantedBy=multi-user.target
`;

  files["server1/vpn-exit-monitor.sh"] =
`#!/bin/bash
set -u

TAG="vpn-exit-monitor"

flush_vpn_conntrack() {
    logger -t "$TAG" "Flushing VPN conntrack"
    conntrack -D -s ${awgNet} >/dev/null 2>&1 || true${monitorExtra}
}

ip monitor route | while IFS= read -r line
do
    case "$line" in
        "Deleted default via ${s2Ip} dev wg-exit table ${table} proto bird"*)
            logger -t "$TAG" "VPN exit DOWN: $line"
            flush_vpn_conntrack
            ;;
        "default via ${s2Ip} dev wg-exit table ${table} proto bird"*)
            logger -t "$TAG" "VPN exit UP: $line"
            flush_vpn_conntrack
            ;;
    esac
done
`;

  files["server1/vpn-exit-monitor.service"] =
`[Unit]
Description=Monitor BIRD VPN exit route and flush VPN conntrack
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

  files["mikrotik/bfd-failover.rsc"] =
`# Generated by mikrotik-bfd-vpn-failover local configurator
# Review route/table names before import into an existing RouterOS configuration.

/ip address
add address=${awgMt}/32 network=${awgServer} interface=${qRouter(mtIf)} comment="AWG BFD point-to-point"

/routing bfd configuration
add interfaces=${qRouter(mtIf)} addresses=${awgServer}/32 min-rx=${bfd}ms min-tx=${bfd}ms multiplier=${mult}

${routingTableEnsure}/ip route
add dst-address=${mtDst} gateway=${qRouter(awgServer + "%" + mtIf)} check-gateway=bfd distance=1${routingTableClause} comment="VPN_BFD_PRIMARY"

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
add name=VPN-BFD-Watch interval=1s on-event=VPN-BFD-Conntrack start-time=startup\n${mikrotikPolicyBlock}`;

  files["INSTALL.txt"] = state.lang === "ru"
    ? `MikroTik BFD VPN Failover — сгенерированный комплект
==================================================

ВАЖНО
-----
Конфиги содержат реальные импортированные WireGuard PrivateKey.
Храните скачанный архив как секрет.

SERVER2
-------
1. Установить:
   apt update && apt install -y wireguard bird2 conntrack

2. Включить forwarding:
   sysctl -w net.ipv4.ip_forward=1

3. Установить файлы:
   server2/wg-exit.conf -> /etc/wireguard/wg-exit.conf
   server2/bird.conf    -> /etc/bird/bird.conf

4. NAT и FORWARD:
   Нужные source-specific MASQUERADE и FORWARD rules уже находятся
   в server2/wg-exit.conf как PostUp/PostDown. Отдельно добавлять
   широкий POSTROUTING -o ${s2Wan} -j MASQUERADE не требуется.

5. Запустить:
   systemctl enable --now wg-quick@wg-exit
   systemctl enable bird
   systemctl restart bird

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
   server1/wg-exit.conf                 -> /etc/wireguard/wg-exit.conf
   server1/bird.conf                    -> /etc/bird/bird.conf
   server1/awg-policy-routing.service   -> /etc/systemd/system/awg-policy-routing.service
   server1/vpn-failover-firewall.service -> /etc/systemd/system/vpn-failover-firewall.service
   server1/vpn-exit-monitor.sh          -> /usr/local/sbin/vpn-exit-monitor.sh
   server1/vpn-exit-monitor.service     -> /etc/systemd/system/vpn-exit-monitor.service

5. Права:
   chmod 600 /etc/wireguard/wg-exit.conf
   chmod 755 /usr/local/sbin/vpn-exit-monitor.sh

6. Запустить:
   systemctl daemon-reload
   systemctl enable --now wg-quick@wg-exit
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
   ip route show table ${table}
   journalctl -t vpn-exit-monitor -f

Server2:
   birdc show bfd sessions
   wg show wg-exit

Failover test:
   systemctl stop wg-quick@wg-exit    # на Server2
   systemctl start wg-quick@wg-exit   # вернуть обратно

MIKROTIK
--------
Проверьте mikrotik/bfd-failover.rsc перед импортом.
Если route с comment=VPN_BFD_PRIMARY уже существует, не создавайте дубликат — перенесите check-gateway=bfd/comment в существующий маршрут.
`
    : `MikroTik BFD VPN Failover — generated bundle
=================================================

IMPORTANT
---------
The generated configs contain the imported WireGuard PrivateKey values.
Treat the downloaded archive as a secret.

SERVER2
-------
1. Install:
   apt update && apt install -y wireguard bird2 conntrack

2. Enable forwarding:
   sysctl -w net.ipv4.ip_forward=1

3. Install:
   server2/wg-exit.conf -> /etc/wireguard/wg-exit.conf
   server2/bird.conf    -> /etc/bird/bird.conf

4. NAT and FORWARD:
   The required source-specific MASQUERADE and FORWARD rules are already
   included in server2/wg-exit.conf as PostUp/PostDown commands. Do not
   add a second broad POSTROUTING -o ${s2Wan} -j MASQUERADE rule.

5. Start:
   systemctl enable --now wg-quick@wg-exit
   systemctl enable bird
   systemctl restart bird

SERVER1
-------
1. Install:
   apt update && apt install -y wireguard bird2 conntrack

2. Enable forwarding:
   sysctl -w net.ipv4.ip_forward=1

3. Recommended rp_filter:
   sysctl -w net.ipv4.conf.all.rp_filter=2
   sysctl -w net.ipv4.conf.default.rp_filter=2

4. Install the generated Server1 files to their matching /etc and /usr/local paths.

5. Start:
   systemctl daemon-reload
   systemctl enable --now wg-quick@wg-exit
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

Failover on Server2:
   systemctl stop wg-quick@wg-exit
   systemctl start wg-quick@wg-exit

MIKROTIK
--------
Review mikrotik/bfd-failover.rsc before import.
If the monitored route already exists, do not create a duplicate; apply check-gateway=bfd and the VPN_BFD_PRIMARY comment to the existing route.
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
  ["s1-private", "s1-public", "s2-private", "s2-public", "s1-psk", "s2-psk"].forEach((id) => {
    $(id).type = show ? "text" : "password";
  });
  if (state.currentFile) {
    $("preview").querySelector("code").textContent = maskSecrets(state.generated[state.currentFile] || "");
  }
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
  ["paste-s1", "paste-s2", "paste-in", "s1-address", "s2-address", "s2-endpoint",
   "s1-private", "s1-public", "s2-private", "s2-public", "s1-psk", "s2-psk",
   "s1-mtu", "s2-mtu", "awg-server", "awg-mt", "awg-net", "wg-in-net", "mt-address-lists"].forEach((id) => { $(id).value = ""; });

  ["file-s1", "file-s2", "file-in"].forEach((id) => { $(id).value = ""; });

  Object.entries(defaults).forEach(([id, val]) => {
    if ($(id)) $(id).value = val;
  });

  $("show-secrets").checked = false;
  updateSecretVisibility();
  setStatus("status-s1", "neutral", "—");
  setStatus("status-s2", "neutral", "—");
  setStatus("status-in", "neutral", "—");
  $("validation").innerHTML = "";
  $("result-tabs").innerHTML = "";
  $("preview").querySelector("code").textContent = "";
  $("results-card").classList.add("hidden");
  state.generated = {};
  state.currentFile = null;
}

$("lang-ru").addEventListener("click", () => setLanguage("ru"));
$("lang-en").addEventListener("click", () => setLanguage("en"));

$("file-s1").addEventListener("change", () => readSelectedFile("file-s1", "paste-s1", "s1"));
$("file-s2").addEventListener("change", () => readSelectedFile("file-s2", "paste-s2", "s2"));
$("file-in").addEventListener("change", () => readSelectedFile("file-in", "paste-in", "in"));

$("parse-s1").addEventListener("click", () => importConfig("s1", $("paste-s1").value));
$("parse-s2").addEventListener("click", () => importConfig("s2", $("paste-s2").value));
$("parse-in").addEventListener("click", () => importConfig("in", $("paste-in").value));

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
