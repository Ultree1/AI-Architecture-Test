import { Client, GatewayIntentBits } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' });

const SEARCH_URL = process.env.SEARCH_URL || 'http://localhost:5001';

// Query the semantic search service
async function searchVault(query, nResults = 3) {
  try {
    const res = await fetch(`${SEARCH_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, n_results: nResults }),
    });
    const data = await res.json();
    return data.results || [];
  } catch {
    // Search service not running — degrade gracefully
    return null;
  }
}

discord.on('messageCreate', async (msg) => {
  if (msg.channelId !== process.env.CHANNEL_TASK_INTAKE) return;
  if (msg.author.bot) return;

  const task = msg.content;
  const logChannel = await discord.channels.fetch(process.env.CHANNEL_ORCHESTRATOR_LOG);
  const researchChannel = await discord.channels.fetch(process.env.CHANNEL_RESEARCH_AGENT);

  await logChannel.send(`📋 New task received: **${task}**`);

  try {
    // --- Semantic vault search ---
    let vaultContext = '';
    const results = await searchVault(task);

    if (results === null) {
      await logChannel.send(`⚠️ Search service offline — skipping vault lookup`);
    } else if (results.length === 0) {
      await logChannel.send(`📭 No relevant notes found in vault`);
    } else {
      // Filter to only reasonably close matches (distance < 1.2 is a good threshold)
      const close = results.filter(r => r.distance < 1.2);

      if (close.length > 0) {
        const noteNames = close.map(r => `\`${r.filename}\` (score: ${r.distance.toFixed(2)})`).join(', ');
        await logChannel.send(`📖 Found ${close.length} relevant note(s): ${noteNames}`);

        vaultContext = '\n\nRelevant research from the knowledge base:\n\n' +
          close.map(r => `### ${r.task}\n${r.body}`).join('\n\n---\n\n');
      } else {
        await logChannel.send(`📭 Vault searched — no close matches found`);
      }
    }

    // --- Routing decision ---
    const routingPrompt = `You are an orchestrator agent. Given a task and any relevant knowledge base context, decide how to handle it.
Reply with JSON only, no markdown, no backticks:
{ "route": "vault" | "research" | "direct", "reasoning": "one sentence", "prompt": "refined task for the handler" }

- "vault": knowledge base context is sufficient to answer well
- "research": needs current information or web search the vault doesn't cover
- "direct": simple question answerable from general knowledge

Task: ${task}${vaultContext}`;

    const routingResult = await model.generateContent(routingPrompt);
    const rawText = routingResult.response.text().trim().replace(/```json|```/g, '').trim();

    let decision;
    try {
      decision = JSON.parse(rawText);
    } catch {
      await msg.reply('⚠️ Could not parse routing decision.');
      return;
    }

    await logChannel.send(`🔀 Route: **${decision.route}** — ${decision.reasoning}`);

    if (decision.route === 'vault') {
      const answerPrompt = `You are a helpful assistant. Answer the following task using the provided research context.
Be clear and reference the relevant knowledge where appropriate.

Task: ${task}${vaultContext}`;

      const answerResult = await model.generateContent(answerPrompt);
      const answer = answerResult.response.text();
      await msg.reply(answer.slice(0, 1999));
      await logChannel.send(`✅ Answered from vault`);

    } else if (decision.route === 'research') {
      await researchChannel.send(`__TASK__: ${decision.prompt}`);
      await msg.reply(`🔍 Routing to researcher agent... check <#${process.env.CHANNEL_RESEARCH_AGENT}>`);

    } else {
      const answerResult = await model.generateContent(
        `You are a helpful assistant. Answer clearly and concisely.\n\nTask: ${decision.prompt}`
      );
      const answer = answerResult.response.text();
      await msg.reply(answer.slice(0, 1999));
      await logChannel.send(`✅ Answered directly`);
    }

  } catch (err) {
    console.error('Orchestrator error:', err.message);
    await logChannel.send(`⚠️ Error: ${err.message}`);
    await msg.reply(`⚠️ Something went wrong: ${err.message}`).catch(() => {});
  }
});

discord.once('ready', () => {
  console.log(`✅ Orchestrator online as ${discord.user.tag}`);
});

discord.login(process.env.DISCORD_TOKEN_ORCHESTRATOR);
