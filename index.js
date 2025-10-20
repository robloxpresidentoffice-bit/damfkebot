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

// ✅ 환경 변수 확인
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LOG_CHANNEL_ID = "1412633302862397513"; // 관리자 보고 채널

if (!DISCORD_TOKEN || !GEMINI_API_KEY) {
  console.error("❌ .env 파일에 DISCORD_TOKEN 또는 GEMINI_API_KEY 가 없습니다.");
  process.exit(1);
}

// ✅ 한국 시간 함수
function getKSTTime() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 60 * 60 * 1000);
  return kst.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

// ✅ HTTP Keep-Alive 서버 (Render용)
const app = express();
app.get("/", (req, res) => res.send("✅ Bot is alive!"));
app.listen(process.env.PORT || 3000, () =>
  console.log("🌐 Keep-Alive server running on port 3000")
);
setInterval(() => console.log("💤 Bot keep-alive"), 60_000);

// ✅ Discord 클라이언트 설정
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// ✅ 로그인 이벤트
client.once("ready", () => {
  console.log(`🤖 ${client.user.tag} 로그인 완료!`);
  setupAuth(client);
});


// ✅ Gemini AI 채팅 (DM 포함)
client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (message.mentions.everyone) return;

    const isDM = message.channel.type === 1;
    const mentioned =
      message.mentions.has(client.user) ||
      (isDM && message.content.trim().length > 0);
    if (!mentioned) return;

    const question = message.content
      .replace(`<@${client.user.id}>`, "")
      .trim();

    if (!question) return;

    const thinkingMsg = await message.channel.send(
      "<a:Loading:1429705917267705937> 더 좋은 답변 생각중..."
    );

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
        `<:Nocheck:1429716350892507137> API 오류: ${data.error?.message || "알 수 없는 오류입니다."}`
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
      .setFooter({
        text: `뎀넴의여유봇 • ${getKSTTime()}`,
      });

    await thinkingMsg.edit({ content: "", embeds: [embed] }).catch(async () => {
      await message.channel.send({ embeds: [embed] });
    });
  } catch (err) {
    console.error("❌ 오류:", err);
  }
});


// ====== 도배 감지 (50초 기준) ======
const spamMap = new Map();

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();
  const userId = message.author.id;

  const record = spamMap.get(userId) || { lastMsg: "", count: 0, time: Date.now() };

  if (
    (content.length > 50 && Date.now() - record.time < 50000) ||
    (record.lastMsg === content && Date.now() - record.time < 50000)
  ) {
    record.count++;
  } else {
    record.count = 1;
  }

  record.lastMsg = content;
  record.time = Date.now();
  spamMap.set(userId, record);

  if (record.count >= 3) {
    const member = await message.guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    await member.timeout(60 * 60 * 1000, "도배 감지");
    await message.channel.bulkDelete(10).catch(() => {});

    const dmEmbed = new EmbedBuilder()
      .setColor("#ed1c24")
      .setTitle("<:Stop:1429877156040937634> 귀하는 격리되었습니다.")
      .setDescription(
        "귀하가 테러로 의심될 수 있는 활동을 하여 모든 권한을 삭제하였습니다.\n" +
          "<:Follow:1429877154669396130> **사유** : 대량 텍스트 문구를 짧은 시간에 보내기를 여러 번 반복함\n" +
          `<:Follow:1429877154669396130> **처벌대상** : ${message.author}`
      )
      .setFooter({
        text: "위 행위는 올바르게 판단이 되지 않을 수 있습니다. 다만 피해가 있을 시 즉시 격리조치 합니다. `테러`는 멤버 대량추방, 텍스트 도배, 채널대량삭제, 채널대량생성, 역할 대량삭제, 역할대량생성 등을 의미합니다.",
      });

    await message.author.send({ embeds: [dmEmbed] }).catch(() => {});

    const adminChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    const adminEmbed = new EmbedBuilder()
      .setColor("#ed1c24")
      .setTitle(`<:Stop:1429877156040937634> ${message.author.tag}를 격리조치하였습니다.`)
      .setDescription(
        "귀하가 테러로 의심될 수 있는 활동을 하여 모든 권한을 삭제하였습니다.\n" +
          "<:Follow:1429877154669396130> **사유** : 대량 텍스트 문구를 짧은 시간에 보내기를 여러 번 반복함\n" +
          `<:Follow:1429877154669396130> **처벌대상** : ${message.author}`
      )
      .setFooter({
        text: `뎀넴의여유봇 • ${getKSTTime()}`,
      });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`unmute_${message.author.id}`)
        .setLabel("격리해제")
        .setStyle(ButtonStyle.Danger)
    );

    await adminChannel.send({ embeds: [adminEmbed], components: [row] });
  }
});


