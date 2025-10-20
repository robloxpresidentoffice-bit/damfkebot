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

// ✅ 환경 설정
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const VERIFIED_ROLES = [
  "1426570497713373194", // 인증 완료
  "1422482866230525952", // 추가 역할 1
  "1422284952799547463", // 추가 역할 2
];
const AUTH_CHANNEL_ID = "1426572704055558205"; // 명령어 사용 채널

const rest = new REST({ version: "10" }).setToken(TOKEN);
const DATA_FILE = "authData.json";
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "{}");

// ✅ 한국시간 함수
function getKSTTime() {
  return new Date().toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
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

// ✅ 본체
export async function setupAuth(client) {
  // 슬래시 명령어 등록
  const commands = [
    new SlashCommandBuilder()
      .setName("인증하기")
      .setDescription("로블록스 계정과 디스코드 계정을 연동합니다."),
  ].map((cmd) => cmd.toJSON());

  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ /인증하기 명령어 등록 완료");

  // 메인 리스너
  client.on("interactionCreate", async (interaction) => {
    try {
      // ✅ /인증하기 명령어
      if (interaction.isCommand() && interaction.commandName === "인증하기") {
        if (interaction.channelId !== AUTH_CHANNEL_ID)
          return interaction.reply({
            content: "<:Warning:1429715991591387146> 지정된 채널에서만 이용할 수 있습니다.",
            ephemeral: true,
          });

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasVerifiedRole = VERIFIED_ROLES.some((r) =>
          member.roles.cache.has(r)
        );
        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        const existing = data[interaction.user.id];

        if (hasVerifiedRole)
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

      // ❌ 거절 버튼 클릭 시
      if (interaction.isButton() && interaction.customId === "deny_auth") {
        const embed = new EmbedBuilder()
          .setColor("#ffc443")
          .setTitle("<:Warning:1429715991591387146> 본인인증 실패")
          .setDescription(
            `본인인증이 실패되었어요.\n\n> 오류 : **본인인증 거부**\n> 코드 : 40301\n> 조치 : \`인증취소\`\n> **인증** 후 채널을 이용할 수 있어요.`
          )
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
        return interaction.update({ embeds: [embed], components: [] });
      }

      // 🧩 연동하기 버튼 클릭 시 (모달 열기)
      if (interaction.isButton() && interaction.customId === "start_auth") {
        const modal = new ModalBuilder()
          .setCustomId("roblox_modal")
          .setTitle("Roblox 계정 연동하기");
        const input = new TextInputBuilder()
          .setCustomId("roblox_username")
          .setLabel("연동할 Roblox 계정을 입력해주세요.")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);
        return interaction.showModal(modal);
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

        let robloxUser = null;
        try {
          const search = await fetch(
            `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(
              username
            )}&limit=10`
          );
          const searchData = await search.json();

          if (searchData.data && searchData.data.length > 0) {
            robloxUser =
              searchData.data.find(
                (u) =>
                  u.name.toLowerCase() === username.toLowerCase() ||
                  u.displayName.toLowerCase() === username.toLowerCase()
              ) || searchData.data[0];
          }

          if (!robloxUser) {
            const res2 = await fetch("https://users.roblox.com/v1/usernames/users", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ usernames: [username] }),
            });
            const data2 = await res2.json();
            if (data2.data && data2.data.length > 0) robloxUser = data2.data[0];
          }

          // 5초간 유지
          await new Promise((resolve) => setTimeout(resolve, 5000));

          if (!robloxUser) {
            const embedFail = new EmbedBuilder()
              .setColor("#ffc443")
              .setTitle("<:Warning:1429715991591387146> Roblox 계정을 찾지 못했어요.")
              .setDescription(
                `연동할 계정을 다시 확인해주세요.\n\n> 오류 : **Roblox 계정 검색 오류**\n> 코드 : 40401\n> 조치 : \`인증취소\`\n> **인증** 후 채널을 이용할 수 있어요.`
              )
              .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
            return interaction.editReply({ embeds: [embedFail], components: [] });
          }

          // ✅ 계정 찾은 경우
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

          await interaction.editReply({ embeds: [embedFound], components: [verifyRow] });
        } catch (err) {
          console.error("Roblox API 오류:", err);
          await interaction.editReply({ embeds: [errorEmbed("50001")], components: [] });
        }
      }

      // 🔁 다시 검색 버튼
      if (interaction.isButton() && interaction.customId === "re_search") {
        const embed = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("🔄 다시 검색을 시작합니다.")
          .setDescription("새로운 Roblox 계정을 입력해주세요.")
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
        return interaction.update({ embeds: [embed], components: [] });
      }

      // ✅ 연동하기 버튼 클릭 시 (역할 부여 + 완료 메시지)
      if (interaction.isButton() && interaction.customId.startsWith("verify_")) {
        const userId = interaction.user.id;
        const robloxName = interaction.customId.split("_")[1];

        const guild = interaction.guild;
        const member = await guild.members.fetch(userId);
        for (const roleId of VERIFIED_ROLES) {
          await member.roles.add(roleId).catch(() => {});
        }

        const embedDone = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("<:Finger:1429722343424659568> 인증이 완료되었습니다.")
          .setDescription(
            `<@${userId}>님, 로블록스 **${robloxName}** 계정으로 인증이 완료되었습니다.`
          );

        const channel = await client.channels.fetch(interaction.channelId);
        await channel.send({ embeds: [embedDone] });
        await interaction.update({ embeds: [], components: [] });
      }

      // 📩 관리자 DM에서 "?유저ID" 입력 시
      if (
        interaction.channel?.type === 1 &&
        interaction.content?.startsWith("?")
      ) {
        const userId = interaction.content.replace("?", "").trim();
        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        const entry = data[userId];
        if (!entry)
          return interaction.channel.send("해당 유저의 인증정보를 찾을 수 없습니다.");

        const user = await client.users.fetch(userId).catch(() => null);
        const embed = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle(`${user?.username || "Unknown"} 님의 정보`)
          .setDescription(
            `> Discord : ${user?.tag || "알 수 없음"}\n> Roblox : ${
              entry.robloxName
            }\n> 소속 : (확인 중)\n> 직책 : (확인 중)`
          )
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

        await interaction.channel.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error("인증 오류:", err);
      try {
        if (interaction.replied || interaction.deferred)
          await interaction.editReply({ embeds: [errorEmbed("99999")], components: [] });
      } catch (e) {}
    }
  });
}



