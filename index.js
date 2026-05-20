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

async function writeLog(message, sendToDiscord = true) {
    const now = new Date();
    const timestamp = now.toLocaleString();
    const logMessage = `[${timestamp}] ${message}\n`;

    console.log(logMessage.trim());
    fs.appendFileSync(logFile, logMessage);

    // Send to Discord log channel if configured
    if (sendToDiscord && process.env.LOG_CHANNEL_ID) {
        try {
            const channel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
            if (channel && channel.isTextBased()) {
                let embedColor = '#5865F2'; // Blurple
                if (message.includes('Ready!') || message.includes('✅')) {
                    embedColor = '#2ECC71'; // Green
                } else if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
                    embedColor = '#E74C3C'; // Red
                }

                const embed = new EmbedBuilder()
                    .setColor(embedColor)
                    .setDescription(message)
                    .setTimestamp();

                if (client.user) {
                    embed.setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL({ dynamic: true }) });
                } else {
                    embed.setAuthor({ name: 'Kaiser System' });
                }

                await channel.send({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Error sending log to Discord channel:', error);
        }
    }
}

client.once(Events.ClientReady, readyClient => {
    writeLog(`Ready! Logged in as ${readyClient.user.username}`);
});

// Track voice channel joins, leaves, and switches
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const member = newState.member || oldState.member;
    const user = member ? member.user.username : 'Unknown User';

    let logMsg = '';
    let embedColor = '';
    let embedDesc = '';
    let fields = [];

    // Joined a voice channel
    if (!oldState.channelId && newState.channelId) {
        logMsg = `[VOICE] 🎙️ ${user} JOINED voice channel: ${newState.channel.name}`;
        embedColor = '#2ECC71'; // Green
        embedDesc = `**${user}** joined voice channel <#${newState.channelId}>`;
    }
    // Left a voice channel
    else if (oldState.channelId && !newState.channelId) {
        logMsg = `[VOICE] 🚪 ${user} LEFT voice channel: ${oldState.channel.name}`;
        embedColor = '#E74C3C'; // Red
        embedDesc = `**${user}** left voice channel <#${oldState.channelId}>`;
    }
    // Switched voice channels
    else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        logMsg = `[VOICE] 🔀 ${user} MOVED from ${oldState.channel.name} to ${newState.channel.name}`;
        embedColor = '#3498DB'; // Blue
        embedDesc = `**${user}** moved voice channels`;
        fields.push({ name: 'From', value: `<#${oldState.channelId}>`, inline: true });
        fields.push({ name: 'To', value: `<#${newState.channelId}>`, inline: true });
    }

    if (logMsg) {
        writeLog(logMsg, false);
        if (process.env.LOG_CHANNEL_ID && member) {
            try {
                const channel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
                if (channel && channel.isTextBased()) {
                    const embed = new EmbedBuilder()
                        .setColor(embedColor)
                        .setAuthor({ name: user, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
                        .setDescription(embedDesc)
                        .setTimestamp();
                    
                    if (fields.length > 0) embed.addFields(fields);

                    await channel.send({ embeds: [embed] });
                }
            } catch (error) {
                console.error('Error sending voice embed:', error);
            }
        }
    }
});

