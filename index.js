import "dotenv/config";
import express from "express";
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActivityType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import fetch from "node-fetch";
import { setupAuth } from "./auth.js";

// ✅ 환경 변수
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ADMIN_ID = "1410269476011770059";
const ALERT_CHANNEL_ID = "1412633302862397513"; // 관리자 보고 채널 ID

if (!DISCORD_TOKEN || !GEMINI_API_KEY) {
  console.error("❌ .env 파일에 DISCORD_TOKEN 또는 GEMINI_API_KEY 가 없습니다.");
  process.exit(1);
}

// ✅ 시간 함수 (KST)
function getKSTTime() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 60 * 60 * 1000);
  return kst.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

// ✅ Express Keep-Alive
const app = express();
app.get("/", (req, res) => res.send("✅ Bot is alive!"));
app.listen(process.env.PORT || 3000, () =>
  console.log("🌐 Keep-Alive server running on port 3000")
);
setInterval(() => console.log("💤 Bot keep-alive"), 60_000);

// ✅ Discord 클라이언트
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Channel],
});

// ✅ 상태 추적 변수
let currentTopic = null;
let activityTimeout = null;

// ✅ 도배 감지용 캐시
const messageCache = new Map();

// ✅ 관리자 감시용 로그 캐시 (5분 내 대량 조치 탐지)
const modLogCache = new Map();

// ✅ Helper Functions
function scheduleActivityReset() {
  if (activityTimeout) clearTimeout(activityTimeout);
  activityTimeout = setTimeout(() => {
    client.user.setPresence({
      activities: [{ name: "너를 기다리는 중...", type: ActivityType.Playing }],
      status: "idle",
    });
    currentTopic = null;
  }, 10 * 60 * 1000);
}

function extractTopic(text) {
  const topics = {
    로블록스: "로블록스 관련 이야기",
    성: "성에 관한 대화",
    인증: "인증 시스템 문제",
    음악: "음악과 노래 이야기",
    서버: "서버 관리 관련 대화",
    에러: "오류 문제 해결",
    친구: "친구와의 이야기",
    게임: "게임 이야기",
    홀더: "홀더의 사생활",
    홀꼬: "홀더의 꼬꼬에 대하여",
    홀더게이: "홀더의 성적취행에 관한",
  };
  for (const [k, v] of Object.entries(topics)) if (text.includes(k)) return v;
  return "일상적인 대화";
}

// ✅ 로그인 시
client.once("ready", () => {
  console.log(`🤖 ${client.user.tag} 로그인 완료!`);
  setupAuth(client);
  client.user.setPresence({
    activities: [{ name: "대화 대기 중...", type: ActivityType.Playing }],
    status: "online",
  });
});

// ✅ 관리자 DM 제어 명령 (상태 변경)
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.type !== 1) return;

  // 관리자만 실행
  if (message.author.id === ADMIN_ID && message.content.startsWith("?play ")) {
    const newStatus = message.content.replace("?play ", "").trim();
    if (!newStatus) return;

    client.user.setPresence({
      activities: [{ name: newStatus, type: ActivityType.Playing }],
      status: "online",
    });

    scheduleActivityReset();

    const embed = new EmbedBuilder()
      .setColor("#4d9802")
      .setTitle("<:Follow:1429877154669396130> 상태 변경됨")
      .setDescription(`**새 상태:** ${newStatus}`)
      .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

    await message.reply({ embeds: [embed] });
  }
});

// ✅ 도배 감지
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  const now = Date.now();
  const userId = message.author.id;
  const content = message.content.trim();

  const prev = messageCache.get(userId);
  if (prev && now - prev.timestamp < 50000) {
    if (content.length > 50 || prev.content === content) {
      try {
        const member = await message.guild.members.fetch(userId);
        await member.timeout(60 * 60 * 1000, "도배 탐지");

        const embedDM = new EmbedBuilder()
          .setColor("#ed1c24")
          .setTitle("<:Stop:1429877156040937634> 귀하는 격리되었습니다.")
          .setDescription(
            "귀하가 테러로 의심될 수 있는 활동을 하여 모든 권한을 삭제하였습니다. 현재 귀하는 격리된 상태입니다.\n\n<:Follow:1429877154669396130> **사유** : 대량 텍스트 문구 반복 발송\n<:Follow:1429877154669396130> **처벌대상** : " +
              `<@${userId}>`
          )
          .setFooter({
            text: "위 행위는 올바르게 판단되지 않을 수 있습니다. 다만 피해 발생 시 즉시 격리조치합니다.",
          });

        await message.author.send({ embeds: [embedDM] }).catch(() => {});
        const reportCh = await client.channels.fetch(ALERT_CHANNEL_ID);
        const embedAlert = EmbedBuilder.from(embedDM);
        await reportCh.send({ embeds: [embedAlert] });
        const msgs = await message.channel.messages.fetch({ limit: 10 });
        const toDelete = msgs.filter((m) => m.author.id === userId);
        await message.channel.bulkDelete(toDelete);
      } catch (err) {
        console.error("도배 감지 오류:", err);
      }
    }
  }

  messageCache.set(userId, { content, timestamp: now });
});

