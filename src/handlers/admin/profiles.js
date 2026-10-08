import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState, getState } from "../../lib/state.js";
import {
  getPanelIndex,
  getPanel,
  getProfiles,
  saveProfiles,
  logAction,
} from "../../lib/kv.js";
import { adapterFor } from "../../lib/panels/index.js";

const PROTOCOLS = [
  "VLESS Reality",
  "VMess WS",
  "Trojan",
  "Shadowsocks",
];

export async function showProfilesMenu(env, telegram, chatId, messageId) {
  const ids = await getPanelIndex(env.BOT_KV);

  const panels = (
    await Promise.all(
      ids.map((id) => getPanel(env.BOT_KV, id))
    )
  ).filter(Boolean);

  if (panels.length === 0) {
    await telegram.editOrSend(
      chatId,
      messageId,
      "ابتدا یک پنل اضافه کنید.",
      {
        reply_markup: keyboard([], {
          back: "admin:main",
        }),
      }
    );
    return;
  }

  const buttons = panels.map((p) => ({
    text: p.name,
    data: `admin:profiles:panel:${p.id}`,
  }));

  await telegram.editOrSend(
    chatId,
    messageId,
    "پنل مورد نظر را انتخاب کنید:",
    {
      reply_markup: keyboard(buttons, {
        perRow: 1,
        back: "admin:main",
      }),
    }
  );
}

export async function showPanelProfiles(
  env,
  telegram,
  chatId,
  messageId,
  panelId
) {
  const profiles = await getProfiles(
    env.BOT_KV,
    panelId
  );

  const buttons = profiles.map((p) => ({
    text: `${p.active ? "🟢" : "🔴"} ${p.name}`,
    data: `admin:profile:view:${panelId}:${p.id}`,
  }));

  buttons.push({
    text: "➕ افزودن پروفایل",
    data: `admin:profile:add:${panelId}`,
  });

  await telegram.editOrSend(
    chatId,
    messageId,
    "👤 <b>پروفایل‌های این پنل</b>",
    {
      reply_markup: keyboard(buttons, {
        perRow: 1,
        back: "admin:panels",
      }),
    }
  );
}

export async function startAddProfile(
  env,
  telegram,
  chatId,
  messageId,
  adminId,
  panelId
) {
  const buttons = PROTOCOLS.map((p) => ({
    text: p,
    data: `admin:profile:add:proto:${panelId}:${p}`,
  }));

  await telegram.editOrSend(
    chatId,
    messageId,
    "🔌 نوع پروتکل پروفایل را انتخاب کنید:",
    {
      reply_markup: keyboard(buttons, {
        perRow: 1,
        back: `admin:profiles:panel:${panelId}`,
      }),
    }
  );
}

export async function addProfilePickProtocol(
  env,
  telegram,
  chatId,
  messageId,
  adminId,
  panelId,
  protocol
) {
  await setState(env, adminId, {
    step: "admin_add_profile_name",
    data: {
      panel_id: panelId,
      protocol,
    },
  });

  await telegram.editOrSend(
    chatId,
    messageId,
    "📝 نام نمایشی پروفایل را ارسال کنید:\n\nمثال:\nآلمان - VLESS Reality",
    {
      reply_markup: keyboard([], {
        back: `admin:profiles:panel:${panelId}`,
      }),
    }
  );
}

/*
 * بعد از وارد کردن نام پروفایل،
 * لیست واقعی Inboundهای پنل گرفته می‌شود.
 */
