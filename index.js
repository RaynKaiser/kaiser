const { Client, GatewayIntentBits, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const logFile = path.join(__dirname, 'bot_logs.txt');

async function writeLog(message) {
    const now = new Date();
    const timestamp = now.toLocaleString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    console.log(logMessage.trim());
    fs.appendFileSync(logFile, logMessage);

    // Send to Discord log channel if configured
    if (process.env.LOG_CHANNEL_ID) {
        try {
            const channel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
            if (channel && channel.isTextBased()) {
                const unixTime = Math.floor(now.getTime() / 1000);
                // <t:UNIX:F> creates a full date/time string that adapts to the reader's local timezone in Discord!
                await channel.send(`**<t:${unixTime}:f>** ⸺ ${message}`);
            }
        } catch (error) {
            console.error('Error sending log to Discord channel:', error);
        }
    }
}

client.once(Events.ClientReady, readyClient => {
    writeLog(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Track voice channel joins, leaves, and switches
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const member = newState.member || oldState.member;
    const user = member ? member.user.tag : 'Unknown User';

    // Joined a voice channel
    if (!oldState.channelId && newState.channelId) {
        writeLog(`[VOICE] 🎙️ ${user} JOINED voice channel: ${newState.channel.name}`);
    }
    // Left a voice channel
    else if (oldState.channelId && !newState.channelId) {
        writeLog(`[VOICE] 🚪 ${user} LEFT voice channel: ${oldState.channel.name}`);
    }
    // Switched voice channels
    else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        writeLog(`[VOICE] 🔀 ${user} MOVED from ${oldState.channel.name} to ${newState.channel.name}`);
    }
});

// Track deleted messages
client.on(Events.MessageDelete, message => {
    // Ignore partial messages where we don't have the content
    if (message.partial) {
        writeLog(`[MESSAGE] 🗑️ A message was deleted in #${message.channel?.name || 'unknown'}, but its content could not be retrieved (was not cached).`);
        return;
    }

    const author = message.author.tag;
    const content = message.cleanContent || message.content || '[No Text Content]';
    const attachments = message.attachments.size > 0 
        ? message.attachments.map(a => a.url).join(', ') 
        : '';
    const channel = message.channel.name;

    let logStr = `[MESSAGE] 🗑️ Message DELETED in #${channel} by ${author}: "${content}"`;
    if (attachments) logStr += ` | Attachments: ${attachments}`;

    writeLog(logStr);
});

// Chat Bot (Kaiser the Cat) Logic
const { GoogleGenerativeAI } = require('@google/generative-ai');

client.on(Events.MessageCreate, async message => {
    // Ignore bots
    if (message.author.bot) return;

    // Only respond if the bot is mentioned
    if (message.mentions.has(client.user)) {
        if (!process.env.GEMINI_API_KEY) {
            return message.reply("*angry meow* The developer forgot to give me my Gemini API key in the .env file!");
        }

        const userPrompt = message.content.replace(`<@${client.user.id}>`, '').trim();
        
        try {
            // Show typing indicator in Discord
            await message.channel.sendTyping();

            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ 
                model: "gemini-2.5-flash",
                systemInstruction: "You are Kaiser, a helpful, intelligent, but slightly sassy cat. You answer questions accurately, but you must act entirely like a cat. Frequently use cat sounds like 'Meow', 'Purr', 'Hiss', and reference your feline nature (paws, tail, fur, naps). Keep responses friendly, useful, and under 2000 characters."
            });

            // If they just pinged the bot without text, default to a greeting
            const finalPrompt = userPrompt || "Hello Kaiser!";
            const result = await model.generateContent(finalPrompt);
            const responseText = result.response.text();

            await message.reply(responseText);
        } catch (error) {
            console.error("AI Generation Error:", error);
            await message.reply("*sad meow* I threw up a hairball and forgot what I was doing (API Error).");
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
