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
const VERIFIED_ROLE_ID = "1426570497713373194"; // ✅ 인증 완료 역할 ID
const AUTH_CHANNEL_ID = "1426572704055558205"; // ✅ 인증 명령어 허용 채널 ID

const rest = new REST({ version: "10" }).setToken(TOKEN);
const DATA_FILE = "authData.json";
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "{}");

export async function setupAuth(client) {
  // ✅ 슬래시 명령어 등록
  const commands = [
    new SlashCommandBuilder()
      .setName("인증하기")
      .setDescription("로블록스 계정과 디스코드 계정을 연동합니다."),
  ].map((cmd) => cmd.toJSON());

  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ /인증하기 명령어 등록 완료");

  client.on("interactionCreate", async (interaction) => {
    try {
      // 1️⃣ /인증하기 명령어 처리
      if (interaction.isCommand() && interaction.commandName === "인증하기") {
        // ✅ 채널 제한 확인
        if (interaction.channelId !== AUTH_CHANNEL_ID) {
          return interaction.reply({
            content: "⚠️ 지정된 채널에서만 이용할 수 있습니다.",
            ephemeral: true,
          });
        }

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasVerifiedRole = member.roles.cache.has(VERIFIED_ROLE_ID);
        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        const existing = data[interaction.user.id];

        // ⚠️ 이미 인증된 계정일 때 (Embed)
        if (hasVerifiedRole && existing) {
          const embed = new EmbedBuilder()
            .setTitle("⚠️ 이미 인증된 계정이 있습니다.")
            .setDescription(
              `**로블록스:** ${existing.robloxName}\n\n다른 계정으로 연동하시겠습니까?`
            )
            .setColor(0xffc107);

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`newauth_${interaction.user.id}`)
              .setLabel("다른 계정으로 연동하기")
              .setStyle(ButtonStyle.Secondary)
          );

          return interaction.reply({
            ephemeral: true,
            embeds: [embed],
            components: [row],
          });
        }

        if (hasVerifiedRole && !existing) {
          return interaction.reply({
            content: "⚠️ 이미 인증이 완료된 사용자입니다.",
            ephemeral: true,
          });
        }

        if (!hasVerifiedRole && existing && existing.verified) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`relink_${interaction.user.id}`)
              .setLabel("연동하기")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`newauth_${interaction.user.id}`)
              .setLabel("다른 계정으로 연동하기")
              .setStyle(ButtonStyle.Secondary)
          );

          return interaction.reply({
            ephemeral: true,
            content: `이전에 Roblox 계정과 이미 연동되어 있습니다.\nAlready linked with Roblox account: **${existing.robloxName}**`,
            components: [row],
          });
        }

        // 인증 시작
        const embed = new EmbedBuilder()
          .setTitle("Roblox 계정과 연동하기")
          .setDescription("아래 버튼을 눌러 로블록스 계정을 연동하세요.")
          .setColor(0x00a67e);

        const button = new ButtonBuilder()
          .setCustomId("start_auth")
          .setLabel("계정연동하기")
          .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(button);
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      // 🔄 다른 계정으로 새 인증
      if (interaction.isButton() && interaction.customId.startsWith("newauth_")) {
        const userId = interaction.customId.replace("newauth_", "");
        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        delete data[userId];
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

        await interaction.reply({
          content: "이전 인증이 초기화되었습니다. 다시 `/인증하기` 명령어를 입력해주세요.",
          ephemeral: true,
        });
      }

      // 🔁 연동하기 (Link Again)
      if (interaction.isButton() && interaction.customId.startsWith("relink_")) {
        const userId = interaction.customId.replace("relink_", "");
        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        const existing = data[userId];
        if (!existing) return;

        const guild = interaction.guild;
        const member = await guild.members.fetch(userId);
        await member.roles.add(VERIFIED_ROLE_ID).catch(() => {});

        await interaction.reply({
          content: `Roblox 계정 **${existing.robloxName}** 와의 연동이 다시 완료되었습니다.`,
          ephemeral: true,
        });

        const embed = new EmbedBuilder()
          .setTitle("인증이 완료되었습니다.")
          .setDescription(
            `<@${userId}>님, **${existing.robloxName}** 계정으로 연동이 완료되었습니다.\n\n\u200B`
          )
          .setColor(0x00a67e)
          .setFooter({
            text: `뎀넴의여유봇 • ${new Date().toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
            })}`,
          });

        const channel = await client.channels.fetch(interaction.channelId);
        await channel.send({ embeds: [embed] });
      }

      // 🧩 계정연동 모달
      if (interaction.isButton() && interaction.customId === "start_auth") {
        const modal = new ModalBuilder()
          .setCustomId("roblox_modal")
          .setTitle("로블록스 인증하기");

        const input = new TextInputBuilder()
          .setCustomId("roblox_username")
          .setLabel("로블록스 닉네임 또는 아이디")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);

        await interaction.showModal(modal);
      }

      // 🧾 모달 제출
      if (interaction.isModalSubmit() && interaction.customId === "roblox_modal") {
        const username = interaction.fields.getTextInputValue("roblox_username");
        const verifyCode = Math.floor(1000000 + Math.random() * 9000000).toString();

        await interaction.reply({
          ephemeral: true,
          content: `🔍 Roblox 사용자 **${username}** 를 확인 중입니다...`,
        });

        let robloxId = null;
        let robloxName = null;

        try {
          // ✅ 유연한 검색 (대소문자 무시 + 표시이름 지원)
          const search = await fetch(
            `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(username)}&limit=10`
          );
          const searchData = await search.json();

          if (searchData.data && searchData.data.length > 0) {
            const exact = searchData.data.find(
              (u) =>
                u.name.toLowerCase() === username.toLowerCase() ||
                u.displayName.toLowerCase() === username.toLowerCase()
            );
            const user = exact || searchData.data[0];
            robloxId = user.id;
            robloxName = user.name;
          }

          // POST 방식 보조 검색
          if (!robloxId) {
            const res2 = await fetch("https://users.roblox.com/v1/usernames/users", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ usernames: [username] }),
            });
            const data2 = await res2.json();

            if (data2.data && data2.data.length > 0) {
              robloxId = data2.data[0].id;
              robloxName = data2.data[0].name;
            }
          }

          if (!robloxId) {
            return interaction.editReply("해당 닉네임 또는 아이디를 가진 Roblox 계정을 찾을 수 없습니다.");
          }
        } catch (err) {
          console.error("Roblox API Error:", err);
          return interaction.editReply("⚠️ Roblox API 오류가 발생했습니다.");
        }

        // ✅ 데이터 저장
        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        data[interaction.user.id] = {
          robloxId,
          robloxName,
          verifyCode,
          verified: false,
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

        const verifyButton = new ButtonBuilder()
          .setCustomId(`verify_${interaction.user.id}`)
          .setLabel("로블록스 계정 연동하기")
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(verifyButton);

        await interaction.editReply({
          content: `Roblox 계정 **${robloxName}** 을(를) 찾았습니다.\n\n아래 코드를 Roblox 상태 메시지에 입력해주세요:\n\`\`\`${verifyCode}\`\`\`\n\n프로필 소개에 코드를 넣은 뒤 아래 **연동하기** 버튼을 누르세요.`,
          components: [row],
        });
      }

      // 🔗 연동 버튼 클릭 시
      if (interaction.isButton() && interaction.customId.startsWith("verify_")) {
        const userId = interaction.customId.replace("verify_", "");
        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        const userData = data[userId];
        if (!userData)
          return interaction.reply({
            content: "⚠️ 인증 세션이 만료되었습니다. 다시 시도해주세요.",
            ephemeral: true,
          });

        const response = await fetch(`https://users.roblox.com/v1/users/${userData.robloxId}`);
        const robloxData = await response.json();

        if (robloxData.description?.includes(userData.verifyCode)) {
          userData.verified = true;
          fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

          const guild = interaction.guild;
          const member = await guild.members.fetch(userId);
          await member.roles.add(VERIFIED_ROLE_ID).catch(() => {});

          await interaction.reply({
            content: `Roblox 계정 **${userData.robloxName}** 인증 완료`,
            ephemeral: true,
          });

          const embed = new EmbedBuilder()
            .setTitle("인증이 완료되었습니다.")
            .setDescription(
              `<@${userId}>님, **${userData.robloxName}** 계정으로 연동이 완료되었습니다.\n\n`
            )
            .setColor(0x00a67e)
            .setFooter({
              text: `뎀넴의여유봇 • ${new Date().toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
              })}`,
            });

          const channel = await client.channels.fetch(interaction.channelId);
          await channel.send({ embeds: [embed] });
        } else {
          await interaction.reply({
            content: "인증 코드가 Roblox 상태 메시지에 없습니다.",
            ephemeral: true,
          });
        }
      }
    } catch (err) {
      console.error("인증 오류:", err);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "⚠️ 인증 중 오류가 발생했습니다. 다시 시도해주세요.",
          ephemeral: true,
        });
      }
    }
  });
}