// ✅ 관리자 명령 감시 (대량 조치 탐지)
client.on("guildAuditLogEntryCreate", async (entry) => {
  const action = entry.actionType;
  const executor = entry.executorId;
  const guild = entry.target?.guild ?? entry.guild;

  if (!executor || !guild) return;

  const key = `${executor}-${action}`;
  const now = Date.now();
  const recent = modLogCache.get(key) || [];
  const filtered = recent.filter((t) => now - t < 5 * 60 * 1000);
  filtered.push(now);
  modLogCache.set(key, filtered);

  if (filtered.length >= 2) {
    try {
      const member = await guild.members.fetch(executor);
      await member.timeout(60 * 60 * 1000, "대량 조치 감지");

      const reason =
        action === "MEMBER_KICK"
          ? "대량 추방"
          : action === "MEMBER_BAN_ADD"
          ? "대량 차단"
          : "대량 타임아웃";

      const embed = new EmbedBuilder()
        .setColor("#ed1c24")
        .setTitle(`<:Stop:1429877156040937634> ${member.user.username}을(를) 격리조치하였습니다.`)
        .setDescription(
          `귀하가 테러로 의심될 수 있는 활동을 하여 모든 권한을 삭제하였습니다.\n\n<:Follow:1429877154669396130> **사유** : 5분 내 ${reason} 감지\n<:Follow:1429877154669396130> **처벌대상** : ${member}`
        )
        .setFooter({
          text: "위 행위는 올바르게 판단되지 않을 수 있습니다. 다만 피해 발생 시 즉시 격리조치합니다.",
        });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`release_${executor}`)
          .setLabel("격리 해제")
          .setStyle(ButtonStyle.Danger)
      );

      const alertCh = await client.channels.fetch(ALERT_CHANNEL_ID);
      await alertCh.send({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error("격리 조치 오류:", err);
    }
  }
});

// ✅ 격리 해제 버튼
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("release_")) return;

  const executorId = interaction.customId.replace("release_", "");
  const guild = interaction.guild;

  try {
    const ownerId = guild.ownerId;
    if (interaction.user.id !== ownerId) {
      return interaction.reply({
        content: "<:Warning:1429715991591387146> 서버 소유자만 격리 해제가 가능합니다.",
        ephemeral: true,
      });
    }

    const member = await guild.members.fetch(executorId);
    await member.timeout(null);
    await interaction.reply({
      content: `<:Info:1429877040949100654> ${member.user.username}님의 격리가 해제되었습니다.`,
      ephemeral: true,
    });
  } catch (err) {
    console.error("격리 해제 오류:", err);
  }
});

// ✅ 일반 대화 처리 (Gemini AI)
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.mentions.everyone) return;
  if (!message.mentions.has(client.user)) return;

  const question = message.content.replace(`<@${client.user.id}>`, "").trim();
  if (!question) return;

  const thinkingMsg = await message.channel.send(
    "<a:Loading:1429705917267705937> 더 좋은 답변 생각중..."
  );

  const newTopic = extractTopic(question);
  if (newTopic !== currentTopic) {
    currentTopic = newTopic;
    client.user.setPresence({
      activities: [{ name: `${newTopic}에 대해 대화 중`, type: ActivityType.Playing }],
      status: "online",
    });
  }

  scheduleActivityReset();

  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [
      {
        parts: [
          {
            text: `너는 나의 친한 친구야. 따뜻하고 자연스럽게 한국어로 답해줘. 너무 딱딱하지 않게.\n\n내가 한 말:\n${question}`,
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    const answer =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "<:Warning:1429715991591387146> 답변을 생성할 수 없습니다.";

    const embed = new EmbedBuilder()
      .setColor("#00a67e")
      .setAuthor({
        name: message.author.username,
        iconURL: message.author.displayAvatarURL(),
      })
      .setTitle("뎀넴의여유봇의 답변")
      .setDescription(answer)
      .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

    await thinkingMsg.edit({ content: "", embeds: [embed] });
  } catch (err) {
    console.error("Gemini 오류:", err);
  }
});

// ✅ 로그인
client.login(DISCORD_TOKEN);
