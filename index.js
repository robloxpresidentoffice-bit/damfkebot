import "dotenv/config";
import express from "express";
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
} from "discord.js";
import fetch from "node-fetch";
import { setupAuth } from "./auth.js";

// ✅ 환경 변수 확인
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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

// ✅ 메시지 이벤트
client.on("messageCreate", async (message) => {
  try {
    // 🔒 봇 자신은 무시
    if (message.author.bot) return;

    // 🔒 @everyone / @here 멘션 무시
    if (message.mentions.everyone) return;

    // ✅ 봇 멘션 여부 확인
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
              text: `너는 나의 친한 친구야\n항상 따뜻하고 자연스러운 한국어로 이야기하듯 대화해줘.\n\n내가 물어볼게:\n${question}`,
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
      .setTitle("💬 뎀넴의여유봇의 답변")
      .setDescription(answer)
      .setColor(0x00a67e)
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
