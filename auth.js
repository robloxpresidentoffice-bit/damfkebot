import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  Routes,
  REST,
  PermissionsBitField,
} from "discord.js";
import fetch from "node-fetch";
import fs from "fs";

// ✅ 환경 설정
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const VERIFIED_ROLES = [
  "1426570497713373194", // 인증 완료
  "1422482866230525952", // 추가 역할 1
  "1422284952799547463", // 추가 역할 2
];
const AUTH_CHANNEL_ID = "1426572704055558205";
const LOG_CHANNEL_ID = "1412633302862397513";
const DATA_FILE = "authData.json";
const BAN_FILE = "banned.json";

// ✅ 파일 초기화
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "{}");
if (!fs.existsSync(BAN_FILE)) fs.writeFileSync(BAN_FILE, "{}");

// ✅ 한국시간
function getKSTTime() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 60 * 60 * 1000);
  return kst.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

// ✅ 오류 임베드
function errorEmbed(code = "99999") {
  return new EmbedBuilder()
    .setColor("#ffc443")
    .setTitle("<:Warning:1429715991591387146> 오류가 발생했어요.")
    .setDescription(
      `다시 시도해 주세요.\n\n> 오류 : **알 수 없는 오류**\n> 코드 : ${code}\n> 조치 : \`인증취소\`\n> **인증** 후 채널을 이용할 수 있어요.`
    )
    .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
}

const rest = new REST({ version: "10" }).setToken(TOKEN);

