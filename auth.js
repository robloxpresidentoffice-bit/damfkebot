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
          .setTitle("<a:Loading:1429705917267705937> 다시 검색을 시작합니다.")
          .setDescription("새로운 Roblox 계정을 입력해주세요.")
          .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
        return interaction.update({ embeds: [embed], components: [] });
      }

// ✅ 연동하기 버튼 클릭 시 — 인증번호 발급
if (interaction.isButton() && interaction.customId.startsWith("verify_")) {
  const robloxId = interaction.customId.split("_")[1];
  const userId = interaction.user.id;

  // 무작위 5자리 인증번호 생성
  const verifyCode = Math.floor(10000 + Math.random() * 90000).toString();

  // authData.json에 저장
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  data[userId] = {
    robloxId,
    verifyCode,
    verified: false,
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

  // 임베드 생성 (번호 표시)
  const embedCode = new EmbedBuilder()
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

  return interaction.update({ embeds: [embedCode], components: [row] });
}

// 🔍 인증하기 버튼 클릭 시 — Roblox API로 실제 확인
if (interaction.isButton() && interaction.customId.startsWith("check_")) {
  const userId = interaction.customId.split("_")[1];
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const entry = data[userId];

  if (!entry)
    return interaction.reply({
      content: "⚠️ 인증 세션이 만료되었습니다. 다시 시도해주세요.",
      ephemeral: true,
    });

  try {
    const response = await fetch(`https://users.roblox.com/v1/users/${entry.robloxId}`);
    const robloxData = await response.json();

    if (robloxData.description?.includes(entry.verifyCode)) {
      entry.verified = true;
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

      const guild = interaction.guild;
      const member = await guild.members.fetch(userId);
      for (const roleId of VERIFIED_ROLES) {
        await member.roles.add(roleId).catch(() => {});
      }

      const embedDone = new EmbedBuilder()
        .setColor("#5661EA")
        .setTitle("<:Finger:1429722343424659568> 인증이 완료되었습니다.")
        .setDescription(
          `<@${userId}>님, 로블록스 **${robloxData.name}** 계정으로 인증이 완료되었습니다.`
        );

      const channel = await client.channels.fetch(interaction.channelId);
      await channel.send({ embeds: [embedDone] });
      return interaction.update({ embeds: [], components: [] });
    } else {
      const embedFail = new EmbedBuilder()
        .setColor("#ffc443")
        .setTitle("<:Warning:1429715991591387146> 인증이 되지 않았어요.")
        .setDescription(
          `Roblox 계정에 인증번호가 입력되지 않았어요.\n\n> 오류 : **인증번호 미일치**\n> 코드 : 40601\n> 조치 : \`인증취소\`\n> **인증** 후 채널을 이용할 수 있어요.`
        )
        .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
      return interaction.update({ embeds: [embedFail], components: [] });
    }
  } catch (err) {
    console.error("Roblox API 인증 오류:", err);
    return interaction.update({ embeds: [errorEmbed("50002")], components: [] });
  }
}

// 🔁 인증번호가 검열되었어요 → 단어로 재발급
if (interaction.isButton() && interaction.customId.startsWith("regen_")) {
  const userId = interaction.customId.split("_")[1];
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const entry = data[userId];

  if (!entry)
    return interaction.reply({
      content: "⚠️ 인증 세션이 만료되었습니다. 다시 시도해주세요.",
      ephemeral: true,
    });

  // 무작위 단어 예시 (검열되지 않는 단어)
  const words = ["멋진 사과", "푸른 하늘", "기쁜 하루", "평화의 빛", "행복한 순간"];
  const verifyCode = words[Math.floor(Math.random() * words.length)];
  entry.verifyCode = verifyCode;
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

  const embedCode = new EmbedBuilder()
    .setColor("#4d9802")
    .setTitle("<a:Loading:1429705917267705937> Roblox 계정을 인증해주세요.")
    .setDescription(
      `연동할 계정의 프로필 소개에 아래 인증문구를 입력해주세요.\n\n> **${verifyCode}**\n> Roblox 계정 프로필 > 소개에 인증문구를 입력해 주세요.`
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

  return interaction.update({ embeds: [embedCode], components: [row] });
}



// 📩 관리자 DM에서 "?유저ID" 입력 시
client.on("messageCreate", async (message) => {
  try {
    // DM이 아니면 무시
    if (message.channel.type !== 1) return;
    // 봇이 보낸 메시지 무시
    if (message.author.bot) return;
    // ?로 시작하지 않으면 무시
    if (!message.content.startsWith("?")) return;

    const userId = message.content.replace("?", "").trim();
    if (!/^\d+$/.test(userId)) {
      return message.channel.send("<:Warning:1429715991591387146> 올바른 Discord 사용자 ID를 입력해주세요.");
    }

    // authData.json 불러오기
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    const entry = data[userId];
    if (!entry) {
      return message.channel.send("<:Nocheck:1429716350892507137> 해당 유저의 인증정보를 찾을 수 없습니다.");
    }

    // 유저 정보 가져오기
    const user = await client.users.fetch(userId).catch(() => null);
    const mainGuild = await client.guilds.fetch("1410625687580180582"); // 대통령실 서버
    const member = await mainGuild.members.fetch(userId).catch(() => null);

    // ✅ 소속 역할 목록
    const roleMap = {
      "1422944460219748362": "대한민국 대통령실",
      "1422945355925819413": "국가정보원",
      "1422942818938388510": "대한민국 감사원",
      "1422945857275166741": "대한민국 대법원",
      "1422946396100890745": "대통령실 경호처",
      "1422947629645430804": "대한민국 외교부",
      "1422945989215522817": "대한민국 행정법원",
      "1422948537293078528": "한미연합합",
    };

    let roleName = "없음";
    if (member) {
      const foundRole = Object.entries(roleMap).find(([id]) =>
        member.roles.cache.has(id)
      );
      if (foundRole) {
        // 'ㅣ' 이전까지만 출력
        roleName = foundRole[1].split("ㅣ")[0];
      }
    }

    // ✅ 닉네임에서 직책 추출 ([감사원장] hiku → 감사원장)
    let title = "없음";
    if (member?.nickname && member.nickname.includes("[")) {
      const match = member.nickname.match(/\[(.*?)\]/);
      if (match) title = match[1];
    }

    // ✅ 결과 임베드 생성
    const embed = new EmbedBuilder()
      .setColor("#5661EA")
      .setTitle(`${user?.username || "Unknown"} 님의 정보`)
      .setDescription(
        `> Discord : ${user?.tag || "알 수 없음"}\n` +
          `> Roblox : ${entry.robloxName}\n` +
          `> 소속 : ${roleName}\n` +
          `> 직책 : ${title}`
      )
      .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });

    await message.channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("<:Nocheck:1429716350892507137> DM 조회 오류:", err);
    const error = new EmbedBuilder()
      .setColor("#ffc443")
      .setTitle("<:Warning:1429715991591387146> 오류가 발생했어요.")
      .setDescription(
        `다시 시도해 주세요.\n\n> 오류 : **DM 조회 실패**\n> 코드 : 70001\n> 조치 : \`관리자 문의\``
      )
      .setFooter({ text: `뎀넴의여유봇 • ${getKSTTime()}` });
    await message.channel.send({ embeds: [error] });
  }
});