// Track deleted messages
client.on(Events.MessageDelete, async message => {
    // Ignore partial messages where we don't have the content
    if (message.partial) {
        writeLog(`[MESSAGE] 🗑️ A message was deleted in #${message.channel?.name || 'unknown'}, but its content could not be retrieved (was not cached).`, false);
        return;
    }

    const author = message.author.username;
    const content = message.cleanContent || message.content || '[No Text Content]';
    const attachments = message.attachments.size > 0
        ? message.attachments.map(a => a.url).join('\n')
        : '';
    const channelName = message.channel.name;

    let logStr = `[MESSAGE] 🗑️ Message DELETED in #${channelName} by ${author}: "${content}"`;
    if (attachments) logStr += ` | Attachments: ${attachments.replace(/\n/g, ', ')}`;

    writeLog(logStr, false);

    if (process.env.LOG_CHANNEL_ID) {
        try {
            const channel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
            if (channel && channel.isTextBased()) {
                const embed = new EmbedBuilder()
                    .setColor('#E74C3C') // Red for deletion
                    .setAuthor({ name: author, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
                    .setDescription(`**Message sent by <@${message.author.id}> deleted in <#${message.channelId}>**\n\n${content}`)
                    .setTimestamp();

                if (attachments) {
                    embed.addFields({ name: 'Attachments', value: attachments });
                }

                await channel.send({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Error sending message delete embed:', error);
        }
    }
});

// --- Ticket System Setup ---
client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    if (message.content === '!setuptickets' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const embed = new EmbedBuilder()
            .setTitle('🎫 Support Tickets')
            .setDescription('Need help? Click the button below to open a private ticket with the moderation team.\n\nOur team will assist you as soon as possible.')
            .setColor('#5865F2')
            .setFooter({ text: 'Kaiser Support System', iconURL: client.user.displayAvatarURL() });

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
                .setTitle(`🎫 Ticket: ${user.username}`)
                .setDescription(`Welcome <@${user.id}>!\n\nPlease describe your issue or question in detail here. A moderator will review it and assist you shortly.\n\n*To close this ticket, click the button below.*`)
                .setColor('#5865F2')
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .setTimestamp();

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

// --- Auto-Role & Welcome on Join ---
client.on(Events.GuildMemberAdd, async member => {
    const config = loadConfig();
    
    // Auto-role: Use config.json if set, otherwise fallback to .env
    const autoRoleId = config.autoRoleId || process.env.AUTO_ROLE_ID;
    if (autoRoleId) {
        try {
            const role = member.guild.roles.cache.get(autoRoleId) || await member.guild.roles.fetch(autoRoleId);
            if (role) {
                await member.roles.add(role);
                if (typeof writeLog === 'function') writeLog(`[ROLE] ✅ Assigned auto-role ${role.name} to ${member.user.username}`, false);

                if (process.env.LOG_CHANNEL_ID) {
                    try {
                        const channel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
                        if (channel && channel.isTextBased()) {
                            const embed = new EmbedBuilder()
                                .setColor('#2ECC71')
                                .setAuthor({ name: member.user.username, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
                                .setDescription(`**${member.user.username}** was assigned auto-role <@&${role.id}>`)
                                .setTimestamp();

                            await channel.send({ embeds: [embed] });
                        }
                    } catch (err) {
                        console.error('Error sending auto-role embed:', err);
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to assign auto-role to ${member.user.username}:`, error);
        }
    }

    // Audit Log: Member Join Embed
    try {
        if (typeof writeLog === 'function') writeLog(`[JOIN] 📥 ${member.user.username} joined the server.`, false);
        
        if (process.env.LOG_CHANNEL_ID) {
            const channel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
            if (channel && channel.isTextBased()) {
                const joinEmbed = new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setAuthor({ name: `${member.user.displayName} joined the server!`, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
                    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
                    .setDescription(`Welcome **${member.user.username}** ( <@${member.user.id}> ) to the server!`)
                    .addFields(
                        { name: '📅 Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                        { name: '👥 Member Count', value: `We now have **${member.guild.memberCount}** members.`, inline: true }
                    )
                    .setTimestamp();
                
                await channel.send({ embeds: [joinEmbed] });
            }
        }
    } catch (error) {
        console.error('Error sending join audit log:', error);
    }
});

// --- Leave Message (Audit Log) ---
client.on(Events.GuildMemberRemove, async member => {
    try {
        if (typeof writeLog === 'function') writeLog(`[LEAVE] 📤 ${member.user.username} left the server.`, false);

        if (process.env.LOG_CHANNEL_ID) {
            const channel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
            if (channel && channel.isTextBased()) {
                const leaveEmbed = new EmbedBuilder()
                    .setColor('#E74C3C')
                    .setAuthor({ name: `${member.user.displayName} left the server.`, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
                    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
                    .setDescription(`**${member.user.username}** ( <@${member.user.id}> ) has left us.`)
                    .addFields(
                        { name: '👥 Member Count', value: `We are down to **${member.guild.memberCount}** members.`, inline: true }
                    )
                    .setTimestamp();
                
                await channel.send({ embeds: [leaveEmbed] });
            }
        }
    } catch (error) {
        console.error('Error sending leave audit log:', error);
    }
});

client.login(process.env.DISCORD_TOKEN);