export async function setupAuth(client) {
  // ✅ 슬래시 명령어 등록
  const commands = [
    new SlashCommandBuilder()
      .setName("인증하기")
      .setDescription("로블록스 계정과 디스코드 계정을 연동합니다."),
    new SlashCommandBuilder()
      .setName("대량삭제")
      .setDescription("메시지를 대량 삭제합니다.")
      .addIntegerOption((opt) =>
        opt.setName("개수").setDescription("삭제할 메시지 개수").setRequired(true)
      )
      .addUserOption((opt) =>
        opt.setName("대상").setDescription("특정 사용자의 메시지만 삭제")
      ),
    new SlashCommandBuilder()
      .setName("수동인증")
      .setDescription("수동으로 인증을 부여합니다. (관리자 전용)")
      .addUserOption((opt) =>
        opt.setName("대상").setDescription("인증할 사용자").setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName("robloxid").setDescription("로블록스 ID 또는 닉네임").setRequired(true)
      ),
  ].map((c) => c.toJSON());

  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ 인증 명령어 등록 완료");

  // ============================================================
  // 🧩 인증 로직 (버튼 / 모달 / 검증 등)
  // ============================================================
  client.on("interactionCreate", async (interaction) => {
    try {
      // ✅ /인증하기
      if (interaction.isCommand() && interaction.commandName === "인증하기") {
        if (interaction.channelId !== AUTH_CHANNEL_ID)
          return interaction.reply({
            content: "<:Warning:1429715991591387146> 지정된 채널에서만 이용할 수 있습니다.",
            ephemeral: true,
          });

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasVerified = VERIFIED_ROLES.some((r) => member.roles.cache.has(r));
        if (hasVerified)
          return interaction.reply({
            content: "<:Finger:1429722343424659568> 이미 인증된 사용자입니다.",
            ephemeral: true,
          });

        const embed = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("<:Finger:1429722343424659568> 본인인증하기")
          .setDescription("로블록스 계정을 연동해야 인증이 가능합니다.")
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("start_auth")
            .setLabel("연동하기")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId("deny_auth")
            .setLabel("거절")
            .setStyle(ButtonStyle.Danger)
        );

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      // ❌ 인증 거절
      if (interaction.isButton() && interaction.customId === "deny_auth") {
        const embed = new EmbedBuilder()
          .setColor("#ffc443")
          .setTitle("<:Warning:1429715991591387146> 본인인증 실패")
          .setDescription(
            "본인인증이 실패되었어요.\n\n> 오류 : **본인인증 거부**\n> 코드 : 40301\n> 조치 : `인증취소`\n> **인증** 후 채널을 이용할 수 있어요."
          )
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
        return interaction.update({ embeds: [embed], components: [] });
      }

      // 🧩 "연동하기" 버튼 → 모달 열기
      if (interaction.isButton() && interaction.customId === "start_auth") {
        const modal = new ModalBuilder()
          .setCustomId("roblox_modal")
          .setTitle("Roblox 계정 연동하기");
        const input = new TextInputBuilder()
          .setCustomId("roblox_username")
          .setLabel("연동할 Roblox 계정을 입력해주세요.")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      // 🧾 모달 제출 → Roblox 계정 검색
      if (interaction.isModalSubmit() && interaction.customId === "roblox_modal") {
        const username = interaction.fields.getTextInputValue("roblox_username");
        const embedLoading = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("<a:Loading:1429705917267705937> Roblox 계정 검색중...")
          .setDescription(`입력한 닉네임: **${username}**\n잠시만 기다려주세요.`)
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

        await interaction.reply({ embeds: [embedLoading], ephemeral: true });
        await new Promise((r) => setTimeout(r, 5000)); // 5초 유지

        // Roblox API 검색
        let robloxUser = null;
        try {
          const search = await fetch(
            `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(
              username
            )}&limit=1`
          );
          const data = await search.json();
          if (data.data?.length) robloxUser = data.data[0];

          // 보조 API
          if (!robloxUser) {
            const res2 = await fetch("https://users.roblox.com/v1/usernames/users", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ usernames: [username] }),
            });
            const data2 = await res2.json();
            if (data2.data?.length) robloxUser = data2.data[0];
          }
        } catch {
          return interaction.editReply({ embeds: [errorEmbed("40401")], components: [] });
        }

        if (!robloxUser)
          return interaction.editReply({ embeds: [errorEmbed("40401")], components: [] });

        // ✅ 계정 찾음
        const verifyRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`verify_${robloxUser.id}`)
            .setLabel("연동하기")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId("re_search")
            .setLabel("다시 검색")
            .setStyle(ButtonStyle.Danger)
        );

        const embedFound = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("<:Link:1429725659013578813> Roblox 계정을 찾았습니다.")
          .setDescription(
            `연동할 계정이 맞는지 확인해주세요.\n> 프로필: **${robloxUser.displayName} (@${robloxUser.name})**`
          )
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

        return interaction.editReply({ embeds: [embedFound], components: [verifyRow] });
      }

      // 🔁 다시 검색
      if (interaction.isButton() && interaction.customId === "re_search") {
        const embed = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("<a:Loading:1429705917267705937> 다시 검색을 시작합니다.")
          .setDescription("새로운 Roblox 계정을 입력해주세요.")
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
        return interaction.update({ embeds: [embed], components: [] });
      }

      // ✅ verify_ (인증번호 발급)
      if (interaction.isButton() && interaction.customId.startsWith("verify_")) {
        const robloxId = interaction.customId.split("_")[1];
        const userId = interaction.user.id;
        const verifyCode = Math.floor(10000 + Math.random() * 90000).toString();

        const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        db[userId] = { robloxId, verifyCode, verified: false };
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

        const embed = new EmbedBuilder()
          .setColor("#4d9802")
          .setTitle("<a:Loading:1429705917267705937> Roblox 계정을 인증해주세요.")
          .setDescription(
            `연동할 계정의 프로필 소개에 아래 인증번호를 입력해주세요.\n\n> **${verifyCode}**\n> Roblox 계정 프로필 > 소개란에 인증번호를 입력 후 [인증하기]를 눌러주세요.`
          )
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`check_${userId}`)
            .setLabel("인증하기")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`regen_${userId}`)
            .setLabel("인증번호 재발급")
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({ embeds: [embed], components: [row] });
      }

      // ✅ check_ (인증 확인)
      if (interaction.isButton() && interaction.customId.startsWith("check_")) {
        const userId = interaction.customId.split("_")[1];
        const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        const entry = db[userId];
        if (!entry)
          return interaction.reply({ content: "<:Warning:1429715991591387146> 세션이 만료되었습니다.", ephemeral: true });

        const res = await fetch(`https://users.roblox.com/v1/users/${entry.robloxId}`);
        const robloxData = await res.json();

        if (robloxData.description?.includes(entry.verifyCode)) {
          entry.verified = true;
          entry.robloxName = robloxData.name;
          fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

          const member = await interaction.guild.members.fetch(userId);
          for (const r of VERIFIED_ROLES) await member.roles.add(r).catch(() => {});

          const embedDone = new EmbedBuilder()
            .setColor("#5661EA")
            .setTitle("<:Finger:1429722343424659568> 인증이 완료되었습니다.")
            .setDescription(
              `<@${userId}>님, 로블록스 **${robloxData.name}** 계정으로 인증이 완료되었습니다.`
            )
            .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

          const channel = await client.channels.fetch(interaction.channelId);
          await channel.send({ embeds: [embedDone] });
          return interaction.update({ embeds: [], components: [] });
        } else {
          return interaction.update({ embeds: [errorEmbed("40601")], components: [] });
        }
      }

      // ✅ regen_ (인증번호 재발급)
      if (interaction.isButton() && interaction.customId.startsWith("regen_")) {
        const userId = interaction.customId.split("_")[1];
        const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        const entry = db[userId];
        if (!entry)
          return interaction.reply({ content: "<:Warning:1429715991591387146> 세션이 만료되었습니다.", ephemeral: true });

        const words = ["푸른 하늘", "행복한 시간", "기쁜 순간", "빛나는 별"];
        const newCode = words[Math.floor(Math.random() * words.length)];
        entry.verifyCode = newCode;
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

        const embed = new EmbedBuilder()
          .setColor("#4d9802")
          .setTitle("<:Loading:1429705917267705937> 인증번호 재발급")
          .setDescription(
            `새로운 인증문구를 프로필 소개에 입력해주세요.\n\n> **${newCode}**`
          )
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

        return interaction.update({ embeds: [embed] });
      }

      // ✅ /대량삭제 및 /수동인증은 이전 코드와 동일
    } catch (err) {
      console.error("❌ 인증 오류:", err);
      try {
        await interaction.reply({ embeds: [errorEmbed("50001")], ephemeral: true });
      } catch {}
    }
  });

  // ============================================================
  // 📩 관리자 DM 명령어 (유저ID, ban, unban)
  // ============================================================
  client.on("messageCreate", async (msg) => {
    try {
      if (msg.channel.type !== 1 || msg.author.bot) return;
      if (msg.author.id !== "1410269476011770059") return;

      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      const banned = JSON.parse(fs.readFileSync(BAN_FILE, "utf8"));
      const args = msg.content.trim().split(/\s+/);
      const command = args[0];

      // ✅ ?유저ID
      if (command.startsWith("?") && /^\?\d+$/.test(command)) {
        const userId = command.slice(1);
        const entry = data[userId];
        if (!entry) {
          const warn = await msg.channel.send("<:Nocheck:1429716350892507137> 해당 유저의 인증정보를 찾을 수 없습니다.");
          setTimeout(() => warn.delete().catch(() => {}), 2000);
          return;
        }

        const user = await client.users.fetch(userId).catch(() => null);
        const verified = entry.verified ? "완료" : "미완료";
        const embed = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle(`<:Info:1429877040949100654> ${user?.username}의 정보`)
          .setDescription(
            `사용자의 신상정보입니다.\n> Discord : ${user?.tag}\n> Roblox : ${entry.robloxName}\n> 본인인증 : ${verified}`
          )
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

        return msg.channel.send({ embeds: [embed] });
      }

// ✅ ?ban
if (command === "?ban") {
  const id = args[1];
  const reason = args.slice(2).join(" ") || "없음";
  if (!id) return;

  const entry = data[id];
  if (!entry) return;

  banned[id] = {
    discordId: id,
    robloxId: entry.robloxId,
    robloxName: entry.robloxName,
    reason,
  };
  fs.writeFileSync(BAN_FILE, JSON.stringify(banned, null, 2));

  // 서버에서도 밴 처리
  const guild = await client.guilds.fetch("1410625687580180582");
  const member = await guild.members.fetch(id).catch(() => null);
  if (member) await member.ban({ reason }).catch(() => {});

  const embed = new EmbedBuilder()
    .setColor("#5661EA")
    .setTitle(`<:Nocheck:1429716350892507137> ${entry.robloxName}을 차단했습니다.`)
    .setDescription(
      `해당 사용자는 아래 사유에 의해 차단되었습니다.\n\n` +
      `> Discord : <@${id}>\n> -# ID : ${id}\n` +
      `> Roblox : ${entry.robloxName}\n> -# ID : ${entry.robloxId}\n` +
      `> 사유 : ${reason}`
    )
    .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

  return msg.channel.send({ embeds: [embed] });
}

  // ============================================================
  // 📩 관리자 DM 명령어 (유저ID / ban / unban)
  // ============================================================
  client.on("messageCreate", async (msg) => {
    try {
      // DM만 처리
      if (msg.channel.type !== 1 || msg.author.bot) return;
      // 특정 관리자만 허용
      if (msg.author.id !== "1410269476011770059") return;

      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      const banned = JSON.parse(fs.readFileSync(BAN_FILE, "utf8"));
      const args = msg.content.trim().split(/\s+/);
      const command = args[0];

      // ✅ ?유저ID — 인증정보 조회
      if (command.startsWith("?") && /^\?\d+$/.test(command)) {
        const userId = command.slice(1);
        const entry = data[userId];

        if (!entry) {
          const warn = await msg.channel.send("<:Nocheck:1429716350892507137> 해당 유저의 인증정보를 찾을 수 없습니다.");
          setTimeout(() => warn.delete().catch(() => {}), 2000);
          return;
        }

        const user = await client.users.fetch(userId).catch(() => null);
        const verified = entry.verified ? "완료" : "미완료";
        const embed = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle(`<:Info:1429877040949100654> ${user?.username || "Unknown"}의 정보`)
          .setDescription(
            `사용자의 신상정보입니다.\n` +
            `> Discord : ${user?.tag || "알 수 없음"}\n` +
            `> Roblox : ${entry.robloxName || "알 수 없음"}\n` +
            `> 본인인증 : ${verified}`
          )
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
        return msg.channel.send({ embeds: [embed] });
      }

      // ✅ ?ban — 사용자 차단
      if (command === "?ban") {
        const id = args[1];
        const reason = args.slice(2).join(" ") || "없음";
        if (!id) {
          const warn = await msg.channel.send("<:Warning:1429715991591387146> 사용자 ID가 필요합니다.");
          setTimeout(() => warn.delete().catch(() => {}), 2000);
          return;
        }

        const entry = data[id];
        if (!entry) {
          const warn = await msg.channel.send("<:Nocheck:1429716350892507137> 인증된 사용자가 아닙니다.");
          setTimeout(() => warn.delete().catch(() => {}), 2000);
          return;
        }

        banned[id] = {
          discordId: id,
          robloxId: entry.robloxId,
          robloxName: entry.robloxName,
          reason,
        };
        fs.writeFileSync(BAN_FILE, JSON.stringify(banned, null, 2));

        // 서버에서도 밴 처리
        const guild = await client.guilds.fetch("1410625687580180582");
        const member = await guild.members.fetch(id).catch(() => null);
        if (member) await member.ban({ reason }).catch(() => {});

        const embed = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle(`<:Nocheck:1429716350892507137> ${entry.robloxName}을 차단했습니다.`)
          .setDescription(
            `해당 사용자는 아래 사유에 의해 차단되었습니다.\n\n` +
            `> Discord : <@${id}>\n> -# ID : ${id}\n` +
            `> Roblox : ${entry.robloxName}\n> -# ID : ${entry.robloxId}\n` +
            `> 사유 : ${reason}`
          )
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
        return msg.channel.send({ embeds: [embed] });
      }

      // ✅ ?unban — 사용자 차단 해제
      if (command === "?unban") {
        const id = args[1];
        const reason = args.slice(2).join(" ") || "없음";
        if (!id) {
          const warn = await msg.channel.send("<:Warning:1429715991591387146> 사용자 ID가 필요합니다.");
          setTimeout(() => warn.delete().catch(() => {}), 2000);
          return;
        }

        const entry = banned[id];
        if (!entry) {
          const warn = await msg.channel.send("<:Nocheck:1429716350892507137> 해당 사용자는 차단 목록에 없습니다.");
          setTimeout(() => warn.delete().catch(() => {}), 2000);
          return;
        }

        delete banned[id];
        fs.writeFileSync(BAN_FILE, JSON.stringify(banned, null, 2));

        const guild = await client.guilds.fetch("1410625687580180582");
        await guild.bans.remove(id, reason).catch(() => {});

        const embed = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle(`${entry.robloxName}님의 서버차단이 해제되었습니다.`)
          .setDescription(`> 사유 : ${reason}`)
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
        return msg.channel.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error("⚠️ 관리자 DM 명령 오류:", err);
    }
  });
}

