// ================================
// 📦 기본 모듈
// ================================
import "dotenv/config";
import express from "express";
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} from "discord.js";
import fetch from "node-fetch";
import { setupAuth } from "./auth.js";

// ================================
// ⚙️ 환경설정
// ================================
const TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LOG_CHANNEL_ID = "1412633302862397513";
const PORT = process.env.PORT || 3000;

const app = express();
app.get("/", (_, res) => res.send("✅ Bot is running!"));
app.listen(PORT, () => console.log(`🌐 Keep-Alive server running on port ${PORT}`));

// ================================
// 🤖 디스코드 클라이언트
// ================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

// ================================
// ✨ Gemini 응답 기능 추가
// ================================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // 봇 멘션 여부
  if (!message.mentions.has(client.user)) return;

  const question = message.content.replace(`<@${client.user.id}>`, "").trim();
  if (!question) {
    return message.channel.send("질문 내용도 함께 보내줘 :D");
  }

  // “더 좋은 답변 생각중...” 메시지
  const thinkingMsg = await message.channel.send(
    "<a:Loading:1429705917267705937> 더 좋은 답변 생각중..."
  );

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [
        {
          parts: [
            {
              text: `너는 나의 친한 친구야. 항상 따뜻하고 자연스러운 한국어로 이야기하듯 대화해줘.\n\n내가 물어볼게: ${question}`,
            },
          ],
        },
      ],
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Gemini API 오류:", JSON.stringify(data, null, 2));
      return thinkingMsg.edit(
        `<:Warning:1429715991591387146> API 오류: ${
          data.error?.message || "알 수 없는 오류입니다."
        }`
      );
    }

    const answer =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "<:Warning:1429715991591387146> 답변을 생성할 수 없습니다.";

    const embed = new EmbedBuilder()
      .setAuthor({
        name: message.author.username,
        iconURL: message.author.displayAvatarURL(),
      })
      .setTitle("뎀넴의여유봇의 답변")
      .setDescription(answer)
      .setColor(0x00a67e)
      .setTimestamp();

    await thinkingMsg.edit({ content: "", embeds: [embed] });
  } catch (err) {
    console.error("❌ 오류:", err);
    await message.channel.send(
      "<:Warning:1429715991591387146> 오류가 발생했어요. 잠시 후 다시 시도해주세요."
    );
  }
});

// ================================
// 🧩 유저 격리 함수 (내장)
// ================================
const savedRoles = {};

async function isolateUser(member, reason, client) {
  if (!member || !member.manageable) return;

  // 역할 백업
  savedRoles[member.id] = member.roles.cache.map((r) => r.id);

  // 역할 제거 + 타임아웃
  await member.roles.set([]).catch(() => {});
  await member.timeout(365 * 24 * 60 * 60 * 1000, "테러 의심 격리").catch(() => {});

  // DM 알림
  const embedDM = new EmbedBuilder()
    .setColor("#ed1c24")
    .setTitle("<:Stop:1429877156040937634> 귀하는 격리되었습니다.")
    .setDescription(
      `귀하가 테러로 의심될 수 있는 활동을 하여 모든 권한을 삭제하였습니다. 현재 귀하는 격리된 상태입니다.\n\n` +
        `<:Follow:1429877154669396130> **사유** : ${reason}\n` +
        `<:Follow:1429877154669396130> **처벌대상** : <@${member.id}>`
    )
    .setFooter({
      text: "위 행위는 올바르게 판단되지 않을 수 있습니다. 다만 피해 발생 시 즉시 격리조치합니다.",
    });

  await member.send({ embeds: [embedDM] }).catch(() => {});

  // 관리자 채널 보고
  const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (logChannel) {
    const embedLog = new EmbedBuilder()
      .setColor("#ed1c24")
      .setTitle("<:Stop:1429877156040937634> 테러가 의심되어 격리되었습니다.")
      .setDescription(
        `<:Follow:1429877154669396130> **사유** : ${reason}\n` +
          `<:Follow:1429877154669396130> **처벌대상** : <@${member.id}>`
      )
      .setFooter({
        text: "관리자 검토 후 [격리 해제] 버튼으로 복구할 수 있습니다.",
      });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`release_${member.id}`)
        .setLabel("격리 해제")
        .setStyle(ButtonStyle.Danger)
    );

    await logChannel.send({ embeds: [embedLog], components: [row] });
  }
}

