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

// ✅ 한국시간 포맷
function getKSTTime() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 60 * 60 * 1000);
  return kst.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

// ✅ 기본 오류 임베드
function errorEmbed(code = "99999") {
  return new EmbedBuilder()
    .setColor("#ffc443")
    .setTitle("<:Warning:1429715991591387146> 오류가 발생했어요.")
    .setDescription(
      `다시 시도해 주세요.\n\n> 오류 : **알 수 없는 오류**\n> 코드 : ${code}\n> 조치 : \`인증취소\`\n> **인증** 후 채널을 이용할 수 있어요.`
    )
    .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
}

// ✅ 명령어 등록
const rest = new REST({ version: "10" }).setToken(TOKEN);

export async function setupAuth(client) {
  // 슬래시 명령어 등록
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
        opt.setName("robloxid").setDescription("로블록스 ID (숫자)").setRequired(true)
      ),
  ].map((cmd) => cmd.toJSON());

  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ 인증 명령어 등록 완료");

  // ============================================================
  // ✅ 인증 명령어
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

      // ❌ 거절 버튼
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

      // 🧩 연동하기 버튼
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

      // 🧾 모달 제출
      if (interaction.isModalSubmit() && interaction.customId === "roblox_modal") {
        const username = interaction.fields.getTextInputValue("roblox_username");
        const banned = JSON.parse(fs.readFileSync(BAN_FILE, "utf8"));

        const embedLoading = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("<a:Loading:1429705917267705937> Roblox 계정 검색중...")
          .setDescription(`입력한 닉네임: **${username}**\n잠시만 기다려주세요.`)
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

        await interaction.reply({ embeds: [embedLoading], ephemeral: true });

        // 5초 대기
        await new Promise((r) => setTimeout(r, 5000));

        let robloxUser = null;
        try {
          const res = await fetch(
            `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(
              username
            )}&limit=1`
          );
          const data = await res.json();
          if (data.data?.length) robloxUser = data.data[0];
        } catch {
          return interaction.editReply({ embeds: [errorEmbed("40401")], components: [] });
        }

        if (!robloxUser)
          return interaction.editReply({ embeds: [errorEmbed("40401")], components: [] });

        // 차단 확인
        const bannedUser = Object.values(banned).find(
          (x) => x.robloxId === robloxUser.id
        );
        if (bannedUser) {
          const member = await interaction.guild.members
            .fetch(interaction.user.id)
            .catch(() => null);
          if (member) {
            await member.timeout(24 * 60 * 60 * 1000, "차단된 로블록스 계정으로 인증 시도");
          }

          const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
          const alert = new EmbedBuilder()
            .setColor("#ffc443")
            .setTitle("<:Warning:1429715991591387146> 서버 보안 주의")
            .setDescription(
              `> 격리자 : ${interaction.user}\n> -# ID : ${interaction.user.id}\n> 로블록스 : ${robloxUser.name}\n> -# ID : ${robloxUser.id}\n\n> 차단자 : <@${bannedUser.discordId}>\n> -# ID : ${bannedUser.discordId}\n> 로블록스 : ${bannedUser.robloxName}\n> -# ID : ${bannedUser.robloxId}\n\n이 봇은 정확하지 않을 수 있어요.`
            )
            .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
          return logChannel.send({ embeds: [alert] });
        }

        // ✅ 계정 찾음
        const embedFound = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("<:Link:1429725659013578813> Roblox 계정을 찾았습니다.")
          .setDescription(
            `연동할 계정이 맞는지 확인해주세요.\n> 프로필: **${robloxUser.displayName} (@${robloxUser.name})**`
          )
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

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

        return interaction.editReply({ embeds: [embedFound], components: [verifyRow] });
      }

      // ✅ 연동하기 버튼 클릭 시
      if (interaction.isButton() && interaction.customId.startsWith("verify_")) {
        const robloxId = interaction.customId.split("_")[1];
        const userId = interaction.user.id;
        const verifyCode = Math.floor(10000 + Math.random() * 90000).toString();

        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        data[userId] = { robloxId, verifyCode, verified: false };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

        const embed = new EmbedBuilder()
          .setColor("#4d9802")
          .setTitle("<a:Loading:1429705917267705937> Roblox 계정을 인증해주세요.")
          .setDescription(
            `연동할 계정의 프로필 소개에 아래 인증번호를 입력해주세요.\n\n> **${verifyCode}**\n> Roblox 계정 프로필 > 소개에 인증번호를 입력해 주시면 됩니다.`
          )
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`check_${userId}`)
            .setLabel("인증하기")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`regen_${userId}`)
            .setLabel("인증번호가 검열되었어요")
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({ embeds: [embed], components: [row] });
      }

      // 🧩 인증하기 버튼
      if (interaction.isButton() && interaction.customId.startsWith("check_")) {
        const userId = interaction.customId.split("_")[1];
        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        const entry = data[userId];
        if (!entry)
          return interaction.reply({ content: "<:Warning:1429715991591387146> 세션이 만료되었습니다.", ephemeral: true });

        const res = await fetch(`https://users.roblox.com/v1/users/${entry.robloxId}`);
        const robloxData = await res.json();

        if (robloxData.description?.includes(entry.verifyCode)) {
          entry.verified = true;
          entry.robloxName = robloxData.name;
          fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

          const guild = interaction.guild;
          const member = await guild.members.fetch(userId);
          for (const r of VERIFIED_ROLES) await member.roles.add(r).catch(() => {});

          const embed = new EmbedBuilder()
            .setColor("#5661EA")
            .setTitle("<:Finger:1429722343424659568> 인증이 완료되었습니다.")
            .setDescription(
              `<@${userId}>님, 로블록스 **${robloxData.name}** 계정으로 인증이 완료되었습니다.`
            )
            .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

          const channel = await client.channels.fetch(interaction.channelId);
          await channel.send({ embeds: [embed] });
          return interaction.update({ embeds: [], components: [] });
        } else {
          return interaction.update({ embeds: [errorEmbed("40601")], components: [] });
        }
      }
    } catch (err) {
      console.error("❌ 인증 오류:", err);
      try {
        await interaction.reply({ embeds: [errorEmbed("50001")], ephemeral: true });
      } catch {}
    }
  });

  // ============================================================
  // ✅ 관리자 DM 명령어 (?유저ID / ?ban / ?unban)
  // ============================================================
  client.on("messageCreate", async (msg) => {
    if (msg.channel.type !== 1 || msg.author.bot) return;
    if (!["1410269476011770059"].includes(msg.author.id)) return;
    const args = msg.content.split(" ");
    const command = args[0];
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    const banned = JSON.parse(fs.readFileSync(BAN_FILE, "utf8"));

    // ❓ ?유저ID
    if (command.startsWith("?") && /^\?\d+$/.test(command)) {
      const userId = command.slice(1);
      const entry = data[userId];
      if (!entry) {
        const warn = await msg.channel.send(
          "<:Nocheck:1429716350892507137> 해당 유저의 인증정보를 찾을 수 없습니다."
        );
        setTimeout(() => warn.delete().catch(() => {}), 2000);
        return;
      }

      const user = await client.users.fetch(userId).catch(() => null);
      const guild = await client.guilds.fetch("1410625687580180582");
      const member = await guild.members.fetch(userId).catch(() => null);
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

    // 🚫 ?ban
    if (command === "?ban") {
      const id = args[1];
      if (!id)
        return msg.channel.send("<:Warning:1429715991591387146> 사용자 ID가 필요합니다.").then((m) =>
          setTimeout(() => m.delete().catch(() => {}), 2000)
        );
      const reason = args.slice(2).join(" ") || "없음";
      const entry = data[id];
      if (!entry) return msg.channel.send("<:Warning:1429715991591387146> 인증된 사용자가 아닙니다.");

      banned[id] = {
        discordId: id,
        robloxId: entry.robloxId,
        robloxName: entry.robloxName,
        reason,
      };
      fs.writeFileSync(BAN_FILE, JSON.stringify(banned, null, 2));

      const embed = new EmbedBuilder()
        .setColor("#5661EA")
        .setTitle(`<:Nocheck:1429716350892507137> ${entry.robloxName}을 차단했습니다.`)
        .setDescription(
          `> Discord : <@${id}>\n> -# ID : ${id}\n> Roblox : ${entry.robloxName}\n> -# ID : ${entry.robloxId}\n> 사유 : ${reason}`
        )
        .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
      return msg.channel.send({ embeds: [embed] });
    }

    // ✅ ?unban
    if (command === "?unban") {
      const id = args[1];
      const reason = args.slice(2).join(" ") || "없음";
      if (!banned[id])
        return msg.channel.send("<:Warning:1429715991591387146> 해당 사용자는 차단 목록에 없습니다.");
      delete banned[id];
      fs.writeFileSync(BAN_FILE, JSON.stringify(banned, null, 2));

      const embed = new EmbedBuilder()
        .setColor("#566…EA`)
        .setTitle(`${entry.robloxName}님의 서버차단이 해제되었습니다.`)
        .setDescription(`> 사유 : ${reason}`)
        .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
      return msg.channel.send({ embeds: [embed] });
    }
  });
}
