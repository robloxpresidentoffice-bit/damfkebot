import { REST, Routes } from 'discord.js';
import 'dotenv/config';
import fs from 'fs';

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = await import(`./commands/${file}`);
  commands.push(command.default?.data?.toJSON() ?? command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('명령어 등록 중...');

    // 서버별 명령어 등록
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID_1),
      { body: commands },
    );
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID_2),
      { body: commands },
    );

    console.log('✅ 두 서버에 명령어 등록 완료!');
  } catch (error) {
    console.error(error);
  }
})();
