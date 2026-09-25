import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import { getDiscountIndex, getDiscount, saveDiscount, deleteDiscount, logAction } from "../../lib/kv.js";

export async function showDiscountsAdmin(env, telegram, chatId, messageId) {
  const codes = await getDiscountIndex(env.BOT_KV);
  const discounts = await Promise.all(codes.map((c) => getDiscount(env.BOT_KV, c)));
  const buttons = discounts
    .filter(Boolean)
    .map((d) => ({ text: `${d.active ? "🟢" : "🔴"} ${d.code}`, data: `admin:disc:view:${d.code}` }));
  buttons.push({ text: "➕ ایجاد کد", data: "admin:disc:add" });

  await telegram.editOrSend(chatId, messageId, "🎟 <b>مدیریت تخفیف‌ها</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:main" }),
  });
}

export async function showDiscountDetail(env, telegram, chatId, messageId, code) {
  const d = await getDiscount(env.BOT_KV, code);
  if (!d) return;
  const text =
    `🎟 <b>${d.code}</b>\n\n` +
    `نوع: ${d.type === "percent" ? "درصدی" : "مبلغ ثابت"}\n` +
    `مقدار: ${d.value}${d.type === "percent" ? "%" : " تومان"}\n` +
    `تعداد استفاده: ${d.uses || 0}${d.max_uses ? ` / ${d.max_uses}` : ""}\n` +
    `انقضا: ${d.expires_at ? new Date(d.expires_at).toLocaleDateString("fa-IR") : "ندارد"}`;

  const buttons = [
    d.active ? { text: "🔴 غیرفعال", data: `admin:disc:toggle:${d.code}` } : { text: "🟢 فعال", data: `admin:disc:toggle:${d.code}` },
    { text: "📊 آمار استفاده", data: `admin:disc:stats:${d.code}` },
    { text: "🗑 حذف", data: `admin:disc:delete:${d.code}` },
  ];
  await telegram.editOrSend(chatId, messageId, text, { reply_markup: keyboard(buttons, { back: "admin:discounts" }) });
}

export async function startAddDiscount(env, telegram, chatId, messageId, adminId) {
  await setState(env, adminId, { step: "admin_add_disc_code", data: {} });
  await telegram.editOrSend(chatId, messageId, "🎟 کد تخفیف را وارد کنید (مثال: SUMMER20):", {
    reply_markup: keyboard([], { back: "admin:discounts" }),
  });
}

export async function pickDiscountType(env, telegram, chatId, messageId, adminId, code) {
  await setState(env, adminId, { step: "admin_add_disc_type_pending", data: { code } });
  const buttons = [
    { text: "درصدی", data: "admin:disc:add:type:percent" },
    { text: "مبلغ ثابت", data: "admin:disc:add:type:fixed" },
  ];
  await telegram.editOrSend(chatId, messageId, "نوع تخفیف را انتخاب کنید:", { reply_markup: keyboard(buttons, { perRow: 2 }) });
}

const FIELDS = [
  { step: "admin_add_disc_value", field: "value", isNumber: true, next: "admin_add_disc_maxuses", prompt: "🔢 حداکثر تعداد استفاده را وارد کنید (0 = نامحدود):" },
  { step: "admin_add_disc_maxuses", field: "max_uses", isNumber: true, next: "admin_add_disc_days", prompt: "📅 تعداد روز تا انقضای کد را وارد کنید (0 = بدون انقضا):" },
  { step: "admin_add_disc_days", field: "expire_days", isNumber: true, next: null, prompt: null },
];

export async function pickDiscountTypeDone(env, telegram, chatId, messageId, adminId, type, code) {
  await setState(env, adminId, { step: "admin_add_disc_value", data: { code, type } });
  await telegram.editOrSend(chatId, messageId, "💯 مقدار تخفیف را وارد کنید:", { reply_markup: keyboard([]) });
}

export async function handleDiscountTextInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const raw = (message.text || "").trim();

  if (state.step === "admin_add_disc_code") {
    if (!raw) {
      await telegram.sendMessage(chatId, "❌ کد نامعتبر است.");
      return;
    }
    const existing = await getDiscount(env.BOT_KV, raw);
    if (existing) {
      await telegram.sendMessage(chatId, "❌ این کد قبلاً ثبت شده. کد دیگری وارد کنید:");
      return;
    }
    await clearState(env, adminId);
    await pickDiscountType(env, telegram, chatId, null, adminId, raw.toUpperCase());
    return;
  }

  const current = FIELDS.find((f) => f.step === state.step);
  if (!current) return;

  let value = raw;
  if (current.isNumber) {
    value = parseInt(raw.replace(/[^\d]/g, ""), 10);
    if (Number.isNaN(value)) {
      await telegram.sendMessage(chatId, "❌ لطفاً فقط عدد ارسال کنید.");
      return;
    }
  }
  const data = { ...state.data, [current.field]: value };

  if (current.next) {
    await setState(env, adminId, { step: current.next, data });
    await telegram.sendMessage(chatId, current.prompt);
    return;
  }

  await clearState(env, adminId);
  const discount = {
    code: data.code,
    type: data.type,
    value: data.value,
    max_uses: data.max_uses || 0,
    uses: 0,
    expires_at: data.expire_days > 0 ? Date.now() + data.expire_days * 86400 * 1000 : null,
    active: true,
  };
  await saveDiscount(env.BOT_KV, discount);
  await logAction(env.BOT_KV, adminId, "add_discount", discount.code);

  await telegram.sendMessage(chatId, `✅ کد تخفیف «${discount.code}» ساخته شد.`, {
    reply_markup: keyboard([{ text: "📋 بازگشت", data: "admin:discounts" }], { perRow: 1 }),
  });
}

export async function toggleDiscount(env, telegram, chatId, messageId, adminId, code) {
  const d = await getDiscount(env.BOT_KV, code);
  if (!d) return;
  d.active = !d.active;
  await saveDiscount(env.BOT_KV, d);
  await logAction(env.BOT_KV, adminId, "toggle_discount", code);
  await showDiscountDetail(env, telegram, chatId, messageId, code);
}

export async function removeDiscount(env, telegram, chatId, messageId, adminId, code) {
  await deleteDiscount(env.BOT_KV, code);
  await logAction(env.BOT_KV, adminId, "delete_discount", code);
  await showDiscountsAdmin(env, telegram, chatId, messageId);
}
