import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const src = fs.readFileSync(path.join(root, "configurator", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "configurator", "index.html"), "utf8");

new Function("document", "Node", "navigator", "location", "URL", "Blob", "TextEncoder", src);

assert.match(html, /connect-src 'none'/, "CSP must block application network connections");
assert.doesNotMatch(src, /\bfetch\s*\(/, "Runtime must not call fetch()");
assert.doesNotMatch(src, /new\s+XMLHttpRequest|XMLHttpRequest\s*\(/, "Runtime must not use XMLHttpRequest");
assert.doesNotMatch(src, /new\s+WebSocket|WebSocket\s*\(/, "Runtime must not use WebSocket");
assert.doesNotMatch(src, /new\s+EventSource|EventSource\s*\(/, "Runtime must not use EventSource");
assert.doesNotMatch(src, /sendBeacon\s*\(/, "Runtime must not use sendBeacon");
assert.doesNotMatch(src, /localStorage\s*[.\[]/, "Runtime must not use localStorage");
assert.doesNotMatch(src, /sessionStorage\s*[.\[]/, "Runtime must not use sessionStorage");
assert.doesNotMatch(src, /indexedDB\s*[.\[]/, "Runtime must not use IndexedDB");
assert.doesNotMatch(src, /document\.cookie/, "Runtime must not use cookies");
assert.doesNotMatch(src, /serviceWorker\s*[.\[]/, "Runtime must not use a Service Worker");

const elements = new Map();
let created = 0;

function element(id) {
  if (elements.has(id)) return elements.get(id);
  const code = { textContent: "" };
  const e = {
    id,
    value: "",
    checked: false,
    type: "text",
    files: [],
    innerHTML: "",
    textContent: "",
    placeholder: "",
    dataset: {},
    children: [],
    childNodes: [],
    className: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    appendChild(x) { this.children.push(x); },
    querySelector(sel) { return sel === "code" ? code : element(id + ":" + sel); },
    scrollIntoView() {},
    showModal() {},
    close() {},
    style: {},
    select() {},
    click() {},
    remove() {}
  };
  elements.set(id, e);
  return e;
}

const documentMock = {
  getElementById: element,
  documentElement: { lang: "ru" },
  querySelectorAll() { return []; },
  querySelector() { return { content: "default-src 'self'; connect-src 'none'" }; },
  createElement(tag) { created += 1; return element("created-" + tag + "-" + created); },
  scripts: [],
  body: { appendChild() {} },
  execCommand() { return true; }
};

const NodeMock = { TEXT_NODE: 3 };
const navigatorMock = { clipboard: { writeText: async () => {} } };
const locationMock = { href: "https://example.invalid/", origin: "https://example.invalid", protocol: "https:" };
function URLMock() { this.origin = "https://example.invalid"; }
URLMock.createObjectURL = () => "blob:test";
URLMock.revokeObjectURL = () => {};

const expose = new Function(
  "document", "Node", "navigator", "location", "URL", "Blob", "TextEncoder",
  src + "\nreturn {state, importConfig, validate, generateFiles};"
);
const api = expose(documentMock, NodeMock, navigatorMock, locationMock, URLMock, Blob, TextEncoder);

const keyA = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const keyB = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const keyC = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=";

element("paste-s1").value = `[Interface]
Address = fd00::1/64, 10.77.66.1/30
PrivateKey = ${keyA}
MTU = 1380
Table = off

[Peer]
PublicKey = ${keyB}
PresharedKey = ${keyC}
Endpoint = 203.0.113.20:51830
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`;

element("paste-s2").value = `[Interface]
Address = 10.77.66.2/30
ListenPort = 51830
PrivateKey = ${keyB}
MTU = 1380

[Peer]
PublicKey = ${keyA}
PresharedKey = ${keyC}
AllowedIPs = 10.77.66.1/32, 10.88.99.0/24, 10.88.100.0/24
`;

element("paste-in").value = `[Interface]
Address = fd01::1/64, 10.88.99.1/24
PrivateKey = ${keyC}

[Peer]
PublicKey = DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD=
AllowedIPs = 10.88.99.4/32
`;

api.importConfig("s1", element("paste-s1").value);
api.importConfig("s2", element("paste-s2").value);
api.importConfig("in", element("paste-in").value);

const values = {
  "wg-in-net": "10.88.100.0/24",
  "wg-in-if": "wg-in",
  "s1-wan": "eth0",
  "s2-wan": "eth0",
  "awg-if": "awg0",
  "mt-if": "wg-awg-proxy-1",
  "route-table": "200",
  "mt-route-table": "main",
  "mt-dst": "0.0.0.0/0",
  "connmark": "CM_VPN",
  "bfd-interval": "500",
  "bfd-multiplier": "3"
};
for (const [id, value] of Object.entries(values)) element(id).value = value;

assert.equal(element("s1-address").value, "10.77.66.1/30", "Must select IPv4 from mixed Address list");
assert.equal(element("awg-server").value, "10.88.99.1", "Must infer incoming Server1 IPv4");
assert.equal(element("awg-net").value, "10.88.99.0/24", "Must infer incoming client subnet");
assert.equal(element("awg-mt").value, "10.88.99.4", "Must infer MikroTik /32 peer");
assert.equal(element("s1-mtu").value, "1380");
assert.equal(element("s2-mtu").value, "1380");
assert.equal(element("s1-psk").value, keyC);
assert.equal(element("s2-psk").value, keyC);

assert.equal(api.validate().ok, true, "Reference topology must validate");
api.generateFiles();

const files = api.state.generated;
assert.equal(Object.keys(files).length, 10, "Expected complete generated bundle");
assert.match(files["server1/wg-exit.conf"], /Table = off/);
assert.match(files["server1/wg-exit.conf"], /MTU = 1380/);
assert.match(files["server1/wg-exit.conf"], new RegExp("PresharedKey = " + keyC.replace(/[.*+?^$()|[\]\\]/g, "\\$&")));
assert.match(files["server1/bird.conf"], /kernel table 200;/);
assert.match(files["server1/bird.conf"], /neighbor 10.77.66.2 dev "wg-exit" local 10.77.66.1;/);
assert.match(files["server1/bird.conf"], /route 0\.0\.0\.0\/0 via 10.77.66.2 bfd;/);
assert.doesNotMatch(files["server1/bird.conf"], /route 0\.0\.0\.0\/0 via 10.77.66.2 dev /, "BIRD 2.14 static route must not use dev after an IPv4 nexthop");
assert.match(files["server1/vpn-exit-monitor.sh"], /Deleted default via 10.77.66.2 dev wg-exit table 200 proto bird/);
assert.match(files["server1/vpn-failover-firewall.service"], /-s 10.88.99.0\/24 -o eth0/);
assert.match(files["server1/vpn-failover-firewall.service"], /-s 10.88.100.0\/24 -o eth0/);
assert.match(files["server1/vpn-failover-firewall.service"], /-i awg0 -o awg0 .* -j DROP/);
assert.match(files["server1/vpn-failover-firewall.service"], /-i awg0 .* -j ACCEPT/);
assert.match(files["server1/vpn-failover-firewall.service"], /-o awg0 .*--ctstate RELATED,ESTABLISHED.* -j ACCEPT/);
assert.match(files["server1/vpn-failover-firewall.service"], /-i wg-in -o wg-in .* -j DROP/);
assert.match(files["server1/vpn-failover-firewall.service"], /-i wg-in .* -j ACCEPT/);

assert.match(files["server2/wg-exit.conf"], /AllowedIPs = 10.77.66.1\/32, 10.88.99.0\/24, 10.88.100.0\/24/);
assert.match(files["server2/wg-exit.conf"], /-o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT/);
assert.match(files["server2/wg-exit.conf"], /-s 10.88.99.0\/24 -o eth0/);
assert.match(files["server2/wg-exit.conf"], /-s 10.88.100.0\/24 -o eth0/);

assert.match(files["mikrotik/bfd-failover.rsc"], /address=10.88.99.4\/32 network=10.88.99.1/);
assert.match(files["mikrotik/bfd-failover.rsc"], /check-gateway=bfd/);
assert.match(files["mikrotik/bfd-failover.rsc"], /connection-mark="CM_VPN"/);
assert.match(files["INSTALL.txt"], /vpn-failover-firewall\.service/);
assert.doesNotMatch(files["INSTALL.txt"], /^\s*iptables -t nat .*POSTROUTING -o eth0 -j MASQUERADE/m, "Install guide must not execute a duplicate broad NAT rule");

const validS2 = element("s2-address").value;
element("s2-address").value = "10.77.67.2/30";
assert.equal(api.validate().ok, false, "Different wg-exit subnet must be rejected");
element("s2-address").value = validS2;

element("s2-psk").value = "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD=";
assert.equal(api.validate().ok, false, "Mismatched PSK must be rejected");
element("s2-psk").value = keyC;

element("s1-wan").value = "eth0;touch";
assert.equal(api.validate().ok, false, "Unsafe Linux interface name must be rejected");
element("s1-wan").value = "eth0";

element("mt-dst").value = "not-a-prefix";
assert.equal(api.validate().ok, false, "Invalid MikroTik destination must be rejected");
element("mt-dst").value = "0.0.0.0/0";

const out = path.join(root, "tests", ".generated");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "server1-bird.conf"), files["server1/bird.conf"]);
fs.writeFileSync(path.join(out, "server2-bird.conf"), files["server2/bird.conf"]);
fs.writeFileSync(path.join(out, "server1-wg-exit.conf"), files["server1/wg-exit.conf"]);
fs.writeFileSync(path.join(out, "server2-wg-exit.conf"), files["server2/wg-exit.conf"]);
fs.writeFileSync(path.join(out, "vpn-exit-monitor.sh"), files["server1/vpn-exit-monitor.sh"]);

console.log("Configurator unit/security tests: OK");
