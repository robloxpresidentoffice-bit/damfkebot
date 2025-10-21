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
  PermissionsBitField
} from "discord.js";
import fetch from "node-fetch";
import { setupAuth } from "./auth.js";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ✅ HTTP Keep-Alive 서버
const app = express();
app.get("/", (req, res) => res.send("✅ Bot is alive!"));
app.listen(process.env.PORT || 3000, () =>
  console.log("🌐 Keep-Alive server running on port 3000")
);
setInterval(() => console.log("💤 Bot keep-alive"), 60_000);

// ✅ Token 체크
if (!DISCORD_TOKEN || !GEMINI_API_KEY) {
  console.error("❌ .env 파일에 DISCORD_TOKEN 또는 GEMINI_API_KEY 가 없습니다.");
  process.exit(1);
}

// ✅ 디스코드 클라이언트 설정
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

client.once("ready", () => {
  console.log(`🤖 ${client.user.tag} 로그인 완료!`);
  setupAuth(client);
});

// ====== Gemini 응답 기능 추가 ======
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // DM 혹은 서버 채널 모두, 봇이 멘션 되었을 때만
  if (!message.mentions.has(client.user)) return;

  // 봇 멘션 텍스트만 추출
  const question = message.content.replace(`<@${client.user.id}>`, "").trim();
  if (!question) {
    return message.channel.send("질문 내용이랑 같이 보내줄래 😊");
  }

  // 먼저 더 좋은 답변 생각중 메시지
  const thinkingMsg = await message.channel.send("<a:Loading:1429705917267705937> 더 좋은 답변 생각중...");

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [
        {
          parts: [{ text: `너는 나의 친한 친구야. 항상 따뜻하고 자연스러운 한국어로 이야기하듯 대화해줘.\n\n내가 물어볼게: ${question}` }]
        }
      ]
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!res.ok) {
      console.error("Gemini API 오류:", JSON.stringify(data, null, 2));
      return thinkingMsg.edit(`<:Warning:1429715991591387146> API 오류: ${data.error?.message || "알 수 없는 오류입니다."}`);
    }

    const answer =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "<:Warning:1429715991591387146> 답변을 생성할 수 없습니다.";

    const embed = new EmbedBuilder()
      .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
      .setTitle("💬 뎀넴의여유봇의 답변")
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

// ====== 나머지 감지/격리 시스템 등 ======
// (앞서 제시한 감지/격리 코드 삽입 부분입니다...
// 도배감지, 밴감지, 차단감지, 역할삭제, 채널생성/삭제 등)

// ====== 격리 해제 버튼 처리 ======
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("release_")) return;

  const userId = interaction.customId.split("_")[1];
  const member = await interaction.guild.members.fetch(interaction.user.id);

  if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({ content: "🚫 관리자만 격리 해제가 가능합니다.", ephemeral: true });
  }

  const target = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!target) {
    return interaction.reply({ content: "❌ 대상을 찾을 수 없습니다.", ephemeral: true });
  }

  await target.timeout(null).catch(() => {});
  // 역할 복구 로직...
  // savedRoles 사용하여 역할 추가

  const embed = new EmbedBuilder()
    .setColor("#4d9802")
    .setTitle("✅ 격리가 해제되었습니다.")
    .setDescription(`<@${userId}>의 역할이 복구되고 타임아웃이 해제되었습니다.`)
    .setFooter({ text: `뎀넴의여유봇 • ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` });

  return interaction.reply({ embeds: [embed], ephemeral: true });
});

// ====== 로그인 ======
client.login(DISCORD_TOKEN);

// ====== 추가 감지 시스템 (index.js 2/2) ======
import { isolateUser } from "./isolation.js"; // 분리 가능, 또는 위 index.js 내부에 그대로 포함 가능

const activityLog = {};
const savedRoles = {};
const LOG_CHANNEL_ID = "1412633302862397513";

