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
} from "discord.js";
import fetch from "node-fetch";
import fs from "fs";

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const AUTH_CHANNEL_ID = "1426572704055558205"; // 인증 명령어 허용 채널

// ✅ 인증 완료 후 부여할 역할 ID 목록
const VERIFIED_ROLE_IDS = [
  "1426570497713373194", // 인증 완료 역할
  "1422482866230525952", // 추가 역할 1
  "1422284952799547463", // 추가 역할 2
];

const rest = new REST({ version: "10" }).setToken(TOKEN);
const DATA_FILE = "authData.json";
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "{}");

// ✅ 한국 시간 함수
function getKSTTime() {
  const now = new Date();
  const koreaTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return koreaTime.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// ✅ 공통 오류 임베드
function errorEmbed(code = "00000") {
  return new EmbedBuilder()
    .setColor("#ffc443")
    .setTitle("<:Warning:1429715991591387146> 오류가 발생했어요.")
    .setDescription(
      `다시 시도해 주세요.\n\n> 오류 : **알 수 없는 오류**\n> 코드 : ${code}\n> 조치 : \`인증취소\`\n> **인증** 후 채널을 이용할 수 있어요.`
    )
    .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
}

// ==========================
// 인증 기능 시작
// ==========================
export async function setupAuth(client) {
  // ✅ /인증하기 명령어 등록
  const commands = [
    new SlashCommandBuilder()
      .setName("인증하기")
      .setDescription("로블록스 계정과 디스코드 계정을 연동합니다."),
  ].map((cmd) => cmd.toJSON());

  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ /인증하기 명령어 등록 완료");

  client.on("interactionCreate", async (interaction) => {
    try {
      // 1️⃣ /인증하기 명령어
      if (interaction.isCommand() && interaction.commandName === "인증하기") {
        if (interaction.channelId !== AUTH_CHANNEL_ID)
          return interaction.reply({
            content: "<:Nocheck:1429716350892507137> 지정된 채널에서만 이용할 수 있습니다.",
            ephemeral: true,
          });

        const member = await interaction.guild.members.fetch(interaction.user.id);

        if (VERIFIED_ROLE_IDS.some((r) => member.roles.cache.has(r)))
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
            .setCustomId("auth_accept")
            .setLabel("인증하기")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId("auth_decline")
            .setLabel("거절")
            .setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      // ⚠️ 거절
      if (interaction.isButton() && interaction.customId === "auth_decline") {
        const code = Math.floor(Math.random() * 100000).toString().padStart(5, "0");
        const embed = new EmbedBuilder()
          .setColor("#ffc443")
          .setTitle("<:Warning:1429715991591387146> 본인인증 실패")
          .setDescription(
            `본인인증이 실패되었어요.\n\n> 오류 : **본인인증 거부**\n> 코드 : ${code}\n> 조치 : \`인증취소\`\n> **인증** 후 채널을 이용할 수 있어요.`
          )
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
        await interaction.update({ embeds: [embed], components: [] });
      }

      // 🔗 인증하기 버튼
      if (interaction.isButton() && interaction.customId === "auth_accept") {
        const embed = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("<:Link:1429725659013578813> Roblox 계정 연동하기")
          .setDescription(
            `Roblox 계정 닉네임을 입력해주세요.\n> 입력한 닉네임으로 인증 후 연동이 됩니다.\n> 본인 계정이 아닌 경우 인증이 제한됩니다.`
          )
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("auth_input")
            .setLabel("입력하기")
            .setStyle(ButtonStyle.Primary)
        );

        await interaction.update({ embeds: [embed], components: [row] });
      }

      // 🧩 입력하기 → 모달
      if (interaction.isButton() && interaction.customId === "auth_input") {
        const modal = new ModalBuilder()
          .setCustomId("roblox_modal")
          .setTitle("Roblox 계정 연동하기");

        const input = new TextInputBuilder()
          .setCustomId("roblox_username")
          .setLabel("연동할 Roblox 계정을 입력해주세요.")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
      }

      // 🧾 모달 제출
      if (interaction.isModalSubmit() && interaction.customId === "roblox_modal") {
        const username = interaction.fields.getTextInputValue("roblox_username");

        const embedLoading = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("<a:Loading:1429705917267705937> Roblox 계정 검색중...")
          .setDescription(
            `Roblox 계정을 검색중입니다. 잠시만 기다려주세요.\n\n입력한 닉네임: **${username}**`
          )
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
        await interaction.reply({ embeds: [embedLoading], ephemeral: true });

        try {
          const search = await fetch(
            `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(
              username
            )}&limit=10`
          );
          const searchData = await search.json();

          let robloxUser = null;
          if (searchData.data && searchData.data.length > 0) {
            robloxUser =
              searchData.data.find(
                (u) =>
                  u.name.toLowerCase() === username.toLowerCase() ||
                  u.displayName.toLowerCase() === username.toLowerCase()
              ) || searchData.data[0];
          }

          if (!robloxUser) {
            const embed = new EmbedBuilder()
              .setColor("#ffc443")
              .setTitle("<:Warning:1429715991591387146> Roblox 계정을 찾지 못했어요.")
              .setDescription(
                `연동할 계정을 다시 확인해주세요.\n\n> 오류 : **Roblox 계정 검색 오류**\n> 코드 : 40401\n> 조치 : \`인증취소\`\n> **인증** 후 채널을 이용할 수 있어요.`
              )
              .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
            return interaction.editReply({ embeds: [embed], components: [] });
          }

          // ✅ 찾은 계정 표시
          const verifyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`verify_link_${robloxUser.id}`)
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

          await interaction.editReply({ embeds: [embedFound], components: [verifyRow] });
        } catch (err) {
          console.error("Roblox API 오류:", err);
          await interaction.editReply({ embeds: [errorEmbed("50001")], components: [] });
        }
      }

      // 🟠 다시 검색
      if (interaction.isButton() && interaction.customId === "re_search") {
        const embed = new EmbedBuilder()
          .setColor("#ffc443")
          .setTitle("<:Warning:1429715991591387146> 인증이 초기화되었습니다.")
          .setDescription("다시 `/인증하기` 명령어를 입력해 주세요.")
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
        return interaction.update({ embeds: [embed], components: [] });
      }

      // ✅ 인증 완료 → 역할 3개 부여
      if (interaction.isButton() && interaction.customId.startsWith("verify_check_")) {
        const robloxId = interaction.customId.split("_")[2];
        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        const userData = data[interaction.user.id];
        if (!userData)
          return interaction.reply({
            content: "<:Warning:1429715991591387146> 인증 세션이 만료되었습니다.",
            ephemeral: true,
          });

        const res = await fetch(`https://users.roblox.com/v1/users/${robloxId}`);
        const robloxData = await res.json();

        if (robloxData.description?.includes(userData.verifyCode)) {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          for (const r of VERIFIED_ROLE_IDS) await member.roles.add(r).catch(() => {});
        }
      }
    } catch (err) {
      console.error("인증 오류:", err);
      if (interaction.isRepliable())
        await interaction.reply({ embeds: [errorEmbed("99999")], ephemeral: true });
    }
  });

  // ==========================
  // 📩 관리자 DM ?유저ID
  // ==========================
  client.on("messageCreate", async (message) => {
    try {
      if (message.channel.type !== 1) return;
      if (!message.content.startsWith("?")) return;

      const userId = message.content.replace("?", "").trim();
      if (!/^\d{17,20}$/.test(userId))
        return message.reply("<:Warning:1429715991591387146> 올바른 사용자 ID를 입력해주세요.");

      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      const userData = data[userId];
      if (!userData || !userData.verified)
        return message.reply("<:Warning:1429715991591387146> 해당 사용자는 인증되지 않았습니다.");

      const guild = await client.guilds.fetch("1410625687580180582");
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return message.reply("<:Warning:1429715991591387146> 해당 사용자를 서버에서 찾을 수 없습니다.");

      const nickname = member.nickname || member.user.username;
      const positionMatch = nickname.match(/\[(.*?)\]/);
      const position = positionMatch ? positionMatch[1] : "미지정";

      const roleMap = {
        "1422944460219748362": "대한민국 대통령실",
        "1422945355925819413": "국가정보원",
        "1422942818938388510": "대한민국 감사원",
        "1422945857275166741": "대한민국 대법원",
        "1422946396100890745": "대통령실 경호처",
        "1422947629645430804": "대한민국 외교부",
        "1422945989215522817": "대한민국 행정법원",
        "1422948537293078528": "한미연합",
      };

      let affiliation = "미등록";
      for (const [id, name] of Object.entries(roleMap)) {
        if (member.roles.cache.has(id)) {
          affiliation = name;
          break;
        }
      }

      const embed = new EmbedBuilder()
        .setColor("#5661EA")
        .setTitle(`${member.user.username}님의 정보`)
        .setDescription(
          `> **Discord:** ${member.user.tag}\n> **Roblox:** ${userData.robloxName}\n> **소속:** ${affiliation}\n> **직책:** ${position}`
        )
        .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

      await message.reply({ embeds: [embed] });
    } catch (err) {
      console.error("관리자 DM 조회 오류:", err);
      await message.reply({ embeds: [errorEmbed("95000")] });
    }
  });
}