// ================================
// ⚡ 테러 행위 감지
// ================================
const activityLog = {};
function addActivity(userId, type) {
  if (!activityLog[userId]) activityLog[userId] = [];
  activityLog[userId].push({ type, time: Date.now() });
  activityLog[userId] = activityLog[userId].filter((e) => Date.now() - e.time < 5 * 60 * 1000);
  return activityLog[userId].filter((e) => e.type === type).length >= 2;
}

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  // 도배 감지
  if (msg.content.length > 100) {
    if (addActivity(msg.author.id, "spam")) {
      await isolateUser(msg.member, "텍스트 대량 전송", client);
    }
  }

  // everyone/here 감지
  if (msg.mentions.everyone || msg.content.includes("@here")) {
    if (addActivity(msg.author.id, "mention")) {
      await isolateUser(msg.member, "@everyone/@here 대량 멘션 감지", client);
    }
  }
});

// 채널 생성 감지
client.on("channelCreate", async (channel) => {
  const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: 10 });
  const entry = audit.entries.first();
  const executor = entry?.executor;
  if (!executor) return;
  if (addActivity(executor.id, "channel_create")) {
    const member = await channel.guild.members.fetch(executor.id).catch(() => null);
    await isolateUser(member, "채널 대량 생성 감지", client);
  }
});

// 채널 삭제 감지
client.on("channelDelete", async (channel) => {
  const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: 12 });
  const entry = audit.entries.first();
  const executor = entry?.executor;
  if (!executor) return;
  if (addActivity(executor.id, "channel_delete")) {
    const member = await channel.guild.members.fetch(executor.id).catch(() => null);
    await isolateUser(member, "채널 대량 삭제 감지", client);
  }
});

// 역할 삭제 감지
client.on("roleDelete", async (role) => {
  const audit = await role.guild.fetchAuditLogs({ limit: 1, type: 32 });
  const entry = audit.entries.first();
  const executor = entry?.executor;
  if (!executor) return;
  if (addActivity(executor.id, "role_delete")) {
    const member = await role.guild.members.fetch(executor.id).catch(() => null);
    await isolateUser(member, "역할 대량 삭제 감지", client);
  }
});

// 멤버 추방 감지
client.on("guildMemberRemove", async (member) => {
  const audit = await member.guild.fetchAuditLogs({ limit: 1, type: 20 });
  const entry = audit.entries.first();
  const executor = entry?.executor;
  if (!executor || executor.id === member.id) return;
  if (addActivity(executor.id, "kick")) {
    const staff = await member.guild.members.fetch(executor.id).catch(() => null);
    await isolateUser(staff, "인원 대량 추방 감지", client);
  }
});

// 멤버 차단 감지
client.on("guildBanAdd", async (ban) => {
  const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: 22 });
  const entry = audit.entries.first();
  const executor = entry?.executor;
  if (!executor) return;
  if (addActivity(executor.id, "ban")) {
    const staff = await ban.guild.members.fetch(executor.id).catch(() => null);
    await isolateUser(staff, "인원 대량 차단 감지", client);
  }
});

// 격리 해제 버튼
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("release_")) return;

  const userId = interaction.customId.split("_")[1];
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({ content: "🚫 관리자만 격리 해제 가능.", ephemeral: true });
  }

  const target = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!target) return interaction.reply({ content: "❌ 대상을 찾을 수 없습니다.", ephemeral: true });

  await target.timeout(null).catch(() => {});
  const roles = savedRoles[userId] || [];
  for (const r of roles) {
    const role = await interaction.guild.roles.fetch(r).catch(() => null);
    if (role) await target.roles.add(role).catch(() => {});
  }

  await interaction.reply({
    embeds: [new EmbedBuilder().setColor("#4d9802").setTitle("✅ 격리가 해제되었습니다.")],
    ephemeral: true,
  });
});

// ================================
// 🚀 인증, 관리자 명령어, 로그인
// ================================
client.once("ready", async () => {
  console.log(`🤖 ${client.user.tag} 로그인 완료!`);
  await setupAuth(client);
  client.user.setPresence({
    activities: [{ name: "너를 기다리는중...", type: 0 }],
    status: "online",
  });
});

client.login(TOKEN);

