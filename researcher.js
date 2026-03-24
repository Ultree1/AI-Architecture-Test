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

const summaryModel = genai.getGenerativeModel({
  model: 'gemini-2.5-flash',
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

// Split a long string into chunks that fit within Discord's 2000 char limit
function chunkText(text, maxLength = 1900) {
  const chunks = [];
  // Try to split on paragraph breaks first so chunks are readable
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const para of paragraphs) {
    // If a single paragraph is itself too long, hard-split it
    if (para.length > maxLength) {
      if (current) { chunks.push(current.trim()); current = ''; }
      for (let i = 0; i < para.length; i += maxLength) {
        chunks.push(para.slice(i, i + maxLength));
      }
      continue;
    }
    if ((current + '\n\n' + para).length > maxLength) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// Generate a short Discord-friendly summary of the full research
async function summarise(task, fullText) {
  const prompt = `Summarise the following research in 3-5 bullet points, each under 100 characters.
Start with one sentence context. Be concrete — include key names, links, or figures where possible.

Task: ${task}
Research: ${fullText.slice(0, 4000)}`;

  try {
    const result = await summaryModel.generateContent(prompt);
    return result.response.text().trim();
  } catch {
    // If summarisation fails, just return the first 1000 chars
    return fullText.slice(0, 1000) + '\n\n*(truncated — full response saved to vault)*';
  }
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
    const fullText = result.response.text();

    // Always save full response to vault
    const filename = saveToVault(task, fullText);
    await logChannel.send(`💾 Saved to vault: \`${filename}\``);

    if (fullText.length <= 1900) {
      // Short enough — post directly
      await msg.reply(fullText);
    } else {
      // Long response — post a summary first, then offer full text in chunks
      const summary = await summarise(task, fullText);
      await msg.reply(
        `📋 **Summary** *(full response saved to vault as \`${filename}\`)*\n\n${summary}`
      );

      // Post the full text in numbered chunks as follow-up messages
      const chunks = chunkText(fullText);
      await msg.reply(`📄 **Full research** (${chunks.length} parts):`);
      for (let i = 0; i < chunks.length; i++) {
        await msg.reply(`**Part ${i + 1}/${chunks.length}**\n\n${chunks[i]}`);
      }
    }

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
