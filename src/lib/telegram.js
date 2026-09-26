// Thin wrapper around the Telegram Bot API.
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

  return {
    api,

    sendMessage(chatId, text, extra = {}) {
      return api("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...extra,
      });
    },

    editMessageText(chatId, messageId, text, extra = {}) {
      return api("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...extra,
      });
    },

    editMessageReplyMarkup(chatId, messageId, reply_markup) {
      return api("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup });
    },

    deleteMessage(chatId, messageId) {
      return api("deleteMessage", { chat_id: chatId, message_id: messageId });
    },

    answerCallbackQuery(id, text, showAlert = false) {
      return api("answerCallbackQuery", { callback_query_id: id, text, show_alert: showAlert });
    },

    sendPhoto(chatId, photo, extra = {}) {
      return api("sendPhoto", { chat_id: chatId, photo, ...extra });
    },

    getChatMember(chatId, userId) {
      return api("getChatMember", { chat_id: chatId, user_id: userId });
    },

    setWebhook(url, secret) {
      return api("setWebhook", { url, secret_token: secret });
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
