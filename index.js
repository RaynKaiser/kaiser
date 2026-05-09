const { Client, GatewayIntentBits, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
require('dotenv').config();

// Dummy HTTP server for Render (Render requires Web Services to bind to a port)
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('Kaiser Bot is online!');
    res.end();
}).listen(process.env.PORT || 3000, () => {
    console.log('Dummy web server is running on port ' + (process.env.PORT || 3000));
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [1, 2, 3],
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



client.login(process.env.DISCORD_TOKEN);
