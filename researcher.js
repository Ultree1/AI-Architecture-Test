import { Client, GatewayIntentBits } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import 'dotenv/config';

function saveToVault(task, content) {
  const vaultPath = process.env.VAULT_PATH || './vault';

  // Create vault folder if it doesn't exist
  if (!existsSync(vaultPath)) mkdirSync(vaultPath, { recursive: true });

  // Build a clean filename from the task text + timestamp
  const date = new Date();
  const timestamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = task.slice(0, 50).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const filename = `${timestamp}-${slug}.md`;

  // Write a markdown file with metadata header + content
  const markdown =
`---
date: ${date.toISOString()}
task: "${task}"
agent: researcher
---

# ${task}

${content}
`;

  writeFileSync(join(vaultPath, filename), markdown, 'utf8');
  return filename;
}

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// gemini-2.5-flash with Google Search grounding for real web results
const researchModel = genai.getGenerativeModel({
  model: 'gemini-2.5-flash',
  tools: [{ googleSearch: {} }],
});

discord.on('messageCreate', async (msg) => {
  if (msg.channelId !== process.env.CHANNEL_RESEARCH_AGENT) return;
  if (!msg.author.bot) return; // only respond to orchestrator bot messages
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

    // Save to vault before posting to Discord
    const filename = saveToVault(task, text);
    await logChannel.send(`💾 Saved to vault: \`${filename}\``);

    // Post result back in the research channel as a reply
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
