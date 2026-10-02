// Thin wrapper around the Telegram Bot API.
import { replaceEmojis } from "./emoji.js";
// Every call goes through `api()` so token + error handling live in one place.

export function tg(env) {
  const base = `https://api.telegram.org/bot${env.BOT_TOKEN}`;

  async function api(method, payload) {
    const res = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      console.log("TG API ERROR", method, JSON.stringify(payload), JSON.stringify(data));
    }
    return data;
  }

  const HISTORY_PREFIX = "chat_history:";
  const HISTORY_TTL = 60 * 60 * 48;

  function isPrivateChat(chatId) {
    const n = Number(chatId);
    return Number.isSafeInteger(n) && n > 0;
  }

  async function trackHistory(chatId, messageId) {
    if (!env.BOT_SESSIONS || !isPrivateChat(chatId) || !messageId) return;
    try {
      await env.BOT_SESSIONS.put(`${HISTORY_PREFIX}${chatId}:${messageId}`, "1", { expirationTtl: HISTORY_TTL });
    } catch (e) {
      console.log("HISTORY TRACK ERROR", e?.message || e);
    }
  }

  async function clearChatHistory(chatId, extraMessageIds = [], keepMessageIds = []) {
    if (!env.BOT_SESSIONS || !isPrivateChat(chatId)) return;
    const prefix = `${HISTORY_PREFIX}${chatId}:`;
    let listed = [];
    try {
      const result = await env.BOT_SESSIONS.list({ prefix, limit: 1000 });
      listed = result?.keys || [];
    } catch (e) {
      console.log("HISTORY LIST ERROR", e?.message || e);
    }

    const keepIds = new Set(keepMessageIds.map(Number).filter(Number.isSafeInteger));
    const ids = new Set(extraMessageIds.map(Number).filter(Number.isSafeInteger));
    for (const item of listed) {
      const id = Number(item.name.slice(prefix.length));
      if (Number.isSafeInteger(id) && !keepIds.has(id)) ids.add(id);
    }
    const messageIds = [...ids];

    for (let i = 0; i < messageIds.length; i += 100) {
      const batch = messageIds.slice(i, i + 100);
      try {
        for (const messageId of batch) {
          const result = await api("deleteMessage", { chat_id: chatId, message_id: messageId });
          if (!result?.ok) {
            console.log("HISTORY DELETE ONE ERROR", chatId, messageId, result?.description || "unknown");
          }
        }
      } catch (e) {
        console.log("HISTORY DELETE ERROR", e?.message || e);
      }
    }

    for (let i = 0; i < listed.length; i += 100) {
      const batch = listed.slice(i, i + 100);
      await Promise.all(batch.map((item) => env.BOT_SESSIONS.delete(item.name).catch(() => {})));
    }
  }

  return {
    api,

    async sendMessage(chatId, text, extra = {}) {
      const { track_history = true, ...telegramExtra } = extra || {};
      const result = await api("sendMessage", {
        chat_id: chatId,
        text: replaceEmojis(text),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...telegramExtra,
      });
      if (track_history && result?.ok && result.result?.message_id) {
        await trackHistory(chatId, result.result.message_id);
      }
      return result;
    },

    async editMessageText(chatId, messageId, text, extra = {}) {
      const { track_history = true, ...telegramExtra } = extra || {};
      const result = await api("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: replaceEmojis(text),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...telegramExtra,
      });
      if (track_history && result?.ok && messageId) {
        await trackHistory(chatId, messageId);
      }
      return result;
    },

    editMessageReplyMarkup(chatId, messageId, reply_markup) {
      return api("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup });
    },

    deleteMessage(chatId, messageId) {
      return api("deleteMessage", { chat_id: chatId, message_id: messageId });
    },

    trackHistory,
    clearChatHistory,

    answerCallbackQuery(id, text, showAlert = false) {
      return api("answerCallbackQuery", { callback_query_id: id, text, show_alert: showAlert });
    },

    sendChatAction(chatId, action = "typing") {
      return api("sendChatAction", { chat_id: chatId, action });
    },

    copyMessage(chatId, fromChatId, messageId, extra = {}) {
      return api("copyMessage", {
        chat_id: chatId,
        from_chat_id: fromChatId,
        message_id: messageId,
        ...extra,
      });
    },

    async sendPhoto(chatId, photo, extra = {}) {
      const { track_history = true, ...telegramExtra } = extra || {};
      const result = await api("sendPhoto", {
        chat_id: chatId,
        photo,
        ...telegramExtra,
        ...(telegramExtra.caption ? { caption: replaceEmojis(telegramExtra.caption) } : {}),
      });
      if (track_history && result?.ok && result.result?.message_id) {
        await trackHistory(chatId, result.result.message_id);
      }
      return result;
    },

    getChatMember(chatId, userId) {
      return api("getChatMember", { chat_id: chatId, user_id: userId });
    },

    getFile(fileId) { return api("getFile", { file_id: fileId }); },

    async sendDocument(chatId, content, filename = "backup.json", caption = "") {
      const form = new FormData();
      form.append("chat_id", String(chatId));
      form.append("document", new Blob([content], { type: "application/json" }), filename);
      if (caption) form.append("caption", replaceEmojis(caption));
      const res = await fetch(`${base}/sendDocument`, { method: "POST", body: form });
      return res.json();
    },

    setWebhook(url, secret) {
      return api("setWebhook", { url, secret_token: secret });
    },

    // ─────── Forum Topics ───────
    createForumTopic(chatId, name, iconColor = 0x6FB9F0) {
      return api("createForumTopic", {
        chat_id: chatId,
        name,
        icon_color: iconColor,
      });
    },

    editForumTopic(chatId, messageThreadId, name) {
      return api("editForumTopic", {
        chat_id: chatId,
        message_thread_id: messageThreadId,
        name,
      });
    },

    closeForumTopic(chatId, messageThreadId) {
      return api("closeForumTopic", {
        chat_id: chatId,
        message_thread_id: messageThreadId,
      });
    },

    // Try to edit; if the message can't be edited (too old / not found), send a new one instead.
    // If Telegram just says "not modified" (content is identical), that's not a
    // real failure - do nothing instead of spamming a duplicate message.
    async editOrSend(chatId, messageId, text, extra = {}) {
      if (messageId) {
        const r = await this.editMessageText(chatId, messageId, text, extra);
        if (r.ok) return r;
        const desc = (r.description || "").toLowerCase();
        if (desc.includes("message is not modified")) return r;
      }
      return this.sendMessage(chatId, text, extra);
    },
  };
}
