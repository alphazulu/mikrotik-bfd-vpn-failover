import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const src = fs.readFileSync(path.join(root, "configurator", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "configurator", "index.html"), "utf8");

new Function("document", "Node", "navigator", "location", "URL", "Blob", "TextEncoder", src);

assert.match(html, /connect-src 'none'/, "CSP must block application network connections");
assert.match(html, /id="mt-route-table"[^>]*value="VPN"/, "Policy-routing UI must default to a dedicated VPN table");
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
ListenPort = 51820
PrivateKey = ${keyC}

[Peer]
PublicKey = DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD=
AllowedIPs = 10.88.99.4/32
`;

element("paste-wgin").value = `[Interface]
Address = 10.88.100.1/24
ListenPort = 51999
PrivateKey = ${keyA}

PostUp = ip rule add priority 1001 iif %i lookup 200
PreDown = ip rule del priority 1001 iif %i lookup 200

PostUp = iptables -I FORWARD 1 -i %i -o %i -j DROP
PostUp = iptables -I FORWARD 2 -i %i -j ACCEPT
PreDown = iptables -D FORWARD -i %i -o %i -j DROP
PreDown = iptables -D FORWARD -i %i -j ACCEPT

[Peer]
PublicKey = ${keyB}
AllowedIPs = 10.88.100.2/32
`;

api.importConfig("s1", element("paste-s1").value);
api.importConfig("s2", element("paste-s2").value);
api.importConfig("in", element("paste-in").value);
api.importConfig("wgin", element("paste-wgin").value);

const values = {
  "wg-in-net": "10.88.100.0/24",
  "wg-in-if": "wg-in",
  "s1-wan": "eth0",
  "s2-wan": "eth0",
  "awg-if": "awg0",
  "mt-if": "wg-awg-proxy-1",
  "route-table": "200",
  "mt-route-table": "VPN",
  "mt-dst": "0.0.0.0/0",
  "connmark": "CM_VPN",
  "mt-address-lists": "policy-list-a, policy-list-b, policy-list-c",
  "mt-wan-list": "WAN",
  "bfd-interval": "500",
  "bfd-multiplier": "3"
};
for (const [id, value] of Object.entries(values)) element(id).value = value;

assert.equal(element("s1-address").value, "10.77.66.1/30", "Must select IPv4 from mixed Address list");
assert.equal(element("awg-server").value, "10.88.99.1", "Must infer incoming Server1 IPv4");
assert.equal(element("awg-port").value, "51820", "Must import incoming AWG ListenPort");
assert.equal(element("awg-net").value, "10.88.99.0/24", "Must infer incoming client subnet");
assert.equal(element("awg-mt").value, "10.88.99.4", "Must infer MikroTik /32 peer");
assert.equal(element("s1-mtu").value, "1380");
assert.equal(element("s2-mtu").value, "1380");
assert.equal(element("s1-psk").value, keyC);
assert.equal(element("s2-psk").value, keyC);
assert.equal(element("wg-in-address").value, "10.88.100.1/24");
assert.equal(element("wg-in-net").value, "10.88.100.0/24");
assert.equal(element("wg-in-port").value, "51999");
assert.equal(element("wg-in-private").value, keyA);
assert.equal(element("wg-in-peer-public").value, keyB);
assert.equal(element("wg-in-peer-allowed").value, "10.88.100.2/32");

assert.equal(api.validate().ok, true, "Reference topology must validate");
api.generateFiles();

const files = api.state.generated;
assert.equal(Object.keys(files).length, 11, "Expected complete generated bundle including wg-in");
assert.match(files["server1/wg-exit.conf"], /Table = off/);
assert.match(files["server1/wg-exit.conf"], /MTU = 1380/);
assert.match(files["server1/wg-exit.conf"], new RegExp("PresharedKey = " + keyC.replace(/[.*+?^$()|[\]\\]/g, "\\$&")));
assert.match(files["server1/bird.conf"], /kernel table 200;/);
assert.match(files["server1/bird.conf"], /neighbor 10.77.66.2 dev "wg-exit" local 10.77.66.1;/);
assert.match(files["server1/bird.conf"], /route 0\.0\.0\.0\/0 via 10.77.66.2 bfd;/);
assert.doesNotMatch(files["server1/bird.conf"], /route 0\.0\.0\.0\/0 via 10.77.66.2 dev /, "BIRD 2.14 static route must not use dev after an IPv4 nexthop");
assert.match(files["server1/vpn-exit-monitor.sh"], /TABLES=\(200\)/);
assert.match(files["server1/vpn-exit-monitor.sh"], /selected_exit\(\)/);
assert.match(files["server1/vpn-exit-monitor.sh"], /Selected VPN exit changed/);
assert.match(files["server1/vpn-failover-firewall.service"], /-s 10.88.99.0\/24 -o eth0/);
assert.match(files["server1/vpn-failover-firewall.service"], /-s 10.88.100.0\/24 -o eth0/);
assert.match(files["server1/vpn-failover-firewall.service"], /INPUT -i eth0 -p udp --dport 51820 .*vpn-failover-listener/);
assert.match(files["server1/vpn-failover-firewall.service"], /INPUT -i eth0 -p udp --dport 51999 .*vpn-failover-listener/);
assert.match(files["server1/vpn-failover-firewall.service"], /INPUT -i awg0 -p udp -s 10\.88\.99\.4\/32 -d 10\.88\.99\.1\/32 --dport 3784 .*vpn-failover-bfd/);
assert.match(files["server1/vpn-failover-firewall.service"], /INPUT -i wg-exit -p udp -s 10\.77\.66\.2\/32 -d 10\.77\.66\.1\/32 --dport 3784 .*vpn-failover-bfd/);
assert.match(files["server1/vpn-failover-firewall.service"], /-i awg0 -o awg0 .* -j DROP/);
assert.match(files["server1/vpn-failover-firewall.service"], /-i awg0 .* -j ACCEPT/);
assert.match(files["server1/vpn-failover-firewall.service"], /-o awg0 .*--ctstate RELATED,ESTABLISHED.* -j ACCEPT/);
assert.doesNotMatch(files["server1/vpn-failover-firewall.service"], /-i wg-in -o wg-in .* -j DROP/, "wg-in owns its own forwarding lifecycle when a full wg-in config is generated");
assert.match(files["server1/wg-in.conf"], /Address = 10\.88\.100\.1\/24/);
assert.match(files["server1/wg-in.conf"], /ListenPort = 51999/);
assert.match(files["server1/wg-in.conf"], /priority 1001 iif %i lookup 200/);
assert.match(files["server1/wg-in.conf"], /-i %i -o %i .* -j DROP/);
assert.match(files["server1/wg-in.conf"], /-i %i .* -j ACCEPT/);
assert.match(files["server1/wg-in.conf"], /-o %i .*--ctstate RELATED,ESTABLISHED.* -j ACCEPT/);
assert.match(files["server1/wg-in.conf"], /AllowedIPs = 10\.88\.100\.2\/32/);

assert.match(files["server2/wg-exit.conf"], /AllowedIPs = 10.77.66.1\/32, 10.88.99.0\/24, 10.88.100.0\/24/);
assert.match(files["server2/wg-exit.conf"], /-o %i -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment wg-exit-failover -j ACCEPT/);
assert.match(files["server2/wg-exit.conf"], /-i %i -m comment --comment wg-exit-failover -j ACCEPT/);
assert.match(files["server2/wg-exit.conf"], /-s 10.88.99.0\/24 -o eth0/);
assert.match(files["server2/wg-exit.conf"], /-s 10.88.100.0\/24 -o eth0/);
assert.match(files["server2/wg-exit.conf"], /INPUT -i eth0 -p udp --dport 51830 .*wg-exit-listen/);
assert.match(files["server2/wg-exit.conf"], /INPUT -i %i -p udp -s 10\.77\.66\.1\/32 -d 10\.77\.66\.2\/32 --dport 3784 .*wg-exit-bfd/);

assert.match(files["mikrotik/bfd-failover.rsc"], /address=10.88.99.4\/32 network=10.88.99.1/);
assert.match(files["mikrotik/bfd-failover.rsc"], /check-gateway=bfd/);
assert.match(files["mikrotik/bfd-failover.rsc"], /\/routing table/);
assert.match(files["mikrotik/bfd-failover.rsc"], /name="VPN"/);
assert.match(files["mikrotik/bfd-failover.rsc"], /routing-table="VPN"/);
assert.match(files["mikrotik/bfd-failover.rsc"], /connection-mark="CM_VPN"/);
assert.match(files["mikrotik/bfd-failover.rsc"], /dst-address-list="policy-list-a"/);
assert.match(files["mikrotik/bfd-failover.rsc"], /dst-address-list="policy-list-b"/);
assert.match(files["mikrotik/bfd-failover.rsc"], /dst-address-list="policy-list-c"/);
assert.match(files["mikrotik/bfd-failover.rsc"], /dst-address-type=!local/);
assert.match(files["mikrotik/bfd-failover.rsc"], /new-routing-mark="VPN"/);
assert.doesNotMatch(files["mikrotik/bfd-failover.rsc"], /VPN_RM/, "No synthetic routing mark/table should be generated");
assert.doesNotMatch(files["mikrotik/bfd-failover.rsc"], /VPN_BFD_LOOKUP/, "Mangle already performs the VPN-table lookup");
assert.match(files["mikrotik/bfd-failover.rsc"], /action=lookup routing-mark="VPN" table=main comment="VPN_BFD_FALLBACK"/);
assert.match(files["mikrotik/bfd-failover.rsc"], /check-gateway=bfd comment="VPN_BFD_PRIMARY" disabled=no distance=1 dst-address=0\.0\.0\.0\/0 gateway="10\.88\.99\.1%wg-awg-proxy-1" routing-table="VPN" scope=30 target-scope=10/);
assert.match(files["mikrotik/bfd-failover.rsc"], /action=fasttrack-connection/);
assert.match(files["mikrotik/bfd-failover.rsc"], /connection-mark=no-mark/);
assert.match(files["mikrotik/bfd-failover.rsc"], /in-interface-list=!WAN/);
assert.match(files["mikrotik/bfd-failover.rsc"], /chain=input protocol=udp dst-port=3784 src-address=10\.88\.99\.1\/32 dst-address=10\.88\.99\.4\/32 in-interface="wg-awg-proxy-1" comment="VPN_BFD_INPUT"/);
assert.match(files["mikrotik/bfd-failover.rsc"], /place-before=\(\$inputDrop->0\)/);
assert.doesNotMatch(files["mikrotik/bfd-failover.rsc"], /^\s*:return\s*$/m, "RouterOS 7.24.x requires a value for :return; watcher must not emit bare :return");
assert.match(files["mikrotik/bfd-failover.rsc"], /:local routeIds \[\/ip route find where comment="VPN_BFD_PRIMARY"\]/);
assert.match(files["mikrotik/bfd-failover.rsc"], /:local routeId \[:pick \$routeIds 0\]/);
assert.match(files["mikrotik/bfd-failover.rsc"], /:if \(\[:typeof \$vpnBfdLastState\] = "nothing"\) do=\{[\s\S]*?:set vpnBfdLastState \$currentState[\s\S]*?\} else=\{/);
{
  const rsc = files["mikrotik/bfd-failover.rsc"];
  const tableNames = new Set(["main"]);
  for (const m of rsc.matchAll(/\/routing table add[^\n]*name="([^"]+)"/g)) tableNames.add(m[1]);
  for (const m of rsc.matchAll(/new-routing-mark="([^"]+)"/g)) {
    assert.equal(tableNames.has(m[1]), true, "Every RouterOS new-routing-mark must refer to an existing routing table: " + m[1]);
  }
}
assert.match(files["INSTALL.txt"], /vpn-failover-firewall\.service/);
assert.match(files["INSTALL.txt"], /wg-quick@wg-in/);
assert.doesNotMatch(files["INSTALL.txt"], /^\s*iptables -t nat .*POSTROUTING -o eth0 -j MASQUERADE/m, "Install guide must not execute a duplicate broad NAT rule");

// Multi-exit acceptance: Server1 maintains independent tunnels and ordered policy tables.
api.state.extraExits = [{
  id: 2,
  label: "Server2 #2",
  priority: "20",
  s1Interface: "wg-exit2",
  s1Address: "10.77.67.1/30",
  s2Address: "10.77.67.2/30",
  endpoint: "198.51.100.20",
  port: "51830",
  s1Private: keyA,
  s1Public: keyA,
  s2Private: keyB,
  s2Public: keyB,
  psk1: "",
  psk2: "",
  s1Mtu: "",
  s2Mtu: "",
  s2Wan: "eth0",
  s1Text: "",
  s2Text: ""
}];

assert.equal(api.validate().ok, true, "Two-exit topology must validate");
api.generateFiles();
let multi = api.state.generated;

assert.equal(Object.keys(multi).length, 14, "Second exit must add Server1 WG plus Server2 WG/BIRD files");
assert.match(multi["server1/wg-exit2.conf"], /Address = 10\.77\.67\.1\/30/);
assert.match(multi["server1/wg-exit2.conf"], /Endpoint = 198\.51\.100\.20:51830/);
assert.match(multi["server2-2/wg-exit.conf"], /Address = 10\.77\.67\.2\/30/);
assert.match(multi["server2-2/wg-exit.conf"], /AllowedIPs = 10\.77\.67\.1\/32, 10\.88\.99\.0\/24, 10\.88\.100\.0\/24/);
assert.match(multi["server2-2/bird.conf"], /neighbor 10\.77\.67\.1 dev "wg-exit" local 10\.77\.67\.2/);
assert.match(multi["server2-2/wg-exit.conf"], /INPUT -i %i -p udp -s 10\.77\.67\.1\/32 -d 10\.77\.67\.2\/32 --dport 3784 .*wg-exit-bfd/);
assert.match(multi["server1/vpn-failover-firewall.service"], /INPUT -i wg-exit2 -p udp -s 10\.77\.67\.2\/32 -d 10\.77\.67\.1\/32 --dport 3784 .*vpn-failover-bfd/);

assert.match(multi["server1/bird.conf"], /ipv4 table exit4_1;/);
assert.match(multi["server1/bird.conf"], /ipv4 table exit4_2;/);
assert.match(multi["server1/bird.conf"], /neighbor 10\.77\.66\.2 dev "wg-exit" local 10\.77\.66\.1/);
assert.match(multi["server1/bird.conf"], /neighbor 10\.77\.67\.2 dev "wg-exit2" local 10\.77\.67\.1/);
assert.match(multi["server1/bird.conf"], /protocol kernel kernel_exit_1[\s\S]*?kernel table 200;/);
assert.match(multi["server1/bird.conf"], /protocol kernel kernel_exit_2[\s\S]*?kernel table 201;/);

assert.match(multi["server1/awg-policy-routing.service"], /priority 1000 iif awg0 lookup 200/);
assert.match(multi["server1/awg-policy-routing.service"], /priority 1001 iif awg0 lookup 201/);
assert.match(multi["server1/wg-in.conf"], /priority 2000 iif %i lookup 200/);
assert.match(multi["server1/wg-in.conf"], /priority 2001 iif %i lookup 201/);
assert.match(multi["server1/vpn-exit-monitor.sh"], /TABLES=\(200 201\)/);
assert.match(multi["INSTALL.txt"], /server2-2\/wg-exit\.conf/);
assert.match(multi["INSTALL.txt"], /wg-quick@wg-exit2/);

const multiValidationFiles = {
  server1Bird: multi["server1/bird.conf"],
  server2Bird: multi["server2-2/bird.conf"],
  server1Wg: multi["server1/wg-exit2.conf"],
  server2Wg: multi["server2-2/wg-exit.conf"],
  monitor: multi["server1/vpn-exit-monitor.sh"],
  firewallService: multi["server1/vpn-failover-firewall.service"]
};

// Lower numeric priority must become the first Linux policy table.
api.state.extraExits[0].priority = "5";
assert.equal(api.validate().ok, true, "Reordered priorities must validate");
api.generateFiles();
multi = api.state.generated;
assert.match(multi["server1/bird.conf"], /protocol static exit_default_1[\s\S]*?route 0\.0\.0\.0\/0 via 10\.77\.67\.2 bfd;/);
assert.match(multi["server1/bird.conf"], /protocol kernel kernel_exit_1[\s\S]*?kernel table 200;/);
assert.match(multi["server1/bird.conf"], /protocol static exit_default_2[\s\S]*?route 0\.0\.0\.0\/0 via 10\.77\.66\.2 bfd;/);
assert.match(multi["server1/bird.conf"], /protocol kernel kernel_exit_2[\s\S]*?kernel table 201;/);

// Ambiguous priorities and reused transfer subnets must be rejected.
api.state.extraExits[0].priority = "10";
assert.equal(api.validate().ok, false, "Duplicate exit priorities must be rejected");
api.state.extraExits[0].priority = "20";
api.state.extraExits[0].s1Address = "10.77.66.1/30";
api.state.extraExits[0].s2Address = "10.77.66.2/30";
assert.equal(api.validate().ok, false, "Reused wg-exit transfer subnet must be rejected");
api.state.extraExits[0].s1Address = "10.77.67.1/30";
api.state.extraExits[0].s2Address = "10.77.67.2/30";

api.state.extraExits = [];
assert.equal(api.validate().ok, true, "Single-exit topology must remain valid after multi-exit tests");
api.generateFiles();

// Address-list + mangle must not place the BFD default in main, because that
// would affect unmarked traffic too. Direct mode is the supported main-table mode.
element("mt-route-table").value = "main";
assert.equal(api.validate().ok, false, "Policy mode must reject main as its routing table");
element("mt-route-table").value = "VPN";
assert.equal(api.validate().ok, true, "Policy mode must accept the dedicated VPN table");

// AWG ListenPort is mandatory because Server1 INPUT must be generated explicitly.
const savedAwgPort = element("awg-port").value;
element("awg-port").value = "";
assert.equal(api.validate().ok, false, "Missing AWG ListenPort must be rejected");
element("awg-port").value = savedAwgPort;
assert.equal(api.validate().ok, true, "AWG ListenPort restore must validate");

// Alternative MikroTik mode: direct destination routes in main, without mangle/marks.
element("mt-policy-mode").value = "direct";
element("mt-direct-routes").value = "203.0.113.55, 198.51.100.0/24\n203.0.113.55";
assert.equal(api.validate().ok, true, "Direct-route topology must validate");
api.generateFiles();

const directMikrotik = api.state.generated["mikrotik/bfd-failover.rsc"];
assert.match(directMikrotik, /check-gateway=bfd comment="VPN_BFD_DIRECT" disabled=no distance=1 dst-address=203\.0\.113\.55\/32 .*routing-table=main scope=30 target-scope=10/);
assert.match(directMikrotik, /check-gateway=bfd comment="VPN_BFD_DIRECT" disabled=no distance=1 dst-address=198\.51\.100\.0\/24 .*routing-table=main scope=30 target-scope=10/);
assert.doesNotMatch(directMikrotik, /\/ip firewall mangle/);
assert.doesNotMatch(directMikrotik, /mark-connection/);
assert.doesNotMatch(directMikrotik, /VPN-BFD-Conntrack/);
assert.doesNotMatch(directMikrotik, /VPN_BFD_FALLBACK/);
assert.doesNotMatch(directMikrotik, /fasttrack-connection/);
assert.doesNotMatch(directMikrotik, /\/routing table add/);
assert.doesNotMatch(directMikrotik, /dst-address=0\.0\.0\.0\/0/);
assert.match(api.state.generated["INSTALL.txt"], /прямые маршруты в main|direct routes in main/i);

element("mt-direct-routes").value = "203.0.113.55, not-an-ip";
assert.equal(api.validate().ok, false, "Invalid direct-route destination must be rejected");
element("mt-direct-routes").value = "";
element("mt-policy-mode").value = "policy";
assert.equal(api.validate().ok, true, "Policy mode must still validate after direct-mode test");

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
fs.writeFileSync(path.join(out, "server1-wg-in.conf"), files["server1/wg-in.conf"]);
fs.writeFileSync(path.join(out, "vpn-exit-monitor.sh"), files["server1/vpn-exit-monitor.sh"]);
fs.writeFileSync(path.join(out, "vpn-failover-firewall.service"), files["server1/vpn-failover-firewall.service"]);
fs.writeFileSync(path.join(out, "awg-policy-routing.service"), files["server1/awg-policy-routing.service"]);
fs.writeFileSync(path.join(out, "multi-server1-bird.conf"), multiValidationFiles.server1Bird);
fs.writeFileSync(path.join(out, "multi-server2-bird.conf"), multiValidationFiles.server2Bird);
fs.writeFileSync(path.join(out, "multi-server1-wg-exit2.conf"), multiValidationFiles.server1Wg);
fs.writeFileSync(path.join(out, "multi-server2-wg-exit.conf"), multiValidationFiles.server2Wg);
fs.writeFileSync(path.join(out, "multi-vpn-exit-monitor.sh"), multiValidationFiles.monitor);
fs.writeFileSync(path.join(out, "multi-vpn-failover-firewall.service"), multiValidationFiles.firewallService);

console.log("Configurator unit/security tests: OK");
