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
  ActivityType,
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
app.listen(PORT, () => console.log(`🌐 Keep‑Alive server running on port ${PORT}`));

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
  allowedMentions: { parse: ["users", "roles"] }, // @everyone, @here 기본 무시 설정
});

// =======================================
// 💬 Gemini 대화 & 학습 기능 (멘션 기반 + 자동 복귀)
// =======================================

// 🕒 최근 활동 시간 추적용
let lastActivityTimer = null;

const PLAY_COMMAND_USER_ID = "1410269476011770059";

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return; // 봇 멘션 없으면 무시

  const contentOriginal = message.content.replace(`<@${client.user.id}>`, "").trim();
  const content = contentOriginal;

  if (!content) {
    return message.channel.send("질문 내용과 함께 적어줘 :)");
  }

  // — @everyone / @here 포함 메시지 무시
  if (message.mentions.everyone) {
    // 그냥 아무 응답도 하지 않고 리턴
    return;
  }

  // ✅ “학습해” 명령 처리 (플레이중 업데이트)
  if (content.endsWith("학습해")) {
    const topic = content.replace("학습해", "").trim();
    if (!topic) {
      return message.channel.send("무엇을 학습할지 알려줘");
    }

    // ▶️ 권한 체크: 지정된 사용자만 실행 가능
    if (message.author.id !== PLAY_COMMAND_USER_ID) {
      // 권한 없는 사용자의 경우 → 그냥 일반 대화 흐름으로 넘김
      // 즉, 여기서 리턴하지 않고 아래의 일반 대화 처리로 이행
    } else {
      // 상태 업데이트
      await client.user.setPresence({
        activities: [{ name: `${topic} 학습중`, type: ActivityType.Playing }],
        status: "online",
      });

      // ⏳ 10분 타이머 리셋
      if (lastActivityTimer) clearTimeout(lastActivityTimer);
      lastActivityTimer = setTimeout(async () => {
        await client.user.setPresence({
          activities: [{ name: "너를 기다리는중...", type: ActivityType.Playing }],
          status: "online",
        });
        console.log("🕒 활동 없음 → 상태 자동 복귀 완료");
      }, 10 * 60 * 1000); // 10분 (600,000ms)

      // 메시지 보내지 않음 (요청하신 대로)
      return;
    }
  }

  // ✅ 일반 대화 (Gemini)
  await message.channel.sendTyping();

  // 로딩 메시지 전송
  const thinkingMsg = await message.channel.send(
    "<a:Loading:1429705917267705937> 더 나은 답변 생각 중..."
  );

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [
        {
          parts: [
            {
              text: `
너는 나의 친한 친구야.
항상 따뜻하고 자연스러운 한국어로, 친구처럼 대화하듯 답변해줘.
지나치게 격식 차리지 말고, 유머나 감정도 자연스럽게 표현해도 돼.
내가 궁금한 건 이거야: ${content}
              `.trim(),
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
      console.error("❌ Gemini API 오류:", JSON.stringify(data, null, 2));
      return thinkingMsg.edit(
        `<:Warning:1429715991591387146> API 오류: ${
          data.error?.message || "알 수 없는 오류입니다."
        }`
      );
    }

    // ✅ 응답 텍스트 추출
    const answer =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "⚠️ 답변을 생성할 수 없어요.";

    // ✅ 임베드로 표시
    const embed = new EmbedBuilder()
      .setAuthor({
        name: message.author.username,
        iconURL: message.author.displayAvatarURL(),
      })
      .setTitle("💬 뎀넴의여유봇의 답변")
      .setDescription(answer)
      .setColor("#d4ba81")
      .setTimestamp();

    await thinkingMsg.edit({ content: "", embeds: [embed] });

    // 🔄 활동 감지 → 타이머 리셋
    if (lastActivityTimer) clearTimeout(lastActivityTimer);
    lastActivityTimer = setTimeout(async () => {
      await client.user.setPresence({
        activities: [{ name: "너를 기다리는중...", type: ActivityType.Playing }],
        status: "online",
      });
      console.log("🕒 활동 없음 → 상태 자동 복귀 완료");
    }, 10 * 60 * 1000);
  } catch (err) {
    console.error("❌ Gemini 처리 오류:", err);
    await thinkingMsg.edit(
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
client.once("clientReady", async () => {
  console.log(`🤖 ${client.user.tag} 로그인 완료!`);
  await setupAuth(client);
  client.user.setPresence({
    activities: [{ name: "너를 기다리는중...", type: 0 }],
    status: "online",
  });
});

// ============================================================
// ⚙️ 관리자 명령어 (채팅 명령 기반 / 어디서든 사용 가능)
// ============================================================
client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!msg.content.startsWith("?")) return;

    // ✅ 특정 관리자만 제한하고 싶다면 여기에 추가
    const adminIds = ["1410269476011770059"]; // 허용된 관리자 ID
    if (!adminIds.includes(msg.author.id)) return;

    const data = JSON.parse(fs.readFileSync("authData.json", "utf8"));
    const banned = JSON.parse(fs.readFileSync("banned.json", "utf8"));
    const args = msg.content.trim().split(/\s+/);
    const command = args[0];

    // ✅ ?유저ID
    if (/^\?\d+$/.test(command)) {
      const userId = command.slice(1);
      const entry = data[userId];
      if (!entry) {
        return msg.channel.send(
          "<:Nocheck:1429716350892507137> 해당 유저의 인증정보를 찾을 수 없습니다."
        );
      }

      const user = await client.users.fetch(userId).catch(() => null);
      const verified = entry.verified ? "완료" : "미완료";
      const embed = new EmbedBuilder()
        .setColor("#5661EA")
        .setTitle(`<:Info:1429877040949100654> ${user?.username || "Unknown"}의 정보`)
        .setDescription(
          `사용자 정보입니다.\n> Discord : ${user?.tag || "알 수 없음"}\n> Roblox : ${entry.robloxName || "알 수 없음"}\n> 인증상태 : ${verified}`
        )
        .setFooter({ text: `뎀넴의여유봇 • ${new Date().toLocaleTimeString("ko-KR")}` });
      return msg.channel.send({ embeds: [embed] });
    }

    // ✅ ?ban
    if (command === "?ban") {
      const id = args[1];
      const reason = args.slice(2).join(" ") || "없음";
      if (!id) return msg.reply("❗ 사용자 ID를 입력하세요.");

      const entry = data[id];
      if (!entry) return msg.reply("❗ 인증된 사용자가 아닙니다.");

      banned[id] = {
        discordId: id,
        robloxId: entry.robloxId,
        robloxName: entry.robloxName,
        reason,
      };
      fs.writeFileSync("banned.json", JSON.stringify(banned, null, 2));

      const guild = await client.guilds.fetch("1410625687580180582");
      const member = await guild.members.fetch(id).catch(() => null);
      if (member) await member.ban({ reason }).catch(() => {});

      const embed = new EmbedBuilder()
        .setColor("#ff0000")
        .setTitle(`🚫 ${entry.robloxName} 차단 완료`)
        .setDescription(
          `> Discord : <@${id}>\n> Roblox : ${entry.robloxName}\n> 사유 : ${reason}`
        )
        .setFooter({ text: "뎀넴의여유봇 • 관리자 조치" });
      return msg.channel.send({ embeds: [embed] });
    }

    // ✅ ?unban
    if (command === "?unban") {
      const id = args[1];
      const reason = args.slice(2).join(" ") || "없음";
      if (!id) return msg.reply("❗ 사용자 ID를 입력하세요.");

      const entry = banned[id];
      if (!entry) return msg.reply("❗ 해당 사용자는 차단 목록에 없습니다.");

      delete banned[id];
      fs.writeFileSync("banned.json", JSON.stringify(banned, null, 2));

      const guild = await client.guilds.fetch("1410625687580180582");
      await guild.bans.remove(id, reason).catch(() => {});

      const embed = new EmbedBuilder()
        .setColor("#4d9802")
        .setTitle(`✅ ${entry.robloxName} 차단 해제 완료`)
        .setDescription(`> Discord : <@${id}>\n> 사유 : ${reason}`)
        .setFooter({ text: "뎀넴의여유봇 • 관리자 조치" });
      return msg.channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error("⚠️ 관리자 명령 오류:", err);
    msg.channel.send("⚠️ 명령 실행 중 오류가 발생했습니다.");
  }
});

client.login(TOKEN);






