// Every keyboard in this bot is inline ("glass" style), max 2 buttons per row,
// and (almost) always ends with a Back row. These helpers keep that consistent
// so handlers just pass a flat list of buttons.

// buttons: [{ text, data }] or [{ text, url }]
export function rows(buttons, perRow = 2) {
  const out = [];
  for (let i = 0; i < buttons.length; i += perRow) {
    out.push(
      buttons.slice(i, i + perRow).map((b) =>
        b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data }
      )
    );
  }
  return out;
}

export function keyboard(buttons, { back, perRow = 2 } = {}) {
  const inline_keyboard = rows(buttons, perRow);
  if (back) {
    inline_keyboard.push([{ text: "⬅️ بازگشت", callback_data: back }]);
  }
  return { inline_keyboard };
}

export function confirmKeyboard(yesData, noData) {
  return {
    inline_keyboard: [
      [
        { text: "✅ بله", callback_data: yesData },
        { text: "❌ خیر", callback_data: noData },
      ],
    ],
  };
}
