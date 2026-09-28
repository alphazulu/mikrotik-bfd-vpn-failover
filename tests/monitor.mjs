import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Run the generated monitor against a synthetic Netlink stream. This checks
// the complete failover/failback behavior without changing host routes.
const root = path.resolve(import.meta.dirname, "..");
const monitor = path.join(root, "tests/.generated/multi-vpn-exit-monitor.sh");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpn-exit-monitor-"));
try {
  const fake = (name, body) => fs.writeFileSync(path.join(dir, name), "#!/bin/bash\n" + body, { mode: 0o755 });
  fake("ip", `
if [[ "$1 $2" == "monitor route" ]]; then
    printf 201 > "$ROUTE_STATE"
    printf 'Deleted default via 10.77.66.2 dev wg-exit table 200 proto bird\\n'
    sleep 0.4
    printf main > "$ROUTE_STATE"
    printf 'Deleted default via 10.77.67.2 dev wg-exit2 table 201 proto bird\\n'
    sleep 0.4
    printf 200 > "$ROUTE_STATE"
    printf 'default via 10.77.66.2 dev wg-exit table 200 proto bird\\n'
    sleep 0.4
    printf 'Deleted default via 10.77.67.2 dev wg-exit2 table 201 proto bird\\n'
    exit 0
fi
if [[ "$1 $2 $3 $4 $5 $6 $7" == "-4 route show table "* ]]; then
    active="$(cat "$ROUTE_STATE")"
    if [[ "$5" == "$active" ]]; then
        printf 'default via 10.77.66.2 dev wg-exit proto bird\\n'
    fi
    exit 0
fi
exit 1
`);
  fake("logger", `printf '%s\\n' "$*" >> "$EVENT_LOG"\n`);
  fake("conntrack", `printf '%s\\n' "$*" >> "$CONNTRACK_LOG"\n`);
  const routeState = path.join(dir, "route-state");
  const eventLog = path.join(dir, "events");
  const conntrackLog = path.join(dir, "conntrack-events");
  fs.writeFileSync(routeState, "200");
  const result = spawnSync("bash", [monitor], {
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, PATH: dir + ":" + process.env.PATH, ROUTE_STATE: routeState, EVENT_LOG: eventLog, CONNTRACK_LOG: conntrackLog }
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const events = fs.readFileSync(eventLog, "utf8");
  const deletions = fs.readFileSync(conntrackLog, "utf8").trim().split("\n");
  assert.match(events, /Selected VPN exit changed: 200\|.* -> 201\|/);
  assert.match(events, /Selected VPN exit changed: 201\|.* -> main/);
  assert.match(events, /Selected VPN exit changed: main -> 200\|/);
  assert.equal(deletions.length, 6, "Each of three exit changes must flush AWG and wg-in conntrack once: " + events + " / " + deletions.join("; "));
  assert.equal(deletions.filter((line) => line === "-D -s 10.88.99.0/24").length, 3);
  assert.equal(deletions.filter((line) => line === "-D -s 10.88.100.0/24").length, 3);

  // The hand-written single-exit example must behave like the generator.
  fs.writeFileSync(routeState, "200");
  fs.rmSync(eventLog);
  fs.rmSync(conntrackLog);
  const single = spawnSync("bash", [path.join(root, "configs/server1/vpn-exit-monitor.sh")], {
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, PATH: dir + ":" + process.env.PATH, ROUTE_STATE: routeState, EVENT_LOG: eventLog, CONNTRACK_LOG: conntrackLog }
  });
  assert.equal(single.status, 0, single.stderr || String(single.error));
  const singleEvents = fs.readFileSync(eventLog, "utf8");
  assert.match(singleEvents, /Selected VPN exit changed: 200\|.* -> main/);
  assert.match(singleEvents, /Selected VPN exit changed: main -> 200\|/);
  assert.equal(fs.readFileSync(conntrackLog, "utf8").trim().split("\n").length, 2,
    "Single-exit example must flush only on effective primary/main transitions");
  console.log("Generated monitor failover/failback test: OK");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
