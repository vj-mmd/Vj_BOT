// Short-lived distributed locks. Durable Objects are preferred because a DO
// serializes acquire/release requests for the same user. KV fallback keeps
// older deployments functional, but is intentionally best-effort.
function token() { return `${Date.now()}-${crypto.randomUUID()}`; }

export async function withUserLock(env, userId, fn, ttlMs = 8000) {
  if (env.WALLET_LOCK) {
    const stub = env.WALLET_LOCK.get(env.WALLET_LOCK.idFromName(`user:${userId}`));
    const lockToken = token();
    let acquired = false;
    try {
      const r = await stub.fetch("https://lock/acquire", { method: "POST", body: JSON.stringify({ token: lockToken, ttlMs }) });
      acquired = r.ok;
      if (!acquired) throw new Error("wallet is busy; please retry");
      return await fn();
    } finally {
      if (acquired) await stub.fetch("https://lock/release", { method: "POST", body: JSON.stringify({ token: lockToken }) }).catch(() => {});
    }
  }
  const key = `lock:user:${userId}`;
  const lockToken = token();
  const existing = await env.BOT_KV.get(key);
  if (existing) throw new Error("wallet is busy; please retry");
  await env.BOT_KV.put(key, lockToken, { expirationTtl: Math.max(2, Math.ceil(ttlMs / 1000)) });
  try { return await fn(); }
  finally { if ((await env.BOT_KV.get(key)) === lockToken) await env.BOT_KV.delete(key); }
}

export async function withSequenceLock(env, seqKey, fn, ttlMs = 5000) {
  if (!env.WALLET_LOCK) {
    const key=`lock:seq:${seqKey}`, t=token(), existing=await env.BOT_KV.get(key); if(existing) throw Error("sequence busy; please retry");
    await env.BOT_KV.put(key,t,{expirationTtl:Math.max(2,Math.ceil(ttlMs/1000))});
    try{return await fn();}finally{if((await env.BOT_KV.get(key))===t)await env.BOT_KV.delete(key);}
  }
  const stub = env.WALLET_LOCK.get(env.WALLET_LOCK.idFromName(`seq:${seqKey}`));
  const lockToken = token();
  let acquired = false;
  try {
    const r = await stub.fetch("https://lock/acquire", { method: "POST", body: JSON.stringify({ token: lockToken, ttlMs }) });
    acquired = r.ok;
    if (!acquired) throw new Error("sequence busy; please retry");
    return await fn();
  } finally {
    if (acquired) await stub.fetch("https://lock/release", { method: "POST", body: JSON.stringify({ token: lockToken }) }).catch(() => {});
  }
}

export class WalletLock {
  constructor(state) { this.state = state; this.owner = null; this.until = 0; }
  async fetch(request) {
    const body = await request.json().catch(() => ({}));
    const now = Date.now();
    if (new URL(request.url).pathname === "/acquire") {
      if (this.owner && this.until > now && this.owner !== body.token) return new Response("busy", { status: 409 });
      this.owner = body.token;
      this.until = now + Math.min(15000, Math.max(1000, Number(body.ttlMs || 8000)));
      return new Response("ok");
    }
    if (new URL(request.url).pathname === "/release") {
      if (this.owner === body.token) { this.owner = null; this.until = 0; }
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }
}
