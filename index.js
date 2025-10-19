import "dotenv/config";
import express from "express";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import fetch from "node-fetch";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ✅ HTTP Keep-Alive 서버 설정 (Render용)
const app = express();
app.get("/", (req, res) => res.send("✅ Bot is alive!"));
app.listen(process.env.PORT || 3000, () => 
  console.log("🌐 Keep-Alive server running on port 3000")
);
setInterval(() => console.log("💤 Bot keep-alive"), 60_000);


if (!DISCORD_TOKEN || !GEMINI_API_KEY) {
  console.error("❌ .env 파일에 DISCORD_TOKEN 또는 GEMINI_API_KEY 가 없습니다.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("clientReady", () => {
  console.log(`🤖 ${client.user.tag} 로그인 완료!`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;

  const question = message.content.replace(`<@${client.user.id}>`, "").trim();
  if (!question) return message.channel.send("무엇을 물어볼지 함께 적어주세요! 😊");

  await message.channel.sendTyping();

  try {
    // ✅ 최신 MakerSuite API 엔드포인트 (무료용)
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [
        {
          parts: [{ text: `다음 질문에 반드시 한국어로 자연스럽게 답해주세요.\n\n질문: ${question}` }],
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
      console.error("Gemini API 오류 전체:", JSON.stringify(data, null, 2));
      return message.channel.send(
        `🚫 API 오류: ${data.error?.message || "알 수 없는 오류입니다."}`
      );
    }

    const answer =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "⚠️ 답변을 생성할 수 없습니다.";

    const embed = new EmbedBuilder()
      .setAuthor({
        name: message.author.username,
        iconURL: message.author.displayAvatarURL(),
      })
      .setTitle("뎀넴의여유봇의 답변")
      .setDescription(answer)
      .setColor(0x00a67e)
      .setTimestamp();

    await message.channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("❌ 오류:", err);
    await message.channel.send("❌ 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
  }
});

client.login(DISCORD_TOKEN);

import { setupAuth } from "./auth.js";
setupAuth(client);