export async function handleProfileTextInput(
  env,
  telegram,
  message,
  state
) {
  const chatId = message.chat.id;
  const adminId = message.from.id;

  const name = (message.text || "").trim();

  if (!name) {
    await telegram.sendMessage(
      chatId,
      "❌ نام پروفایل نمی‌تواند خالی باشد."
    );
    return;
  }

  const panelId = Number(
    state.data.panel_id
  );

  const panel = await getPanel(
    env.BOT_KV,
    panelId
  );

  if (!panel) {
    await clearState(env, adminId);

    await telegram.sendMessage(
      chatId,
      "❌ پنل پیدا نشد."
    );

    return;
  }

  try {
    const adapter = adapterFor(panel);

    if (
      typeof adapter.listInbounds !==
      "function"
    ) {
      throw new Error(
        "این نوع پنل امکان دریافت لیست Inbound را ندارد."
      );
    }

    const inbounds =
      await adapter.listInbounds(panel);

    if (!inbounds.length) {
      throw new Error(
        "هیچ Inbound فعالی در پنل پیدا نشد."
      );
    }

    await setState(env, adminId, {
      step: "admin_add_profile_inbound",

      data: {
        panel_id: panelId,
        protocol: state.data.protocol,
        name,
        inbounds,
      },
    });

    const buttons = inbounds.map(
      (ib, i) => ({
        text:
          `${
            ib.protocol
              ? ib.protocol.toUpperCase() +
                " | "
              : ""
          }${
            ib.label ||
            ib.tag ||
            ib.id
          }`,

        data:
          `admin:profile:inbound:${panelId}:${i}`,
      })
    );

    await telegram.sendMessage(
      chatId,
      "🔌 <b>Inbound مورد نظر را انتخاب کنید:</b>",
      {
        reply_markup: keyboard(
          buttons,
          {
            perRow: 1,
            back:
              `admin:profiles:panel:${panelId}`,
          }
        ),
      }
    );
  } catch (e) {
    await clearState(env, adminId);

    await telegram.sendMessage(
      chatId,
      `❌ دریافت Inboundها ناموفق بود:\n${String(
        e?.message || e
      )}`
    );
  }
}

/*
 * ثبت پروفایل جدید با Inbound انتخاب‌شده
 */
export async function selectProfileInbound(
  env,
  telegram,
  chatId,
  messageId,
  adminId,
  panelId,
  inboundIndex
) {
  const state = await getState(
    env,
    adminId
  );

  if (
    !state ||
    state.step !==
      "admin_add_profile_inbound" ||
    Number(state.data?.panel_id) !==
      Number(panelId)
  ) {
    await telegram.editOrSend(
      chatId,
      messageId,
      "❌ نشست انتخاب Inbound منقضی شده است.",
      {
        reply_markup: keyboard(
          [
            {
              text: "📋 پروفایل‌ها",
              data:
                `admin:profiles:panel:${panelId}`,
            },
          ],
          {
            perRow: 1,
          }
        ),
      }
    );

    return;
  }

  const inbound =
    state.data.inbounds?.[
      Number(inboundIndex)
    ];

  if (!inbound) {
    await telegram.editOrSend(
      chatId,
      messageId,
      "❌ Inbound انتخاب‌شده پیدا نشد."
    );

    return;
  }

  const profiles =
    await getProfiles(
      env.BOT_KV,
      Number(panelId)
    );

  const id =
    (
      profiles.reduce(
        (max, p) =>
          Math.max(
            max,
            Number(p.id) || 0
          ),
        0
      ) || 0
    ) + 1;

  const inboundTag =
    inbound.tag ||
    inbound.label ||
    "";

  profiles.push({
    id,

    name: state.data.name,

    protocol:
      state.data.protocol,

    active: true,

    inbound_tag:
      inboundTag,

    inbound_id:
      inbound.id ?? null,

    inbound_protocol:
      inbound.protocol || "",

    settings: {},
  });

  await saveProfiles(
    env.BOT_KV,
    Number(panelId),
    profiles
  );

  await logAction(
    env.BOT_KV,
    adminId,
    "add_profile",
    {
      panel_id:
        Number(panelId),

      id,

      inbound_tag:
        inboundTag,

      inbound_id:
        inbound.id ?? null,
    }
  );

  await clearState(
    env,
    adminId
  );

  await telegram.editOrSend(
    chatId,
    messageId,

    `✅ پروفایل «${state.data.name}» ثبت شد.

🔌 Inbound: ${
      inbound.label ||
      inbound.tag ||
      inbound.id
    }

📡 پروتکل: ${
      inbound.protocol ||
      state.data.protocol
    }`,

    {
      reply_markup: keyboard(
        [
          {
            text: "📋 بازگشت",
            data:
              `admin:profiles:panel:${panelId}`,
          },
        ],
        {
          perRow: 1,
        }
      ),
    }
  );
}

