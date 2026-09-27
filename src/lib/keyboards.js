// Every keyboard in this bot is inline ("glass" style), max 2 buttons per row,
// and (almost) always ends with a Back row. These helpers keep that consistent
// so handlers just pass a flat list of buttons.
//
// Button style (color) is supported by Telegram Bot API 9.0+:
//   "default"  -> no specific color
//   "primary"  -> blue (only some clients)
//   "success"  -> green
//   "danger"   -> red
//
// buttons: [{ text, data, style? }] or [{ text, url, style? }]
//
// Colors are applied automatically from the admin-configured
// settings.button_styles (see src/lib/styles.js + buttonStyleRegistry.js) —
// handlers don't need to pass `style` themselves unless they want to force
// one on top of / instead of the admin setting.

import { resolveStyle } from "./styles.js";

export function rows(buttons, perRow = 2) {
  const out = [];
  for (let i = 0; i < buttons.length; i += perRow) {
    out.push(buttons.slice(i, i + perRow).map(buildButton));
  }
  return out;
}

function buildButton(b) {
  const btn = b.url
    ? { text: b.text, url: b.url }
    : { text: b.text, callback_data: b.data };

  const style = b.style || (b.data ? resolveStyle(b.data) : undefined);
  if (style && ["default", "primary", "success", "danger"].includes(style)) {
    btn.style = style;
  }
  return btn;
}

export function keyboard(buttons, { back, perRow = 2 } = {}) {
  const inline_keyboard = rows(buttons, perRow);
  if (back) {
    inline_keyboard.push([buildButton({ text: "⬅️ بازگشت", data: back, style: resolveStyle("__back__") })]);
  }
  return { inline_keyboard };
}

export function confirmKeyboard(yesData, noData) {
  return {
    inline_keyboard: [
      [
        buildButton({ text: "✅ بله", data: yesData, style: resolveStyle("confirm:yes") || "success" }),
        buildButton({ text: "❌ خیر", data: noData, style: resolveStyle("confirm:no") || "danger" }),
      ],
    ],
  };
}
