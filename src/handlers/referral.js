import { keyboard } from "../lib/keyboards.js";
import { getUser } from "../lib/kv.js";

export async function showReferral(env, telegram, chatId, messageId, userId) {
  const user = await getUser(env.BOT_KV, userId);
  const link = `https://t.me/${env.BOT_USERNAME || "your_bot"}?start=ref${userId}`;

  const text =
    `👥 <b>دعوت دوستان</b>\n\n` +
    `🔗 لینک دعوت شما:\n${link}\n\n` +
    `👤 تعداد دعوت‌ها: ${user.ref_count}\n` +
    `💰 درآمد از دعوت: ${(user.ref_earnings || 0).toLocaleString("en-US")} تومان`;

  const kb = keyboard(
    [
      { text: "📤 اشتراک‌گذاری لینک", url: `https://t.me/share/url?url=${encodeURIComponent(link)}` },
      { text: "📊 آمار دعوت‌ها", data: "invite:stats" },
    ],
    { back: "menu:main" }
  );
  await telegram.editOrSend(chatId, messageId, text, { reply_markup: kb });
}