export async function toggleProfile(
  env,
  telegram,
  chatId,
  messageId,
  adminId,
  panelId,
  profileId
) {
  const profiles =
    await getProfiles(
      env.BOT_KV,
      panelId
    );

  const p = profiles.find(
    (x) =>
      Number(x.id) ===
      Number(profileId)
  );

  if (!p) return;

  p.active = !p.active;

  await saveProfiles(
    env.BOT_KV,
    panelId,
    profiles
  );

  await logAction(
    env.BOT_KV,
    adminId,
    "toggle_profile",
    {
      panel_id: panelId,
      id: profileId,
      active: p.active,
    }
  );

  await showPanelProfiles(
    env,
    telegram,
    chatId,
    messageId,
    panelId
  );
}

export async function deleteProfile(
  env,
  telegram,
  chatId,
  messageId,
  adminId,
  panelId,
  profileId
) {
  const profiles =
    (
      await getProfiles(
        env.BOT_KV,
        panelId
      )
    ).filter(
      (x) =>
        Number(x.id) !==
        Number(profileId)
    );

  await saveProfiles(
    env.BOT_KV,
    panelId,
    profiles
  );

  await logAction(
    env.BOT_KV,
    adminId,
    "delete_profile",
    {
      panel_id: panelId,
      id: profileId,
    }
  );

  await showPanelProfiles(
    env,
    telegram,
    chatId,
    messageId,
    panelId
  );
}

/*
 * جزئیات پروفایل
 */
export async function showProfileDetail(
  env,
  telegram,
  chatId,
  messageId,
  panelId,
  profileId
) {
  const profiles =
    await getProfiles(
      env.BOT_KV,
      panelId
    );

  const p = profiles.find(
    (x) =>
      Number(x.id) ===
      Number(profileId)
  );

  if (!p) return;

  const buttons = [
    p.active
      ? {
          text: "🔴 غیرفعال",
          data:
            `admin:profile:toggle:${panelId}:${p.id}`,
        }
      : {
          text: "🟢 فعال",
          data:
            `admin:profile:toggle:${panelId}:${p.id}`,
        },

    {
      text: "🔌 تغییر Inbound",
      data:
        `admin:profile:changeinbound:${panelId}:${p.id}`,
    },

    {
      text: "🗑 حذف",
      data:
        `admin:profile:delete:${panelId}:${p.id}`,
    },
  ];

  await telegram.editOrSend(
    chatId,
    messageId,

    `👤 ${p.name}

📡 پروتکل: ${p.protocol}

🔌 Inbound: ${
      p.inbound_tag ||
      p.inbound_id ||
      "تنظیم نشده"
    }`,

    {
      reply_markup: keyboard(
        buttons,
        {
          back:
            `admin:profiles:panel:${panelId}`,
        }
      ),
    }
  );
}

/*
 * شروع تغییر Inbound پروفایل موجود
 */
