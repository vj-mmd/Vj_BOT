import { keyboard } from "../lib/keyboards.js";
import { getUser, saveUser, getSettings, getPanelIndex, getPanel, getProfiles, getStats, saveStats } from "../lib/kv.js";
import { provisionUser } from "../lib/panels/index.js";

// Which panel/profile new test accounts get created on. Kept simple: the
// first active panel with at least one active profile. For more control,
// add a dedicated "test profile" picker in the admin settings screen.
async function pickTestProfile(kv) {
  const panelIds = await getPanelIndex(kv);
  for (const id of panelIds) {
    const panel = await getPanel(kv, id);
    if (!panel || !panel.active) continue;
    const profiles = await getProfiles(kv, id);
    const active = profiles.find((p) => p.active);
    if (active) return { panel, profile: active };
  }
  return null;
}

export async function showTestMenu(env, telegram, chatId, messageId) {
  const settings = await getSettings(env.BOT_KV);
  const text =
    `🔍 حجم تست: ${settings.test_volume_gb}MB\n` +
    `〽️ مدت تست: ${settings.test_duration_days} روز\n`;

  const kb = keyboard([{ text: "🎁 دریافت اکانت تست", data: "test:get" }], { back: "menu:main" });
  await telegram.editOrSend(chatId, messageId, text, { reply_markup: kb });
}

export async function handleTestGet(env, telegram, chatId, messageId, userId) {
  const kv = env.BOT_KV;
  const user = await getUser(kv, userId);
  const settings = await getSettings(kv);

  if (user.test_used >= settings.test_count) {
    await telegram.editOrSend(chatId, messageId, "❌ سهمیه تست شما تمام شده است.", {
      reply_markup: keyboard([], { back: "menu:main" }),
    });
    return;
  }

  const picked = await pickTestProfile(kv);
  if (!picked) {
    await telegram.editOrSend(
      chatId,
      messageId,
      "⚠️ در حال حاضر امکان ساخت اکانت تست وجود ندارد. بعداً تلاش کنید.",
      { reply_markup: keyboard([], { back: "menu:main" }) }
    );
    return;
  }

  await telegram.editOrSend(chatId, messageId, "⏳ در حال ساخت اکانت تست...");

  try {
    const username = `test_${userId}_${Date.now()}`;
    const result = await provisionUser(picked.panel, picked.profile, {
      username,
      volumeGB: settings.test_volume_gb / 1024,
      days: settings.test_duration_days,
    });

    user.test_used += 1;
    await saveUser(kv, user);

    const stats = await getStats(kv);
    stats.tests_used += 1;
    await saveStats(kv, stats);

    const text =
      `✅ اکانت تست شما ساخته شد.\n\n` +
      `🗣 نام کاربری: <code>${result.username}</code>\n` +
      `🔍 حجم: ${settings.test_volume_gb}GB\n` +
      `〽️ مدت: ${settings.test_duration_days} روز`;

    const buttons = [{ text: "🔗 Subscription", url: result.subscription_url }];
    let finalText = text;
    if (result.config_links && result.config_links[0]) {
      // Shown inline rather than as a button since Telegram buttons can't
      // carry arbitrary config strings without another round-trip to storage.
      finalText += `\n\n⚙️ Config:\n<code>${result.config_links[0]}</code>`;
    }

    await telegram.sendMessage(chatId, finalText, { reply_markup: keyboard(buttons, { back: "menu:main" }) });
  } catch (e) {
    console.log("test provision error", e);
    await telegram.sendMessage(
      chatId,
      "❌ خطا در ساخت اکانت تست. لطفاً بعداً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.",
      { reply_markup: keyboard([], { back: "menu:main" }) }
    );
  }
}