function addActivity(userId, type) {
  if (!activityLog[userId]) activityLog[userId] = [];
  activityLog[userId].push({ type, time: Date.now() });
  activityLog[userId] = activityLog[userId].filter((e) => Date.now() - e.time < 5 * 60 * 1000);
  return activityLog[userId].filter((e) => e.type === type).length >= 2;
}

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  // ===== 도배 감지 =====
  if (msg.content.length > 50) {
    if (addActivity(msg.author.id, "spam")) {
      await isolateUser(msg.member, "텍스트 대량 전송", client, savedRoles);
      await msg.channel.bulkDelete(10).catch(() => {});
    }
  }

  // ===== 멘션 감지 =====
  if (msg.mentions.everyone || msg.content.includes("@here")) {
    if (addActivity(msg.author.id, "mention")) {
      await isolateUser(msg.member, "대량 멘션 감지", client, savedRoles);
    }
  }

  // ===== ?play 관리자 상태 변경 =====
  if (msg.content.startsWith("?play ")) {
    const adminId = "1410269476011770059";
    if (msg.author.id !== adminId) return;
    const content = msg.content.slice(6).trim();
    if (!content) return;
    await client.user.setPresence({
      activities: [{ name: content, type: 0 }],
      status: "online",
    });
    const conf = await msg.reply(`✅ 상태를 "${content}" 로 변경했습니다! (10분 후 복귀)`);
    setTimeout(() => conf.delete().catch(() => {}), 4000);
    setTimeout(async () => {
      await client.user.setPresence({
        activities: [{ name: "너를 기다리는중...", type: 0 }],
        status: "online",
      });
    }, 600000);
  }

  // ===== 관리자 명령어 (?ban, ?unban) =====
  if (msg.author.id === "1410269476011770059") {
    const args = msg.content.split(" ");
    const command = args[0];
    if (command === "?ban") {
      const id = args[1];
      const reason = args.slice(2).join(" ") || "없음";
      const guild = await client.guilds.fetch("1410625687580180582");
      const member = await guild.members.fetch(id).catch(() => null);
      if (!member) return msg.reply("❌ 해당 사용자를 찾을 수 없습니다.");
      await member.ban({ reason }).catch(() => {});
      const embed = new EmbedBuilder()
        .setColor("#5661EA")
        .setTitle(`<:Nocheck:1429716350892507137> ${member.user.username}을 차단했습니다.`)
        .setDescription(
          `> Discord : <@${id}>\n> -# ID : ${id}\n> 사유 : ${reason}`
        )
        .setFooter({ text: `뎀넴의여유봇 • ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` });
      return msg.channel.send({ embeds: [embed] });
    }

    if (command === "?unban") {
      const id = args[1];
      const reason = args.slice(2).join(" ") || "없음";
      const guild = await client.guilds.fetch("1410625687580180582");
      await guild.bans.remove(id, reason).catch(() => {});
      const embed = new EmbedBuilder()
        .setColor("#5661EA")
        .setTitle(`<:Check:1429716350892507137> ${id}님의 차단이 해제되었습니다.`)
        .setDescription(`> 사유 : ${reason}`)
        .setFooter({ text: `뎀넴의여유봇 • ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` });
      return msg.channel.send({ embeds: [embed] });
    }
  }
});

// ====== 격리 해제 버튼 처리 ======
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("release_")) return;
  const userId = interaction.customId.split("_")[1];
  const member = await interaction.guild.members.fetch(interaction.user.id);

  if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({ content: "🚫 관리자만 격리 해제가 가능합니다.", ephemeral: true });
  }

  const target = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!target)
    return interaction.reply({ content: "❌ 대상을 찾을 수 없습니다.", ephemeral: true });

  await target.timeout(null).catch(() => {});
  const roles = savedRoles[userId] || [];
  for (const roleId of roles) {
    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (role) await target.roles.add(role).catch(() => {});
  }

  const embed = new EmbedBuilder()
    .setColor("#4d9802")
    .setTitle("✅ 격리가 해제되었습니다.")
    .setDescription(`<@${userId}>의 역할이 복구되고 타임아웃이 해제되었습니다.`)
    .setFooter({
      text: `뎀넴의여유봇 • ${new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      })}`,
    });

  await interaction.reply({ embeds: [embed], ephemeral: true });
});

