import { Client, GatewayIntentBits } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import 'dotenv/config';

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const researchModel = genai.getGenerativeModel({
  model: 'gemini-2.5-flash',
  tools: [{ googleSearch: {} }],
});

function saveToVault(task, content) {
  const vaultPath = process.env.VAULT_PATH || './vault';
  if (!existsSync(vaultPath)) mkdirSync(vaultPath, { recursive: true });

  const date = new Date();
  const timestamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = task.slice(0, 50).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const filename = `${timestamp}-${slug}.md`;

  const markdown =
`---
date: ${date.toISOString()}
task: "${task}"
agent: researcher
linked: false
---

# ${task}

${content}
`;

  writeFileSync(join(vaultPath, filename), markdown, 'utf8');
  return filename;
}

discord.on('messageCreate', async (msg) => {
  if (msg.channelId !== process.env.CHANNEL_RESEARCH_AGENT) return;
  if (!msg.author.bot) return;
  if (!msg.content.startsWith('__TASK__:')) return;

  const task = msg.content.replace('__TASK__:', '').trim();
  const logChannel = await discord.channels.fetch(process.env.CHANNEL_AGENT_LOG);

  await logChannel.send(`🔬 Researcher starting: **${task}**`);

  try {
    const researchPrompt = `You are a research agent. Answer the following question thoroughly and accurately.
Include key facts and cite your sources where possible.

Task: ${task}`;

    const result = await researchModel.generateContent(researchPrompt);
    const text = result.response.text();

    const filename = saveToVault(task, text);
    await logChannel.send(`💾 Saved to vault: \`${filename}\``);

    await msg.reply(text.slice(0, 1999));
    await logChannel.send(`✅ Research complete for: **${task.slice(0, 80)}**`);

  } catch (err) {
    console.error('Researcher error:', err.message);
    await logChannel.send(`⚠️ Researcher error: ${err.message}`);
    await msg.reply(`⚠️ Research failed: ${err.message}`).catch(() => {});
  }
});

discord.once('ready', () => {
  console.log(`✅ Researcher online as ${discord.user.tag}`);
});

discord.login(process.env.DISCORD_TOKEN_RESEARCHER);
