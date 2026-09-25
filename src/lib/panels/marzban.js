// Adapter for Marzban panels (https://github.com/Gozargah/Marzban).
// Docs: {panel_url}/docs for the exact schema of your panel version -
// field names have changed slightly between Marzban releases, so double
// check `proxies` / `inbounds` shape against your own panel before going live.

async function getToken(panel) {
  const res = await fetch(`${panel.url}/api/admin/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: panel.username, password: panel.password }),
  });
  if (!res.ok) throw new Error(`marzban auth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

export async function testConnection(panel) {
  try {
    await getToken(panel);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// profile: { protocol: 'vless'|'vmess'|'trojan'|'shadowsocks', inbound_tag, flow? }
export async function createUser(panel, profile, { username, volumeGB, days }) {
  const token = await getToken(panel);
  const expire = Math.floor(Date.now() / 1000) + days * 86400;
  const body = {
    username,
    proxies: { [profile.protocol]: profile.settings || {} },
    inbounds: { [profile.protocol]: [profile.inbound_tag] },
    expire,
    data_limit: volumeGB > 0 ? volumeGB * 1024 * 1024 * 1024 : 0,
    data_limit_reset_strategy: "no_reset",
    status: "active",
  };
  const res = await fetch(`${panel.url}/api/user`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`marzban create user failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    username: data.username,
    subscription_url: panel.url + data.subscription_url,
    config_links: data.links || [],
    raw: data,
  };
}

export async function getUser(panel, username) {
  const token = await getToken(panel);
  const res = await fetch(`${panel.url}/api/user/${encodeURIComponent(username)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    username: data.username,
    used_traffic_bytes: data.used_traffic || 0,
    data_limit_bytes: data.data_limit || 0,
    expire: data.expire,
    status: data.status,
    subscription_url: panel.url + data.subscription_url,
  };
}

export async function deleteUser(panel, username) {
  const token = await getToken(panel);
  await fetch(`${panel.url}/api/user/${encodeURIComponent(username)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function disableUser(panel, username) {
  const token = await getToken(panel);
  await fetch(`${panel.url}/api/user/${encodeURIComponent(username)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "disabled" }),
  });
}
