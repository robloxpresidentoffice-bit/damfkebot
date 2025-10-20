import "dotenv/config";
import express from "express";
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActivityType,
} from "discord.js";
import fetch from "node-fetch";
import { setupAuth } from "./auth.js";

// ✅ 환경 변수 확인
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ADMIN_ID = "1410269476011770059"; // 관리자
const GUILD_ID = "1410625687580180582"; // 메인 서버 ID

if (!DISCORD_TOKEN || !GEMINI_API_KEY) {
  console.error("❌ .env 파일에 DISCORD_TOKEN 또는 GEMINI_API_KEY 가 없습니다.");
  process.exit(1);
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

// ✅ 메시지 이벤트 (AI 응답)
client.on("messageCreate", async (message) => {
  try {
    // 🔒 봇 자신은 무시
    if (message.author.bot) return;

    // 🔒 @everyone / @here 멘션 무시
    if (message.mentions.everyone) return;

    // ✅ 관리자 명령어 (DM 전용)
    if (!message.guild && message.author.id === ADMIN_ID) {
      const content = message.content.trim();

      // 🎮 ?play (내용)
      if (content.startsWith("?play ")) {
        const newStatus = content.slice(6).trim();
        if (!newStatus) return;

        await client.user.setPresence({
          activities: [{ name: newStatus, type: ActivityType.Playing }],
          status: "online",
        });

        const replyMsg = await message.channel.send(
          `상태 메시지를 \`${newStatus}\` 으로 변경했어요!`
        );
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
        return;
      }

      // 🧾 ?유저ID 또는 !유저ID
      if (content.startsWith("?") || content.startsWith("!")) {
        const userId = content.slice(1).trim();
        if (!/^\d+$/.test(userId)) return;

        const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
        if (!guild) return;

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
          const replyMsg = await message.channel.send(
            "<:Warning:1429715991591387146> 해당 사용자를 서버에서 찾을 수 없습니다."
          );
          setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
          return;
        }

        // ✅ 역할 이름 매핑
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
        for (const [id, name] of Object.entries(roleMap)) {
          if (member.roles.cache.has(id)) {
            roleName = name.split("ㅣ")[0];
            break;
          }
        }

        // ✅ 닉네임에서 직책 추출 ([감사원장] hiku → 감사원장)
        let title = "없음";
        if (member.nickname && member.nickname.includes("[")) {
          const match = member.nickname.match(/\[(.*?)\]/);
          if (match) title = match[1];
        }

        // ✅ 결과 임베드 생성
        const embed = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle(`${member.displayName} 님의 정보`)
          .setDescription(
            `> **Discord:** ${member.user.tag}\n` +
              `> **소속:** ${roleName}\n` +
              `> **직책:** ${title}`
          )
          .setFooter({ text: "뎀넴의여유봇 • 한국시간 기준" });

        await message.channel.send({ embeds: [embed] });
        return;
      }
    }

    // ✅ 봇 멘션 여부 확인 (AI 응답)
    if (!message.mentions.has(client.user)) return;

    // ✅ DM에서는 AI 응답하지 않음
    if (message.channel.type === 1) return;

    // 질문 내용 추출
    const question = message.content
      .replace(`<@${client.user.id}>`, "")
      .trim();

    if (!question)
      return message.channel.send("질문 내용도 함께 보내줘 :D");

    // ✅ 1️⃣ “더 좋은 답변 생각중” 임시 메시지
    const thinkingMsg = await message.channel.send(
      "<a:Loading:1429705917267705937> 더 좋은 답변 생각중..."
    );

    // ✅ 2️⃣ Gemini API 요청
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [
        {
          parts: [
            {
              text: `너는 나의 친한 친구야\n항상 따뜻하고 자연스러운 한국어로 이야기하듯 대화해줘. 이모티콘 사용은 자제해줘.\n\n내가 물어볼게:\n${question}`,
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

    // ✅ 3️⃣ 결과 임베드 생성
    const embed = new EmbedBuilder()
      .setAuthor({
        name: message.author.username,
        iconURL: message.author.displayAvatarURL(),
      })
      .setTitle("뎀넴의여유봇의 답변")
      .setDescription(answer)
      .setColor("#dbc593")
      .setTimestamp();

    // ✅ 4️⃣ 기존 메시지를 임베드로 수정 (캐시 오류 방지)
    await thinkingMsg
      .edit({ content: "", embeds: [embed] })
      .catch(async () => {
        await message.channel.send({ embeds: [embed] });
      });
  } catch (err) {
    console.error("❌ 오류:", err);
    try {
      const errorEmbed = new EmbedBuilder()
        .setColor("#ffc443")
        .setTitle("<:Warning:1429715991591387146> 오류가 발생했어요.")
        .setDescription(
          "다시 시도해 주세요.\n\n> 오류 : **알 수 없는 오류**\n> 코드 : 50001\n> 조치 : `재시도`\n> **잠시 후 다시 이용해 주세요.**"
        )
        .setFooter({
          text: `뎀넴의여유봇 • ${new Date().toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          })}`,
        });
      await message.channel.send({ embeds: [errorEmbed] });
    } catch {}
  }
});

// ✅ 로그인
client.login(DISCORD_TOKEN);

