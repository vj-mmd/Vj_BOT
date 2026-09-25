import { keyboard } from "../../lib/keyboards.js";
import { setState, getState, clearState } from "../../lib/state.js";
import {
  getCategories,
  getProductIndex,
  getProduct,
  saveProduct,
  deleteProduct,
  getPanelIndex,
  getPanel,
  getProfiles,
  logAction,
} from "../../lib/kv.js";

function toman(n) {
  return n.toLocaleString("en-US") + " تومان";
}

export async function showProductsAdmin(env, telegram, chatId, messageId) {
  const ids = await getProductIndex(env.BOT_KV);
  const products = await Promise.all(ids.map((id) => getProduct(env.BOT_KV, id)));
  const buttons = products
    .filter(Boolean)
    .map((p) => ({ text: `${p.active ? "🟢" : "🔴"} ${p.name}`, data: `admin:prod:view:${p.id}` }));
  buttons.push({ text: "➕ افزودن محصول", data: "admin:prod:add" });

  await telegram.editOrSend(chatId, messageId, "🛍 <b>مدیریت محصولات</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:main" }),
  });
}

export async function showProductDetailAdmin(env, telegram, chatId, messageId, productId) {
  const product = await getProduct(env.BOT_KV, productId);
  if (!product) return;
  const text =
    `🛍 <b>${product.name}</b>\n\n` +
    `💰 ${toman(product.price)}\n📦 ${product.volume_gb}GB\n⏳ ${product.duration_days} روز\n` +
    `🔌 ${product.protocol}\n📂 دسته: ${product.category_id}\n🖥 پنل: ${product.panel_id}`;

  const buttons = [
    product.active
      ? { text: "🔴 غیرفعال کردن", data: `admin:prod:toggle:${product.id}` }
      : { text: "🟢 فعال کردن", data: `admin:prod:toggle:${product.id}` },
    { text: "🗑 حذف محصول", data: `admin:prod:delete:${product.id}` },
  ];
  await telegram.editOrSend(chatId, messageId, text, { reply_markup: keyboard(buttons, { back: "admin:products" }) });
}

export async function toggleProduct(env, telegram, chatId, messageId, adminId, productId) {
  const product = await getProduct(env.BOT_KV, productId);
  if (!product) return;
  product.active = !product.active;
  await saveProduct(env.BOT_KV, product);
  await logAction(env.BOT_KV, adminId, "toggle_product", { id: productId, active: product.active });
  await showProductDetailAdmin(env, telegram, chatId, messageId, productId);
}

export async function removeProduct(env, telegram, chatId, messageId, adminId, productId) {
  await deleteProduct(env.BOT_KV, productId);
  await logAction(env.BOT_KV, adminId, "delete_product", productId);
  await showProductsAdmin(env, telegram, chatId, messageId);
}

// ---------- add-product wizard ----------
// Steps: pick category -> name -> price -> volume -> days -> protocol ->
// description -> pick panel -> pick profile -> save.

export async function startAddProduct(env, telegram, chatId, messageId, adminId) {
  const categories = (await getCategories(env.BOT_KV)).filter((c) => c.active);
  if (categories.length === 0) {
    await telegram.editOrSend(chatId, messageId, "ابتدا یک دسته‌بندی فعال بسازید.", {
      reply_markup: keyboard([], { back: "admin:products" }),
    });
    return;
  }
  const buttons = categories.map((c) => ({ text: c.name, data: `admin:prod:add:cat:${c.id}` }));
  await telegram.editOrSend(chatId, messageId, "دسته‌بندی محصول را انتخاب کنید:", {
    reply_markup: keyboard(buttons, { back: "admin:products" }),
  });
}

export async function addProductPickCategory(env, telegram, chatId, messageId, adminId, categoryId) {
  await setState(env, adminId, { step: "admin_add_product_name", data: { category_id: categoryId } });
  await telegram.editOrSend(chatId, messageId, "نام محصول را ارسال کنید:\n(مثال: VLESS ماهانه 50GB)", {
    reply_markup: keyboard([], { back: "admin:products" }),
  });
}

