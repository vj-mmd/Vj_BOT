import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import { getIndex, getUserServices, logAction } from "../../lib/kv.js";

export async function showBroadcastMenu(env, telegram, chatId, messageId) {
  const buttons = [
    { text: "↑ همه کاربران", data: "admin:bc:target:all" },
    { text: "⊘ کاربران دارای سرویس", data: "admin:bc:target:with_service" },
    { text: "⊘ کاربران بدون سرویس", data: "admin:bc:target:without_service" },
  ];

  await telegram.editOrSend(
    chatId,
    messageId,
    "↑ ارسال پیام همگانی به چه کسانی؟",
    { reply_markup: keyboard(buttons, { perRow: 1, back: "admin:main" }) }
  );
}

export async function pickBroadcastTarget(env, telegram, chatId, messageId, adminId, target) {
  await setState(env, adminId, {
    step: "admin_broadcast_message",
    target,
  });

  await telegram.editOrSend(
    chatId,
    messageId,
    "پیام همگانی را همین‌جا ارسال کنید.\n\nمتن، عکس، ویدئو، فایل یا هر پیام قابل کپی تلگرام قابل ارسال است.",
    { reply_markup: keyboard([], { back: "admin:broadcast" }) }
  );
}

async function targetUserIds(kv, target) {
  const allIds = await getIndex(kv, "index:users");

  if (target === "all") return allIds;

  const withService = [];
  const withoutService = [];

  // Keep the existing user index as the source of truth. Invalid/deleted
  // records are simply skipped instead of stopping the whole broadcast.
  for (const id of allIds) {
    try {
      const services = await getUserServices(kv, id);
      if (services.filter(Boolean).length > 0) {
        withService.push(id);
      } else {
        withoutService.push(id);
      }
    } catch (e) {
      console.log("BROADCAST TARGET LOOKUP ERROR", id, e);
    }
  }

  return target === "with_service" ? withService : withoutService;
}

export async function handleBroadcastContent(env, telegram, message, state) {
  const adminId = message.from.id;

  // Store the original Telegram message id so Telegram can copy it to
  // recipients. This preserves formatting, captions, media and entities
  // and avoids failures caused by HTML parsing in manually reconstructed text.
  const content = {
    source_chat_id: message.chat.id,
    source_message_id: message.message_id,
    type: message.photo ? "photo" : message.text ? "text" : "message",
    file_id: message.photo
      ? message.photo[message.photo.length - 1].file_id
      : null,
    caption: message.caption || "",
    text: message.text || "",
  };

  await setState(env, adminId, {
    step: "admin_broadcast_buttons",
    target: state.target,
    content,
  });

  await telegram.sendMessage(
    message.chat.id,
    "⑧ <b>دکمه‌های شیشه‌ای</b>\n\n" +
      "اگر دکمه نمی‌خواهی، <code>none</code> بفرست.\n" +
      "برای چند دکمه، هر خط یکی:\n" +
      "<code>تست | https://example.com</code>\n" +
      "<code>خرید | https://example.com/buy</code>",
    { reply_markup: keyboard([], { back: "admin:broadcast" }) }
  );
}

function parseButtons(text) {
  if ((text || "").trim().toLowerCase() === "none") return [];

  return (text || "")
    .split("\n")
    .map((line) => {
      const separator = line.indexOf("|");
      if (separator < 0) return { text: "", url: "" };

      return {
        text: line.slice(0, separator).trim(),
        url: line.slice(separator + 1).trim(),
      };
    })
    .filter((item) => item.text && /^https?:\/\//i.test(item.url));
}

async function sendOneBroadcast(telegram, targetId, content, markup) {
  const extra = markup ? { reply_markup: markup } : {};

  // Preferred path: copy the exact original message. This works for text,
  // photos, videos, documents, audio, animations and Telegram entities.
  if (content?.source_chat_id && content?.source_message_id) {
    const copied = await telegram.copyMessage(
      targetId,
      content.source_chat_id,
      content.source_message_id,
      extra
    );

    if (copied?.ok) return copied;

    console.log(
      "BROADCAST COPY FAILED",
      targetId,
      JSON.stringify(copied)
    );
  }

  // Fallback for old states created before the copy-message upgrade.
  if (content?.type === "photo" && content.file_id) {
    return telegram.sendPhoto(targetId, content.file_id, {
      caption: content.caption || "",
      ...extra,
      track_history: false,
    });
  }

  return telegram.sendMessage(targetId, content?.text || "", {
    ...extra,
    track_history: false,
  });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleBroadcastButtons(env, telegram, message, state) {
  const adminId = message.from.id;
  const ids = await targetUserIds(env.BOT_KV, state.target);
  const buttons = parseButtons(message.text || "");
  const markup = buttons.length ? keyboard(buttons, { perRow: 2 }) : undefined;

  await clearState(env, adminId);

  await telegram.sendMessage(
    message.chat.id,
    `↻ ارسال پیام همگانی به ${ids.length} کاربر شروع شد...`
  );

  let sent = 0;
  let failed = 0;

  // A small delay prevents Telegram flood-limit errors while keeping the
  // broadcast reasonably fast. A failed recipient never aborts the campaign.
  for (const id of ids) {
    try {
      const result = await sendOneBroadcast(telegram, id, state.content, markup);

      if (result?.ok) {
        sent++;
      } else {
        failed++;
        console.log("BROADCAST SEND FAILED", id, JSON.stringify(result));
      }

      await sleep(45);
    } catch (e) {
      failed++;
      console.log("BROADCAST SEND ERROR", id, e?.stack || e);
    }
  }

  await logAction(env.BOT_KV, adminId, "broadcast", {
    target: state.target,
    total: ids.length,
    sent,
    failed,
    buttons: buttons.length,
  });

  await telegram.sendMessage(
    message.chat.id,
    `⑩ ارسال کامل شد.\n✓ موفق: ${sent}\n✗ ناموفق: ${failed}`,
    { reply_markup: keyboard([], { back: "admin:main" }) }
  );
}
