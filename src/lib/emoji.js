// Global emoji theme. Values are stored in config:settings.emojis.
// All outgoing text/captions and inline keyboard labels pass through replaceEmojis().
export const DEFAULT_EMOJIS = {
  check: "✅", cross: "❌", warning: "⚠️", success: "🎉", info: "ℹ️",
  back: "⬅️", home: "🏠", user: "👤", users: "👥", admin: "👨‍💼",
  support: "☎️", ai: "🤖", wallet: "💰", card: "💳", receipt: "🧾",
  service: "📦", buy: "🛒", test: "🎁", settings: "⚙️", backup: "💾",
  broadcast: "📢", stats: "📊", time: "⏳", warning2: "🚨", link: "🔗",
  lock: "🔒", unlock: "🔓", trash: "🗑️", search: "🔎", gift: "🎁",
  rocket: "🚀", robot: "🤖", fire: "🔥", phone: "📱", calendar: "📅",
};

let cache = { ...DEFAULT_EMOJIS };

export function loadEmojiCache(emojis = {}) {
  cache = { ...DEFAULT_EMOJIS, ...(emojis || {}) };
  return cache;
}
export function getEmojis() { return cache; }

export function replaceEmojis(value) {
  if (value === undefined || value === null) return value;
  let s = String(value);
  // One-pass replacement prevents a replacement value from being replaced again.
  const entries = Object.entries(DEFAULT_EMOJIS)
    .map(([key, source]) => [source, cache[key] || source])
    .filter(([source, target]) => source !== target)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [source, target] of entries) {
    s = s.split(source).join(target);
  }
  return s;
}