const FIELD_SEQUENCE = [
  { step: "admin_add_product_name", field: "name", next: "admin_add_product_price", prompt: "💰 قیمت را به تومان وارد کنید:" },
  { step: "admin_add_product_price", field: "price", isNumber: true, next: "admin_add_product_volume", prompt: "📦 حجم را به GB وارد کنید (برای نامحدود 0):" },
  { step: "admin_add_product_volume", field: "volume_gb", isNumber: true, next: "admin_add_product_days", prompt: "⏳ مدت را به روز وارد کنید:" },
  { step: "admin_add_product_days", field: "duration_days", isNumber: true, next: "admin_add_product_protocol", prompt: "🔌 پروتکل را وارد کنید (vless/vmess/trojan/shadowsocks):" },
  { step: "admin_add_product_protocol", field: "protocol", next: "admin_add_product_desc", prompt: "📝 توضیح محصول را ارسال کنید (یا برای رد شدن - بفرستید):" },
  { step: "admin_add_product_desc", field: "description", next: null, prompt: null },
];

export async function handleProductTextInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const raw = (message.text || "").trim();

  const current = FIELD_SEQUENCE.find((f) => f.step === state.step);
  if (!current) return;

  let value = raw;
  if (current.isNumber) {
    value = parseInt(raw.replace(/[^\d]/g, ""), 10);
    if (Number.isNaN(value)) {
      await telegram.sendMessage(chatId, "❌ لطفاً فقط عدد ارسال کنید.");
      return;
    }
  }
  if (current.field === "description" && raw === "-") value = "";

  const data = { ...state.data, [current.field]: value };

  if (current.next) {
    await setState(env, adminId, { step: current.next, data });
    await telegram.sendMessage(chatId, current.prompt);
    return;
  }

  // Description was last text field -> move on to panel selection
  await clearState(env, adminId);
  const panelIds = await getPanelIndex(env.BOT_KV);
  const panels = (await Promise.all(panelIds.map((id) => getPanel(env.BOT_KV, id)))).filter((p) => p && p.active);
  if (panels.length === 0) {
    await telegram.sendMessage(chatId, "❌ هیچ پنل فعالی وجود ندارد. ابتدا یک پنل اضافه کنید.");
    return;
  }
  await setState(env, adminId, { step: "admin_add_product_panel_pending", data });
  const buttons = panels.map((p) => ({ text: p.name, data: `admin:prod:add:panel:${p.id}` }));
  await telegram.sendMessage(chatId, "🖥 پنل مربوط به این محصول را انتخاب کنید:", {
    reply_markup: keyboard(buttons, { perRow: 1 }),
  });
}

export async function addProductPickPanel(env, telegram, chatId, messageId, adminId, panelId, stateData) {
  const profiles = (await getProfiles(env.BOT_KV, panelId)).filter((p) => p.active);
  if (profiles.length === 0) {
    await telegram.editOrSend(chatId, messageId, "❌ این پنل هیچ پروفایل فعالی ندارد. ابتدا یک پروفایل اضافه کنید.", {
      reply_markup: keyboard([], { back: "admin:products" }),
    });
    return;
  }
  await setState(env, adminId, { step: "admin_add_product_profile_pending", data: { ...stateData, panel_id: panelId } });
  const buttons = profiles.map((p) => ({ text: p.name, data: `admin:prod:add:profile:${p.id}` }));
  await telegram.editOrSend(chatId, messageId, "👤 پروفایل مربوطه را انتخاب کنید:", {
    reply_markup: keyboard(buttons, { perRow: 1 }),
  });
}

export async function addProductPickProfile(env, telegram, chatId, messageId, adminId, profileId, stateData) {
  const product = {
    ...stateData,
    profile_id: profileId,
    active: true,
  };
  await saveProduct(env.BOT_KV, product);
  await clearState(env, adminId);
  await logAction(env.BOT_KV, adminId, "add_product", product.id);

  await telegram.editOrSend(chatId, messageId, `✅ محصول «${product.name}» اضافه شد.`, {
    reply_markup: keyboard([{ text: "📋 بازگشت به لیست", data: "admin:products" }], { perRow: 1 }),
  });
}
