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
const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

discord.on('messageCreate', async (msg) => {
  if (msg.channelId !== process.env.CHANNEL_TASK_INTAKE) return;
  if (msg.author.bot) return;

  const task = msg.content;
  const logChannel = await discord.channels.fetch(process.env.CHANNEL_ORCHESTRATOR_LOG);
  const researchChannel = await discord.channels.fetch(process.env.CHANNEL_RESEARCH_AGENT);

  await logChannel.send(`📋 New task received: **${task}**`);

  try {
    // Ask Gemini to decide how to route the task
    const routingPrompt = `You are an orchestrator agent. Given a task, decide how to handle it.
Reply with JSON only, no markdown, no backticks:
{ "route": "research" | "direct", "reasoning": "one sentence", "prompt": "refined task for the handler" }

- "research": needs current information, web search, or facts you may not know
- "direct": can be answered from general knowledge

Task: ${task}`;

    const routingResult = await model.generateContent(routingPrompt);
    const rawText = routingResult.response.text().trim();

    let decision;
    try {
      decision = JSON.parse(rawText);
    } catch {
      // Gemini sometimes wraps in markdown code fences — strip them
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      decision = JSON.parse(cleaned);
    }

    await logChannel.send(`🔀 Route: **${decision.route}** — ${decision.reasoning}`);

    if (decision.route === 'research') {
      await researchChannel.send(`__TASK__: ${decision.prompt}`);
      await msg.reply(`🔍 Routing to researcher agent... check <#${process.env.CHANNEL_RESEARCH_AGENT}>`);
    } else {
      // Handle directly with Gemini
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