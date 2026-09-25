// Multi-step flows (e.g. "type a discount code", "enter product price")
// need to remember what the bot is waiting for from a given user.
// Stored in the BOT_SESSIONS KV with a short TTL so abandoned flows self-clean.

const TTL_SECONDS = 60 * 30; // 30 minutes

export async function setState(env, userId, state) {
  await env.BOT_SESSIONS.put(`state:${userId}`, JSON.stringify(state), {
    expirationTtl: TTL_SECONDS,
  });
}

export async function getState(env, userId) {
  return env.BOT_SESSIONS.get(`state:${userId}`, "json");
}

export async function clearState(env, userId) {
  await env.BOT_SESSIONS.delete(`state:${userId}`);
}
