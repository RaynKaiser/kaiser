const { Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, PermissionsBitField } = require('discord.js');
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
const configPath = path.join(__dirname, 'config.json');

function loadConfig() {
    if (fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (e) {
            console.error("Error reading config.json:", e);
        }
    }
    return {};
}

function saveConfig(config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
}

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

// --- Ticket System Setup ---
client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    if (message.content === '!setuptickets' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const embed = new EmbedBuilder()
            .setTitle('🎫 Support Tickets')
            .setDescription('Click the button below to open a private ticket with the moderation team.')
            .setColor('#2F3136');

        const button = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('create_ticket')
                    .setLabel('Create Ticket')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📩')
            );

        await message.channel.send({ embeds: [embed], components: [button] });
        await message.delete().catch(() => {});
    }

    if (message.content.startsWith('!setautorole') && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const role = message.mentions.roles.first();
        if (!role) return message.reply("Please mention a role! Usage: `!setautorole @RoleName`");

        const config = loadConfig();
        config.autoRoleId = role.id;
        saveConfig(config);

        return message.reply(`✅ Auto-role set to **${role.name}**. New members will automatically receive this role upon joining.\n*Note: Make sure my Kaiser bot role is placed higher than this role in your Server Settings!*`);
    }
});

// --- Ticket System Interaction ---
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'create_ticket') {
        const guild = interaction.guild;
        const user = interaction.user;

        // Check if user already has a ticket
        const existingChannel = guild.channels.cache.find(c => c.name === `ticket-${user.username.toLowerCase()}`);
        if (existingChannel) {
            return interaction.reply({ content: `You already have an open ticket: <#${existingChannel.id}>`, ephemeral: true });
        }

        try {
            const ticketChannel = await guild.channels.create({
                name: `ticket-${user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: guild.id, // @everyone
                        deny: [PermissionsBitField.Flags.ViewChannel],
                    },
                    {
                        id: user.id, // The user who opened the ticket
                        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
                    },
                    {
                        id: client.user.id, // The bot itself
                        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
                    },
                ],
            });

            const embed = new EmbedBuilder()
                .setTitle(`Ticket for ${user.username}`)
                .setDescription('Please describe your issue here. A moderator will be with you shortly.\nTo close this ticket, click the button below.')
                .setColor('#2F3136');

            const closeButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('Close Ticket')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🔒')
                );

            await ticketChannel.send({ content: `<@${user.id}>`, embeds: [embed], components: [closeButton] });

            await interaction.reply({ content: `Your ticket has been created: <#${ticketChannel.id}>`, ephemeral: true });
        } catch (error) {
            console.error('Error creating ticket channel:', error);
            if (typeof writeLog === 'function') writeLog(`[ERROR] Ticket creation failed: ${error.message}`);
            await interaction.reply({ content: `There was an error creating your ticket: **${error.message}**. Please make sure Kaiser has the "Manage Channels" permission!`, ephemeral: true });
        }
    }

    if (interaction.customId === 'close_ticket') {
        await interaction.reply('Ticket will be closed in 5 seconds...');
        setTimeout(() => {
            interaction.channel.delete().catch(console.error);
        }, 5000);
    }
});

// --- Auto-Role on Join ---
client.on(Events.GuildMemberAdd, async member => {
    const config = loadConfig();
    const autoRoleId = config.autoRoleId;
    if (autoRoleId) {
        try {
            const role = member.guild.roles.cache.get(autoRoleId) || await member.guild.roles.fetch(autoRoleId);
            if (role) {
                await member.roles.add(role);
                if (typeof writeLog === 'function') writeLog(`[ROLE] ✅ Assigned auto-role ${role.name} to ${member.user.tag}`);
            }
        } catch (error) {
            console.error(`Failed to assign auto-role to ${member.user.tag}:`, error);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
