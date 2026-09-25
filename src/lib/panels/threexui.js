// Adapter for 3x-ui / Sanaei panels (https://github.com/MHSanaei/3x-ui).
// This panel authenticates with a session cookie rather than a bearer token,
// and client management is nested inside an "inbound". Field names/paths can
// differ slightly by fork/version - verify against your panel's /panel/api docs.

async function login(panel) {
  const res = await fetch(`${panel.url}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: panel.username, password: panel.password }),
    redirect: "manual",
  });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("3x-ui login failed: no session cookie returned");
  return cookie.split(";")[0];
}

export async function testConnection(panel) {
  try {
    await login(panel);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// profile: { inbound_id, protocol }
export async function createUser(panel, profile, { username, volumeGB, days }) {
  const cookie = await login(panel);
  const client = {
    id: crypto.randomUUID(),
    email: username,
    enable: true,
    expiryTime: Date.now() + days * 86400 * 1000,
    totalGB: volumeGB > 0 ? volumeGB * 1024 * 1024 * 1024 : 0,
  };
  const res = await fetch(`${panel.url}/panel/api/inbounds/addClient`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: profile.inbound_id,
      settings: JSON.stringify({ clients: [client] }),
    }),
  });
  if (!res.ok) throw new Error(`3x-ui add client failed: ${res.status} ${await res.text()}`);
  return {
    username,
    client_id: client.id,
    subscription_url: `${panel.subscription_base_url || panel.url}/sub/${client.id}`,
    raw: client,
  };
}

export async function getUser(panel, inboundId, email) {
  const cookie = await login(panel);
  const res = await fetch(`${panel.url}/panel/api/inbounds/getClientTraffics/${encodeURIComponent(email)}`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const t = data.obj;
  if (!t) return null;
  return {
    username: email,
    used_traffic_bytes: (t.up || 0) + (t.down || 0),
    data_limit_bytes: t.total || 0,
    expire: t.expiryTime ? Math.floor(t.expiryTime / 1000) : null,
    status: t.enable ? "active" : "disabled",
  };
}
