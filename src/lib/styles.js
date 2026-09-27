// Request-scoped(ish) cache of settings.button_styles, so every keyboard
// built anywhere in the bot (src/lib/keyboards.js) can auto-color its
// buttons without every handler having to fetch+thread settings manually.
//
// Loaded once per incoming update in src/index.js via loadRuntimeSettings().
// button_styles is small, rarely-changed, shop-wide admin config (not
// per-user data), so a plain module-level cache is safe here: the only
// downside of two requests overlapping is a color very briefly reflecting
// the previous admin edit, never a wrong answer to the wrong user.

import { getSettings } from "./kv.js";

let cache = {};

export async function loadRuntimeSettings(kv) {
  const settings = await getSettings(kv);
  cache = settings.button_styles || {};
  return settings;
}

export function getCachedStyles() {
  return cache;
}

export function setCachedStyle(key, value) {
  cache = { ...cache, [key]: value };
}

// Resolves a button's callback_data to a configured color, trying an exact
// match first and then falling back to the longest registered prefix (see
// src/lib/buttonStyleRegistry.js for what "registered" means in practice —
// in practice this just walks the keys the admin has actually set).
export function resolveStyle(data) {
  if (!data) return undefined;
  const direct = cache[data];
  if (direct && direct !== "default") return direct;

  let bestKey = null;
  for (const key of Object.keys(cache)) {
    if (key === data || key === "__back__") continue;
    if (data.startsWith(key + ":") && (!bestKey || key.length > bestKey.length)) {
      bestKey = key;
    }
  }
  if (bestKey) {
    const val = cache[bestKey];
    if (val && val !== "default") return val;
  }
  return undefined;
}
