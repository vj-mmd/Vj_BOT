import { keyboard } from "../lib/keyboards.js";
import { getUser, saveUser, getSettings, getTexts, render, getPanelIndex, getPanel, getProfiles, getStats, saveStats } from "../lib/kv.js";
import { provisionUser } from "../lib/panels/index.js";
import { logTestAccount } from "../lib/log.js";

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
  const texts = await getTexts(env.BOT_KV);
  const text = render(texts.test_menu, {
    volume: settings.test_volume_gb,
    days: settings.test_duration_days,
  });

  const kb = keyboard([{ text: "🎁 دریافت اکانت تست", data: "test:get" }], { back: "menu:main" });
  await telegram.editOrSend(chatId, messageId, text, { reply_markup: kb });
}

export async function handleTestGet(env, telegram, chatId, messageId, userId) {
  const kv = env.BOT_KV;
  const user = await getUser(kv, userId);
  const settings = await getSettings(kv);
  const texts = await getTexts(kv);

  if (user.test_used >= settings.test_count) {
    await telegram.editOrSend(chatId, messageId, texts.test_quota_over, {
      reply_markup: keyboard([], { back: "menu:main" }),
    });
    return;
  }

  const picked = await pickTestProfile(kv);
  if (!picked) {
    await telegram.editOrSend(chatId, messageId, texts.test_unavailable, {
      reply_markup: keyboard([], { back: "menu:main" }),
    });
    return;
  }

  await telegram.editOrSend(chatId, messageId, texts.test_creating);

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

    // 📊 لاگ: اکانت تست
    try {
      await logTestAccount(env, telegram, user, {
        name: `${settings.test_volume_gb}GB / ${settings.test_duration_days} روز`,
      });
    } catch (e) {
      console.log("logTestAccount failed", e);
    }

    const text = render(texts.test_success, {
      username: result.username,
      volume: settings.test_volume_gb,
      days: settings.test_duration_days,
    });

    // Test accounts hand out the Subscription link only — no raw config
    // string in the message (kept for regular purchases in purchase.js,
    // deliberately not shown here per admin request).
    const buttons = [{ text: "🔗 Subscription", url: result.subscription_url }];

    await telegram.sendMessage(chatId, text, { reply_markup: keyboard(buttons, { back: "menu:main" }) });
  } catch (e) {
    console.log("test provision error", e);
    await telegram.sendMessage(chatId, texts.test_error, {
      reply_markup: keyboard([], { back: "menu:main" }),
    });
  }
}