// ====== 대량 조치 감시 (5분 내 2회) ======
const actionTracker = {};

client.on("guildAuditLogEntryCreate", async (entry) => {
  try {
    const { action, executor } = entry;
    if (!executor || executor.bot) return;

    // ✅ Discord Action 코드 → 한글 사유
    let actionType = "";
    switch (action) {
      case "MEMBER_UPDATE":
        actionType = "대량 타임아웃";
        break;
      case "MEMBER_KICK":
        actionType = "대량 추방";
        break;
      case "MEMBER_BAN_ADD":
        actionType = "대량 차단";
        break;
      default:
        return;
    }

    const guild = entry.guild;
    const executorMember = await guild.members.fetch(executor.id).catch(() => null);
    if (!executorMember) return;

    if (
      executorMember.permissions.has(PermissionsBitField.Flags.KickMembers) ||
      executorMember.permissions.has(PermissionsBitField.Flags.BanMembers) ||
      executorMember.permissions.has(PermissionsBitField.Flags.Administrator)
    )
      return;

    const now = Date.now();
    const userLog = actionTracker[executor.id] || [];
    const recent = userLog.filter((t) => now - t < 300000);
    recent.push(now);
    actionTracker[executor.id] = recent;

    if (recent.length >= 2) {
      await executorMember.timeout(60 * 60 * 1000, `${actionType} 감지`);

      const warnDM = new EmbedBuilder()
        .setColor("#ed1c24")
        .setTitle("<:Stop:1429877156040937634> 귀하는 격리되었습니다.")
        .setDescription(
          `귀하가 테러로 의심될 수 있는 활동(${actionType})을 하여 모든 권한을 삭제하였습니다.\n` +
            `<:Follow:1429877154669396130> **사유** : ${actionType} 감지\n` +
            `<:Follow:1429877154669396130> **처벌대상** : ${executor}`
        )
        .setFooter({
          text: "위 행위는 올바르게 판단이 되지 않을 수 있습니다. 다만 피해가 있을 시 즉시 격리조치 합니다. `테러`는 멤버 대량추방, 텍스트 도배, 채널대량삭제, 채널대량생성, 역할 대량삭제, 역할대량생성 등을 의미합니다.",
        });

      await executor.send({ embeds: [warnDM] }).catch(() => {});

      const alert = new EmbedBuilder()
        .setColor("#ed1c24")
        .setTitle(`<:Stop:1429877156040937634> ${executor.tag} 격리조치`)
        .setDescription(
          `<:Follow:1429877154669396130> **사유** : ${actionType} 감지\n<:Follow:1429877154669396130> **처벌대상** : ${executor}`
        )
        .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

      const channel = await client.channels.fetch(LOG_CHANNEL_ID);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`unmute_${executor.id}`)
          .setLabel("격리해제")
          .setStyle(ButtonStyle.Danger)
      );

      await channel.send({ embeds: [alert], components: [row] });
      actionTracker[executor.id] = [];
    }
  } catch (err) {
    console.error("🚨 감사로그 감시 오류:", err);
  }
});


// ====== 격리 해제 버튼 (서버 소유자만 가능) ======
client.on("interactionCreate", async (i) => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("unmute_")) return;

  const targetId = i.customId.split("_")[1];
  const guild = i.guild;
  if (i.user.id !== guild.ownerId) return;

  const member = await guild.members.fetch(targetId).catch(() => {});
  if (member) {
    await member.timeout(null);
    await i.reply({
      content: `<:Info:1429877040949100654> ${member.user.tag}님의 격리가 해제되었습니다.`,
      ephemeral: true,
    });
  } else {
    await i.reply({
      content: "<:Warning:1429715991591387146> 해당 사용자를 찾을 수 없습니다.",
      ephemeral: true,
    });
  }
});

// ✅ 로그인
client.login(DISCORD_TOKEN);
