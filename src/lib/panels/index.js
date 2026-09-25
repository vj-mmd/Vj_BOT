import * as marzban from "./marzban.js";
import * as threexui from "./threexui.js";
import * as pasarguard from "./pasarguard.js";

// Add new panel software here. `type` matches panel.type stored in KV.
const ADAPTERS = {
  marzban,
  threexui,
  pasarguard,
};

export function adapterFor(panel) {
  const a = ADAPTERS[panel.type];
  if (!a) throw new Error(`no adapter for panel type: ${panel.type}`);
  return a;
}

export async function testConnection(panel) {
  return adapterFor(panel).testConnection(panel);
}

export async function provisionUser(panel, profile, opts) {
  return adapterFor(panel).createUser(panel, profile, opts);
}
