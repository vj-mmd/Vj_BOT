import { keyboard } from "../lib/keyboards.js";
import { getUserServices, getService, getPanel, saveService, getUser, addTransaction, addTransactionSafe, getProduct, getTexts, getProfiles, getSettings } from "../lib/kv.js";
import { adapterFor } from "../lib/panels/index.js";
import { withUserLock } from "../lib/locks.js";
import { reportRenewal } from "../lib/report.js";
import { logRenewal } from "../lib/log.js";

function toman(n) {
  return `${n.toLocaleString("en-US")} تومان`;
}

function isExpired(service) {
  return Date.now() > service.expires_at;
}

function statusLabel(service) {
  if (service.status === "disabled") return "⛔ غیرفعال";
  if (Date.now() > service.expires_at) return "🔴 منقضی شده";
  return "🟢 فعال";
}

export async function showServiceList(env, telegram, chatId, messageId, userId) {
  const services = await getUserServices(env.BOT_KV, userId);
  const texts = await getTexts(env.BOT_KV);
  if (services.length === 0) {
    await telegram.editOrSend(chatId, messageId, texts.services_empty, {
      reply_markup: keyboard([{ text: "🛒 خرید اشتراک", data: "buy:categories" }], {
        perRow: 1,
        back: "menu:main",