export async function startChangeInbound(
  env,
  telegram,
  chatId,
  messageId,
  adminId,
  panelId,
  profileId
) {
  const panel =
    await getPanel(
      env.BOT_KV,
      Number(panelId)
    );

  if (!panel) {
    await telegram.editOrSend(
      chatId,
      messageId,
      "❌ پنل پیدا نشد."
    );

    return;
  }

  try {
    const adapter =
      adapterFor(panel);

    if (
      typeof adapter.listInbounds !==
      "function"
    ) {
      throw new Error(
        "این نوع پنل امکان دریافت Inbound را ندارد."
      );
    }

    const inbounds =
      await adapter.listInbounds(panel);

    if (!inbounds.length) {
      throw new Error(
        "هیچ Inboundی پیدا نشد."
      );
    }

    await setState(env, adminId, {
      step:
        "admin_change_profile_inbound",

      data: {
        panel_id:
          Number(panelId),

        profile_id:
          Number(profileId),

        inbounds,
      },
    });

    const buttons =
      inbounds.map(
        (ib, i) => ({
          text:
            `${
              ib.protocol
                ? ib.protocol.toUpperCase() +
                  " | "
                : ""
            }${
              ib.label ||
              ib.tag ||
              ib.id
            }`,

          data:
            `admin:profile:changeinbound:pick:${panelId}:${profileId}:${i}`,
        })
      );

    await telegram.editOrSend(
      chatId,
      messageId,
      "🔌 Inbound جدید را انتخاب کنید:",
      {
        reply_markup:
          keyboard(
            buttons,
            {
              perRow: 1,

              back:
                `admin:profile:view:${panelId}:${profileId}`,
            }
          ),
      }
    );
  } catch (e) {
    await telegram.editOrSend(
      chatId,
      messageId,

      `❌ دریافت Inboundها ناموفق بود:\n${String(
        e?.message || e
      )}`
    );
  }
}

/*
 * ثبت Inbound جدید روی پروفایل موجود
 */
export async function changeInboundPick(
  env,
  telegram,
  chatId,
  messageId,
  adminId,
  panelId,
  profileId,
  inboundIndex
) {
  const state =
    await getState(
      env,
      adminId
    );

  if (
    !state ||
    state.step !==
      "admin_change_profile_inbound" ||
    Number(
      state.data?.panel_id
    ) !== Number(panelId) ||
    Number(
      state.data?.profile_id
    ) !== Number(profileId)
  ) {
    await telegram.editOrSend(
      chatId,
      messageId,
      "❌ نشست تغییر Inbound منقضی شده است."
    );

    return;
  }

  const inbound =
    state.data?.inbounds?.[
      Number(inboundIndex)
    ];

  if (!inbound) {
    await telegram.editOrSend(
      chatId,
      messageId,
      "❌ Inbound انتخاب‌شده پیدا نشد."
    );

    return;
  }

  const profiles =
    await getProfiles(
      env.BOT_KV,
      Number(panelId)
    );

  const p =
    profiles.find(
      (x) =>
        Number(x.id) ===
        Number(profileId)
    );

  if (!p) {
    await telegram.editOrSend(
      chatId,
      messageId,
      "❌ پروفایل پیدا نشد."
    );

    return;
  }

  p.inbound_tag =
    inbound.tag ||
    inbound.label ||
    "";

  p.inbound_id =
    inbound.id ?? null;

  p.inbound_protocol =
    inbound.protocol || "";

  await saveProfiles(
    env.BOT_KV,
    Number(panelId),
    profiles
  );

  await logAction(
    env.BOT_KV,
    adminId,
    "change_profile_inbound",
    {
      panel_id:
        Number(panelId),

      profile_id:
        Number(profileId),

      inbound_id:
        p.inbound_id,

      inbound_tag:
        p.inbound_tag,
    }
  );

  await clearState(
    env,
    adminId
  );

  await telegram.editOrSend(
    chatId,
    messageId,

    `✅ Inbound پروفایل تغییر کرد.

👤 ${p.name}

🔌 Inbound جدید:
${
      p.inbound_tag ||
      p.inbound_id
    }`,

    {
      reply_markup:
        keyboard(
          [
            {
              text: "↩️ بازگشت به پروفایل",
              data:
                `admin:profile:view:${panelId}:${profileId}`,
            },
          ],
          {
            perRow: 1,
          }
        ),
    }
  );
}
