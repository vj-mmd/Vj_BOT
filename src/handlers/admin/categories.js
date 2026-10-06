import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import { getCategories, saveCategories, logAction } from "../../lib/kv.js";

export async function showCategoriesAdmin(env, telegram, chatId, messageId) {
  const categories = await getCategories(env.BOT_KV);
  const buttons = categories
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((c) => ({ text: `${c.active ? "🟢" : "🔴"} ${c.name}`, data: `admin:cat:view:${c.id}` }));
  buttons.push({ text: "➕ افزودن", data: "admin:cat:add" });

  await telegram.editOrSend(chatId, messageId, "📂 <b>مدیریت دسته‌بندی‌ها</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:main" }),
  });
}

export async function showCategoryDetail(env, telegram, chatId, messageId, categoryId) {
  const categories = await getCategories(env.BOT_KV);
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat) return;

  const buttons = [
    { text: "✏️ ویرایش نام", data: `admin:cat:rename:${cat.id}` },
    cat.active ? { text: "🔴 غیرفعال", data: `admin:cat:toggle:${cat.id}` } : { text: "🟢 فعال", data: `admin:cat:toggle:${cat.id}` },
    { text: "🗑 حذف", data: `admin:cat:delete:${cat.id}` },
  ];
  await telegram.editOrSend(chatId, messageId, `📂 ${cat.name}`, {
    reply_markup: keyboard(buttons, { back: "admin:categories" }),
  });
}

export async function promptAddCategory(env, telegram, chatId, messageId, adminId) {
  await setState(env, adminId, { step: "admin_add_category" });
  await telegram.editOrSend(chatId, messageId, "📂 نام دسته‌بندی جدید را ارسال کنید:", {
    reply_markup: keyboard([], { back: "admin:categories" }),
  });
}

export async function promptRenameCategory(env, telegram, chatId, messageId, adminId, categoryId) {
  await setState(env, adminId, { step: "admin_rename_category", category_id: categoryId });
  await telegram.editOrSend(chatId, messageId, "📂 نام جدید را ارسال کنید:", {
    reply_markup: keyboard([], { back: `admin:cat:view:${categoryId}` }),
  });
}

export async function handleCategoryTextInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const name = (message.text || "").trim();
  const kv = env.BOT_KV;
  await clearState(env, adminId);

  if (!name) {
    await telegram.sendMessage(chatId, "❌ نام نامعتبر است.");
    return;
  }

  const categories = await getCategories(kv);
  if (state.step === "admin_add_category") {
    const id = (categories.reduce((m, c) => Math.max(m, c.id), 0) || 0) + 1;
    categories.push({ id, name, active: true, order: categories.length });
    await saveCategories(kv, categories);
    await logAction(kv, adminId, "add_category", { id, name });
    await telegram.sendMessage(chatId, "✅ دسته‌بندی اضافه شد.");
  } else {
    const cat = categories.find((c) => c.id === state.category_id);
    if (cat) {
      cat.name = name;
      await saveCategories(kv, categories);
      await logAction(kv, adminId, "rename_category", { id: cat.id, name });
    }
    await telegram.sendMessage(chatId, "✅ نام بروزرسانی شد.");
  }
  await showCategoriesAdmin(env, telegram, chatId, null);
}

export async function toggleCategory(env, telegram, chatId, messageId, adminId, categoryId) {
  const kv = env.BOT_KV;
  const categories = await getCategories(kv);
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat) return;
  cat.active = !cat.active;
  await saveCategories(kv, categories);
  await logAction(kv, adminId, "toggle_category", { id: categoryId, active: cat.active });
  await showCategoryDetail(env, telegram, chatId, messageId, categoryId);
}

export async function deleteCategory(env, telegram, chatId, messageId, adminId, categoryId) {
  const kv = env.BOT_KV;
  const categories = (await getCategories(kv)).filter((c) => c.id !== categoryId);
  await saveCategories(kv, categories);
  await logAction(kv, adminId, "delete_category", categoryId);
  await showCategoriesAdmin(env, telegram, chatId, messageId);
}
