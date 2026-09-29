import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const src = fs.readFileSync(path.join(root, "configurator", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "configurator", "index.html"), "utf8");

new Function("document", "Node", "navigator", "location", "URL", "Blob", "TextEncoder", src);

assert.match(html, /connect-src 'none'/, "CSP must block application network connections");
assert.match(html, /id="mt-route-table"[^>]*value="VPN"/, "Policy-routing UI must default to a dedicated VPN table");
assert.match(html, /option value="awg31" selected/, "AWG generation must default to 3.1");
assert.match(html, /id="wg-exit-source-mode"/, "Configurator must expose an independent inter-server WG source selector");
assert.match(html, /id="generate-wg-exits"/, "Configurator must expose inter-server WG generation");
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
  src + "\nreturn {state, importConfig, validate, generateFiles, generateVpnMaterial, generateInterserverWgMaterial, x25519PublicFromPrivate};"
);
const api = expose(documentMock, NodeMock, navigatorMock, locationMock, URLMock, Blob, TextEncoder);

const keyA = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const keyB = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const keyC = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=";
const publicA = api.x25519PublicFromPrivate(keyA);
const publicB = api.x25519PublicFromPrivate(keyB);

element("paste-s1").value = `[Interface]
Address = fd00::1/64, 10.77.66.1/30
PrivateKey = ${keyA}
MTU = 1380
Table = off

[Peer]
PublicKey = ${publicB}
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
PublicKey = ${publicA}
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
  "s1-bgp-as": "65001",
  "mt-bgp-as": "65010",
  "mt-bgp-instance": "vpn-bfd",
  "mt-bgp-connection": "vpn-to-server1",
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
// Both imported files can be syntactically valid while referring to different
// key pairs. Reject this before emitting configs that will never handshake.
element("s1-public").value = publicB;
assert.equal(api.validate().ok, false, "Mismatched imported Server1 private/public keys must be rejected");
element("s1-public").value = publicA;
element("s2-public").value = publicA;
assert.equal(api.validate().ok, false, "Mismatched imported Server2 private/public keys must be rejected");
element("s2-public").value = publicB;

element("s2-address").value = element("s1-address").value;
assert.equal(api.validate().ok, false, "A tunnel cannot use the same local and remote address");
element("s2-address").value = "10.77.66.2/30";
element("wg-in-net").value = "10.88.99.0/25";
assert.equal(api.validate().ok, false, "AWG and wg-in client subnets must not overlap");
element("wg-in-net").value = "10.88.100.0/24";
element("wg-in-peer-allowed").value = "0.0.0.0/0";
assert.equal(api.validate().ok, false, "wg-in AllowedIPs must not install a default route on Server1");
element("wg-in-peer-allowed").value = "10.88.100.2/32";
element("awg-net").value = "10.77.66.0/24";
assert.equal(api.validate().ok, false, "An exit subnet must not overlap AWG client addresses");
element("awg-net").value = "10.88.99.0/24";
element("route-table").value = "254";
assert.equal(api.validate().ok, false, "BIRD must not install a default route in Linux main table 254");
element("route-table").value = "200";
element("s1-exit-if").value = "wg-in";
assert.equal(api.validate().ok, false, "An exit must not overwrite the wg-in configuration");
element("s1-exit-if").value = "awg0";
assert.equal(api.validate().ok, false, "An exit must not collide with the incoming AWG interface");
element("s1-exit-if").value = "wg-exit";
assert.equal(api.validate().ok, true, "Reference topology must still validate after restoring fields");
api.generateFiles();

const files = api.state.generated;
assert.equal(Object.keys(files).length, 13, "Expected complete generated bundle including wg-in and persistent sysctl configs");
assert.match(files["server1/90-vpn-failover.conf"], /net\.ipv4\.ip_forward = 1/);
assert.match(files["server1/90-vpn-failover.conf"], /net\.ipv4\.conf\.all\.rp_filter = 2/);
assert.match(files["server2/90-vpn-failover.conf"], /net\.ipv4\.ip_forward = 1/);
assert.match(files["server1/wg-exit.conf"], /Table = off/);
assert.match(files["server1/wg-exit.conf"], /MTU = 1380/);
assert.match(files["server1/wg-exit.conf"], new RegExp("PresharedKey = " + keyC.replace(/[.*+?^$()|[\]\\]/g, "\\$&")));
assert.match(files["server1/bird.conf"], /kernel table 200;/);
assert.match(files["server1/bird.conf"], /neighbor 10.77.66.2 dev "wg-exit" local 10.77.66.1;/);
assert.match(files["server1/bird.conf"], /route 0\.0\.0\.0\/0 via 10.77.66.2 bfd;/);
assert.match(files["server1/bird.conf"], /ipv4 table mt_advertised;/);
assert.match(files["server1/bird.conf"], /protocol static mt_export[\s\S]*?route 0\.0\.0\.0\/0 reject;/);
assert.match(files["server1/bird.conf"], /protocol bgp bgp_mt[\s\S]*?local 10\.88\.99\.1 as 65001;[\s\S]*?neighbor 10\.88\.99\.4 as 65010;[\s\S]*?bfd on;/);
assert.match(files["server1/bird.conf"], /table mt_advertised;[\s\S]*?import none;[\s\S]*?export all;[\s\S]*?next hop self;/);
assert.doesNotMatch(files["server1/bird.conf"], /protocol kernel [^{]*\{[^}]*mt_advertised/, "BGP announcement must not enter Server1's kernel table");
assert.doesNotMatch(files["server1/bird.conf"], /route 0\.0\.0\.0\/0 via 10.77.66.2 dev /, "BIRD 2.14 static route must not use dev after an IPv4 nexthop");
assert.match(files["server1/vpn-exit-monitor.sh"], /TABLES=\(200\)/);
assert.match(files["server1/vpn-exit-monitor.sh"], /selected_exit\(\)/);
assert.match(files["server1/vpn-exit-monitor.sh"], /Selected VPN exit changed/);
assert.match(files["server1/vpn-failover-firewall.service"], /-s 10.88.99.0\/24 -o eth0/);
assert.match(files["server1/vpn-failover-firewall.service"], /-s 10.88.100.0\/24 -o eth0/);
assert.match(files["server1/vpn-failover-firewall.service"], /INPUT -i eth0 -p udp --dport 51820 .*vpn-failover-listener/);
assert.match(files["server1/vpn-failover-firewall.service"], /INPUT -i eth0 -p udp --dport 51999 .*vpn-failover-listener/);
assert.match(files["server1/vpn-failover-firewall.service"], /INPUT -i awg0 -p udp -s 10\.88\.99\.4\/32 -d 10\.88\.99\.1\/32 --dport 3784 .*vpn-failover-bfd/);
assert.match(files["server1/vpn-failover-firewall.service"], /INPUT -i awg0 -p tcp -s 10\.88\.99\.4\/32 -d 10\.88\.99\.1\/32 --dport 179 .*vpn-failover-bgp/);
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
assert.doesNotMatch(files["mikrotik/bfd-failover.rsc"], /check-gateway=bfd/, "Unsupported static-route BFD must not be generated");
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
assert.doesNotMatch(files["mikrotik/bfd-failover.rsc"], /\/routing rule add[^\n]*action=lookup-only-in-table/, "VPN fallback must never use lookup-only-in-table");
assert.doesNotMatch(files["mikrotik/bfd-failover.rsc"], /routing-table="VPN"[^\n]*distance=2|distance=2[^\n]*routing-table="VPN"/, "Generator must not create an in-table backup default that prevents main fallback");
{
  const rsc = files["mikrotik/bfd-failover.rsc"];
  const tablePos = rsc.indexOf('/routing table add fib name="VPN"');
  const markPos = rsc.indexOf('new-routing-mark="VPN"');
  assert.ok(tablePos >= 0 && tablePos < markPos, "Custom FIB table must be created before it is referenced by new-routing-mark");
  assert.match(rsc, /\/routing bgp instance add name="vpn-bfd" as=65010 router-id=10\.88\.99\.4 routing-table="VPN"/);
  assert.match(rsc, /\/routing bgp connection add name="vpn-to-server1" instance="vpn-bfd" remote\.address=10\.88\.99\.1 remote\.as=65001 local\.address=10\.88\.99\.4 local\.role=ebgp connect=yes listen=yes use-bfd=yes input\.filter="vpn-bfd-in" output\.filter-chain="vpn-bfd-out"/);
  assert.match(rsc, /chain="vpn-bfd-in" rule="if \(dst == 0\.0\.0\.0\/0\) \{ accept \}"/);
  assert.match(rsc, /chain="vpn-bfd-out" rule="reject"/);
  assert.match(rsc, /\/ip route remove \[find where comment="VPN_BFD_PRIMARY"\]/);
}
assert.match(files["mikrotik/bfd-failover.rsc"], /action=fasttrack-connection/);
assert.match(files["mikrotik/bfd-failover.rsc"], /connection-mark=no-mark/);
assert.match(files["mikrotik/bfd-failover.rsc"], /in-interface-list=!WAN/);
assert.match(files["mikrotik/bfd-failover.rsc"], /connection-state=new connection-mark=no-mark/);
assert.match(files["mikrotik/bfd-failover.rsc"], /in-interface-list=!WAN in-interface=!"wg-awg-proxy-1"/, "Return traffic entering the AWG interface must not be policy-routed back into the tunnel");
assert.match(files["mikrotik/bfd-failover.rsc"], /chain=input protocol=udp dst-port=3784 src-address=10\.88\.99\.1\/32 dst-address=10\.88\.99\.4\/32 in-interface="wg-awg-proxy-1" comment="VPN_BFD_INPUT"/);
assert.match(files["mikrotik/bfd-failover.rsc"], /chain=input protocol=tcp dst-port=179 src-address=10\.88\.99\.1\/32 dst-address=10\.88\.99\.4\/32 in-interface="wg-awg-proxy-1" comment="VPN_BGP_INPUT"/);
assert.match(files["mikrotik/bfd-failover.rsc"], /place-before=\(\$inputDrop->0\)/);
assert.doesNotMatch(files["mikrotik/bfd-failover.rsc"], /^\s*:return\s*$/m, "RouterOS 7.24.x requires a value for :return; watcher must not emit bare :return");
assert.match(files["mikrotik/bfd-failover.rsc"], /:local routeIds \[\/routing route find where routing-table="VPN" dst-address=0\.0\.0\.0\/0 bgp=yes active=yes\]/);
assert.match(files["mikrotik/bfd-failover.rsc"], /add name=VPN-BFD-Watch interval=1s on-event=VPN-BFD-Conntrack\n/);
assert.doesNotMatch(files["mikrotik/bfd-failover.rsc"], /start-time=startup/, "The watcher must start on a running router after import");
assert.match(files["mikrotik/bfd-failover.rsc"], /\/system script run VPN-BFD-Conntrack/);
assert.doesNotMatch(files["mikrotik/bfd-failover.rsc"], /:local routeIds \[[^\n]*gateway=/, "Monitoring must not depend on how RouterOS renders the BGP next hop");
assert.doesNotMatch(files["mikrotik/bfd-failover.rsc"], /monitored route not found/, "Missing dynamic route is a normal DOWN state");
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
assert.match(files["INSTALL.txt"], /server1\/90-vpn-failover\.conf -> \/etc\/sysctl\.d\/90-vpn-failover\.conf/);
assert.match(files["INSTALL.txt"], /sysctl --system/);
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
  s1Public: publicA,
  s2Private: keyB,
  s2Public: publicB,
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

assert.equal(Object.keys(multi).length, 17, "Second exit must add Server1 WG plus Server2 WG/BIRD/sysctl files");
assert.match(multi["server2-2/90-vpn-failover.conf"], /net\.ipv4\.ip_forward = 1/);
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
api.state.extraExits[0].s1Address = "10.77.66.5/29";
api.state.extraExits[0].s2Address = "10.77.66.6/29";
assert.equal(api.validate().ok, false, "Partially overlapping exit transfer subnets must be rejected");
api.state.extraExits[0].s1Address = "10.77.67.1/30";
api.state.extraExits[0].s2Address = "10.77.67.2/30";
api.state.extraExits[0].s1Public = publicB;
assert.equal(api.validate().ok, false, "Mismatched extra exit key pair must be rejected");
api.state.extraExits[0].s1Public = publicA;
element("route-table").value = "252";
assert.equal(api.validate().ok, false, "Multi-exit table range must not cross Linux reserved table 253");
element("route-table").value = "200";

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
assert.doesNotMatch(directMikrotik, /check-gateway=bfd/);
assert.match(directMikrotik, /routing-table="main"/);
assert.match(directMikrotik, /chain="vpn-bfd-in" rule="if \(dst == 203\.0\.113\.55\/32\) \{ accept \}"/);
assert.match(directMikrotik, /chain="vpn-bfd-in" rule="if \(dst == 198\.51\.100\.0\/24\) \{ accept \}"/);
assert.match(api.state.generated["server1/bird.conf"], /route 203\.0\.113\.55\/32 reject;/);
assert.match(api.state.generated["server1/bird.conf"], /route 198\.51\.100\.0\/24 reject;/);
assert.doesNotMatch(directMikrotik, /\/ip firewall mangle/);
assert.doesNotMatch(directMikrotik, /mark-connection/);
assert.doesNotMatch(directMikrotik, /add name=VPN-BFD-Conntrack/);
assert.doesNotMatch(directMikrotik, /\/system script run VPN-BFD-Conntrack/);
assert.doesNotMatch(directMikrotik, /VPN_BFD_FALLBACK/);
assert.doesNotMatch(directMikrotik, /fasttrack-connection/);
assert.doesNotMatch(directMikrotik, /\/routing table add/);
assert.doesNotMatch(directMikrotik, /dst == 0\.0\.0\.0\/0/);
assert.match(api.state.generated["INSTALL.txt"], /BGP-префиксы в main|BGP prefixes in main/i);

element("mt-direct-routes").value = "0.0.0.0/0";
assert.equal(api.validate().ok, true, "Full Internet direct mode must validate");
api.generateFiles();
assert.match(api.state.generated["server1/bird.conf"], /route 0\.0\.0\.0\/1 reject;/);
assert.match(api.state.generated["server1/bird.conf"], /route 128\.0\.0\.0\/1 reject;/);
assert.doesNotMatch(api.state.generated["server1/bird.conf"], /route 0\.0\.0\.0\/0 reject;/,
  "A BGP default in main would lose to a lower-distance ISP default");
assert.match(api.state.generated["mikrotik/bfd-failover.rsc"], /dst == 0\.0\.0\.0\/1/);
assert.match(api.state.generated["mikrotik/bfd-failover.rsc"], /dst == 128\.0\.0\.0\/1/);

element("mt-direct-routes").value = "203.0.113.55, not-an-ip";
assert.equal(api.validate().ok, false, "Invalid direct-route destination must be rejected");
element("mt-direct-routes").value = "";
element("mt-policy-mode").value = "policy";
assert.equal(api.validate().ok, true, "Policy mode must still validate after direct-mode test");

element("mt-dst").value = "198.51.100.17/24";
assert.equal(api.validate().ok, true, "Policy mode permits an explicitly selected non-default prefix");
api.generateFiles();
assert.match(api.state.generated["server1/bird.conf"], /route 198\.51\.100\.0\/24 reject;/);
assert.match(api.state.generated["mikrotik/bfd-failover.rsc"], /dst == 198\.51\.100\.0\/24/);
assert.match(api.state.generated["mikrotik/bfd-failover.rsc"], /routing-table="VPN" dst-address=198\.51\.100\.0\/24 bgp=yes active=yes/);
element("mt-dst").value = "0.0.0.0/0";

element("mt-bgp-as").value = "65001";
assert.equal(api.validate().ok, false, "BGP peers must have distinct ASNs");
element("mt-bgp-as").value = "65010";
element("s1-bgp-as").value = "65535";
assert.equal(api.validate().ok, false, "Reserved/non-private BGP ASNs must be rejected");
element("s1-bgp-as").value = "65001";
element("mt-bgp-instance").value = "unsafe;name";
assert.equal(api.validate().ok, false, "Unsafe BGP instance names must be rejected");
element("mt-bgp-instance").value = "vpn-bfd";
assert.equal(api.validate().ok, true);

// Inter-server WG generation is independent from AWG/wg-in import/generation.
element("config-source-mode").value = "import";
element("wg-exit-source-mode").value = "generate";
element("wg-exit-generate-psk").checked = true;
const importedAwgPrivate = element("awg-private").value;
api.state.extraExits = [{
  id: 2,
  label: "Generated Server2 #2",
  priority: "20",
  s1Interface: "wg-exit2",
  s1Address: "",
  s2Address: "",
  endpoint: "198.51.100.20",
  port: "51831",
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
}];

api.generateInterserverWgMaterial();

assert.match(element("s1-private").value, /^[A-Za-z0-9+/]{43}=$/);
assert.match(element("s1-public").value, /^[A-Za-z0-9+/]{43}=$/);
assert.equal(api.x25519PublicFromPrivate(element("s1-private").value), element("s1-public").value);
assert.equal(api.x25519PublicFromPrivate(element("s2-private").value), element("s2-public").value);
assert.equal(element("s1-psk").value, element("s2-psk").value);
assert.equal(element("awg-private").value, importedAwgPrivate, "Inter-server generation must not replace imported AWG keys");

const generatedExit2 = api.state.extraExits[0];
assert.equal(generatedExit2.s1Address, "10.77.67.1/30");
assert.equal(generatedExit2.s2Address, "10.77.67.2/30");
assert.equal(api.x25519PublicFromPrivate(generatedExit2.s1Private), generatedExit2.s1Public);
assert.equal(api.x25519PublicFromPrivate(generatedExit2.s2Private), generatedExit2.s2Public);
assert.equal(generatedExit2.psk1, generatedExit2.psk2);
assert.equal(api.validate().ok, true, "Generated inter-server WG topology must validate");
api.generateFiles();
assert.match(api.state.generated["server1/wg-exit2.conf"], /Address = 10\.77\.67\.1\/30/);
assert.match(api.state.generated["server2-2/wg-exit.conf"], /Address = 10\.77\.67\.2\/30/);
assert.match(api.state.generated["server1/wg-exit2.conf"], /Endpoint = 198\.51\.100\.20:51831/);

api.state.extraExits = [];

// Local generation mode: deterministic X25519 regression vector + complete AWG/WG output.
assert.equal(
  api.x25519PublicFromPrivate("dwdtCnMYpX08FsFyUbJmRd9ML4frwJkqsXf7pR25LCo="),
  "hSDwCYkwp1R0i33ctD73Wg2/Og0mOBr066SpjqqbTmo=",
  "X25519 public-key derivation must match RFC 7748 vector"
);

element("config-source-mode").value = "generate";
element("wg-exit-source-mode").value = "generate";
element("wg-exit-generate-psk").checked = true;
element("s1-public-endpoint").value = "203.0.113.10";
element("awg-profile").value = "awg31";
element("generate-psk").checked = true;
element("generate-wgin").checked = true;
api.generateVpnMaterial();

assert.match(element("s1-private").value, /^[A-Za-z0-9+/]{43}=$/);
assert.match(element("s1-public").value, /^[A-Za-z0-9+/]{43}=$/);
assert.equal(api.x25519PublicFromPrivate(element("s1-private").value), element("s1-public").value);
assert.equal(api.x25519PublicFromPrivate(element("s2-private").value), element("s2-public").value);
assert.equal(element("s1-psk").value, element("s2-psk").value);
assert.equal(api.x25519PublicFromPrivate(element("awg-private").value), element("awg-public").value);
assert.equal(api.x25519PublicFromPrivate(element("awg-peer-private").value), element("awg-peer-public").value);
assert.equal(api.x25519PublicFromPrivate(element("wg-in-private").value), element("wg-in-public").value);
assert.equal(api.x25519PublicFromPrivate(element("wg-in-peer-private").value), element("wg-in-peer-public").value);
assert.equal(api.validate().ok, true, "Locally generated AWG/WG topology must validate");
element("awg-public").value = publicA;
assert.equal(api.validate().ok, false, "A modified AWG public key must be rejected");
element("awg-public").value = api.x25519PublicFromPrivate(element("awg-private").value);
element("wg-in-peer-allowed").value = "10.88.100.0/24";
assert.equal(api.validate().ok, false, "Generated wg-in client must have a /32 host address");
element("wg-in-peer-allowed").value = "10.88.100.2/32";
element("awg-mtu").value = "invalid";
assert.equal(api.validate().ok, false, "Generated AWG MTU must be validated");
element("awg-mtu").value = "1280";
assert.equal(api.validate().ok, true, "Generated topology must validate after restoring keys and address");
api.generateFiles();

const generatedModeFiles = api.state.generated;
assert.match(generatedModeFiles["server1/awg0.conf"], /ListenPort = 51820/);
assert.match(generatedModeFiles["server1/awg0.conf"], /S1 = 12/);
assert.match(generatedModeFiles["server1/awg0.conf"], /S2 = 12/);
assert.match(generatedModeFiles["server1/awg0.conf"], /S3 = 12/);
assert.match(generatedModeFiles["server1/awg0.conf"], /S4 = 12/);
assert.match(generatedModeFiles["server1/awg0.conf"], /H1 = 1/);
assert.match(generatedModeFiles["server1/awg0.conf"], /H2 = 2/);
assert.match(generatedModeFiles["server1/awg0.conf"], /H3 = 3/);
assert.match(generatedModeFiles["server1/awg0.conf"], /H4 = 4/);
assert.match(generatedModeFiles["server1/awg0.conf"], /HeaderProtectionKey = [A-Za-z0-9+/]{43}=/);
assert.match(generatedModeFiles["server1/awg0.conf"], /ContentPaddingAddition = 10-100/);
assert.match(generatedModeFiles["server1/awg0.conf"], /RekeyAfterTime = 100-120/);
assert.match(generatedModeFiles["server1/awg0.conf"], /RekeyTimeout = 3-7/);
assert.match(generatedModeFiles["server1/awg0.conf"], /RejectAfterTime = 150-180/);
assert.match(generatedModeFiles["server1/awg0.conf"], /KeepaliveTimeout = 5-15/);
assert.match(generatedModeFiles["server1/awg0.conf"], /MaxHandshakeAttempts = 15-20/);
assert.match(generatedModeFiles["server1/awg0.conf"], /RandomTrailers = on/);
assert.match(generatedModeFiles["server1/awg0.conf"], /DisableCookies = on/);
assert.doesNotMatch(generatedModeFiles["server1/awg0.conf"], /^I1\s*=/m, "Server config should not emit CPS I-packets");
assert.doesNotMatch(generatedModeFiles["clients/awg0-client.conf"], /^I[1-5]\s*=/m, "CPS I1-I5 must be opt-in");
assert.match(generatedModeFiles["clients/awg0-client.conf"], /PersistentKeepalive = 25-35/);
assert.match(generatedModeFiles["server1/awg0.conf"], /AllowedIPs = 10\.88\.99\.4\/32/);
assert.match(generatedModeFiles["clients/awg0-client.conf"], /Endpoint = 203\.0\.113\.10:51820/);
assert.match(generatedModeFiles["clients/awg0-client.conf"], /AllowedIPs = 0\.0\.0\.0\/0/);
assert.match(generatedModeFiles["clients/wg-in-client.conf"], /Endpoint = 203\.0\.113\.10:51999/);
assert.match(generatedModeFiles["clients/wg-in-client.conf"], /Address = 10\.88\.100\.2\/32/);
assert.match(generatedModeFiles["server1/vpn-failover-firewall.service"], /--dport 51820 .*vpn-failover-listener/);
assert.match(generatedModeFiles["server1/vpn-failover-firewall.service"], /--dport 51999 .*vpn-failover-listener/);
assert.match(generatedModeFiles["INSTALL.txt"], /server1\/awg0\.conf -> \/etc\/amnezia\/amneziawg\/awg0\.conf/);
assert.match(generatedModeFiles["INSTALL.txt"], /systemctl enable --now awg-quick@awg0/);
assert.match(generatedModeFiles["INSTALL.txt"], /chmod 600 \/etc\/amnezia\/amneziawg\/awg0\.conf/);
assert.match(generatedModeFiles["INSTALL.txt"], /clients\/wg-in-client\.conf/);
api.state.lang = "en";
api.generateFiles();
assert.match(api.state.generated["INSTALL.txt"], /chmod 755 \/usr\/local\/sbin\/vpn-exit-monitor\.sh/);
assert.match(api.state.generated["INSTALL.txt"], /systemctl enable --now awg-quick@awg0/);
api.state.lang = "ru";

// AWG 3.0 keeps Header Protection/timing parameters but omits 3.1-only toggles.
element("awg-profile").value = "awg3";
api.generateVpnMaterial();
assert.equal(api.validate().ok, true, "AWG 3.0 generation must validate");
api.generateFiles();
const awg30Server = api.state.generated["server1/awg0.conf"];
const awg30Client = api.state.generated["clients/awg0-client.conf"];
assert.match(awg30Server, /HeaderProtectionKey = [A-Za-z0-9+/]{43}=/);
assert.match(awg30Server, /ContentPaddingAddition = 10-100/);
assert.doesNotMatch(awg30Server, /RandomTrailers =/);
assert.doesNotMatch(awg30Server, /DisableCookies =/);
assert.match(awg30Client, /PersistentKeepalive = 25-35/);

element("config-source-mode").value = "import";

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
element("s1-exit-if").value = "wg-exit@backup";
assert.equal(api.validate().ok, false, "Interface names unsupported by wg-quick must be rejected");
element("s1-exit-if").value = "wg-exit";

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
