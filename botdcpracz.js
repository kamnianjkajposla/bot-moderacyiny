require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder,
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    PermissionFlagsBits,
    REST,
    Routes,
    SlashCommandBuilder,
    MessageFlags
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// --- KONFIGURACJA ŚCIEŻKI I ŚRODOWISKA ---
// Domyślnie wskazuje na zamontowany wolumen /app/data w Coolify
const CONFIG_FILE = process.env.CONFIG_PATH || '/app/data/config.json';
const TOKEN = process.env.DISCORD_TOKEN;

let botSettings = {
    modChannelId: '123456789012345678',
    badWords: ['kurwa', 'chuj', 'pizda', 'pierdol', 'jp'],
    blockLinks: true,          
    blockDiscordInvites: true, 
    warnChatMessage: '⚠️ {user}, niedozwolone słowo lub link!',
    warnDmMessage: '⚠️ Otrzymałeś ostrzeżenie na serwerze {server}!\n• Powód: {reason}\n• Status: {warns}/{maxWarns}',
    spamLimit: 5,
    spamTime: 3000,
    muteDurationMinutes: 5,
    warnsSpamLimit: 3,
    punishmentSpam: 'timeout',
    warnsBadWordLimit: 3,
    punishmentBadWord: 'timeout',
    warnsLinkLimit: 3,
    punishmentLink: 'timeout',
    maxPingsPerMessage: 4,
    warnsPingLimit: 2,
    punishmentPing: 'timeout',

    // Powitania
    welcomeEnabled: false,
    welcomeChannelId: '123456789012345678',
    welcomeStyle: 'embed',
    welcomeMessage: 'Witaj {user} na serwerze {server}! Jesteś naszym {members} członkiem.',

    // Pożegnania
    goodbyeEnabled: false,
    goodbyeChannelId: '123456789012345678',
    goodbyeStyle: 'embed',
    goodbyeMessage: 'Żegnaj {user}. Użytkownik opuścił serwer {server}. Zostało nas {members} osób.'
};

// Automatyczne tworzenie katalogu /app/data, jeśli nie istnieje
const configDir = path.dirname(CONFIG_FILE);
if (!fs.existsSync(configDir)) {
    try {
        fs.mkdirSync(configDir, { recursive: true });
        console.log(`[SYSTEM] Utworzono katalog na dane: ${configDir}`);
    } catch (err) {
        console.error(`[BLAD] Nie udało się utworzyć katalogu ${configDir}:`, err);
    }
}

// Wczytanie konfiguracji z pliku
if (fs.existsSync(CONFIG_FILE)) {
    try {
        const savedData = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        botSettings = { ...botSettings, ...savedData };
        console.log(`[INFO] Wczytano konfigurację pomyślnie z: ${CONFIG_FILE}`);
    } catch (e) {
        console.error('[BLAD] Plik konfiguracyjny jest uszkodzony, używam domyślnych ustawień.');
    }
} else {
    // Tworzy domyślny plik przy pierwszym uruchomieniu w zamontowanym wolumenie
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(botSettings, null, 4), 'utf8');
        console.log(`[INFO] Utworzono domyślny plik konfiguracyjny w: ${CONFIG_FILE}`);
    } catch (e) {
        console.error('[BLAD] Nie można zapisać pliku konfiguracyjnego w wolumenie.');
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(botSettings, null, 4), 'utf8');
    } catch (e) {
        console.error('[BLAD] Błąd podczas zapisywania konfiguracji:', e);
    }
}

// --- ZARZĄDZANIE PAMIĘCIĄ I MAPAMI (Optymalizacja zasobów) ---
const userMessageTracker = new Map();
const userWarnings = new Map(); 
const userHistoryLogs = new Map(); 
const dmLogTracker = new Map();

// Cykliczne czyszczenie starej pamięci podręcznej co 10 minut (zapobiega wyciekom RAM)
setInterval(() => {
    const now = Date.now();
    for (const [userId, timestamps] of userMessageTracker.entries()) {
        const filtered = timestamps.filter(t => now - t < 60000);
        if (filtered.length === 0) userMessageTracker.delete(userId);
        else userMessageTracker.set(userId, filtered);
    }
    for (const [userId, dms] of dmLogTracker.entries()) {
        const filtered = dms.filter(t => now - t < 120000);
        if (filtered.length === 0) dmLogTracker.delete(userId);
        else dmLogTracker.set(userId, filtered);
    }
}, 10 * 60 * 1000);

function addHistoryLog(userId, actionText, details) {
    if (!userHistoryLogs.has(userId)) userHistoryLogs.set(userId, []);
    const history = userHistoryLogs.get(userId);
    history.unshift({ date: new Date().toLocaleString('pl-PL'), action: actionText, details: details });
    if (history.length > 5) history.pop();
}

async function safeSendDM(member, category, reason, currentWarns, maxLimit) {
    const userId = member.id;
    const now = Date.now();
    if (!dmLogTracker.has(userId)) dmLogTracker.set(userId, []);
    let dms = dmLogTracker.get(userId);
    dms = dms.filter(t => now - t < 60000);
    if (dms.length >= 3) return;
    dms.push(now);
    dmLogTracker.set(userId, dms);

    const formattedDm = botSettings.warnDmMessage
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{tag}/g, member.user.username)
        .replace(/{server}/g, member.guild.name)
        .replace(/{reason}/g, reason)
        .replace(/{warns}/g, currentWarns.toString())
        .replace(/{maxWarns}/g, maxLimit.toString());

    try {
        await member.send(formattedDm);
    } catch (e) {}
}

const commands = [
    new SlashCommandBuilder().setName('panel-moderacyjny').setDescription('Panel sterowania bota (Admin) - Prywatny'),
    new SlashCommandBuilder().setName('panel-powitan').setDescription('Edytor powitań (Admin)'),
    new SlashCommandBuilder().setName('panel-pozegnan').setDescription('Edytor pożegnań (Admin)'),
    new SlashCommandBuilder()
        .setName('sprawdz-uzytkownika')
        .setDescription('Historia ostrzeżeń gracza')
        .addUserOption(option => option.setName('uzytkownik').setDescription('Gracz').setRequired(true)),
    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Wycisza gracza')
        .addUserOption(option => option.setName('uzytkownik').setDescription('Gracz').setRequired(true))
        .addIntegerOption(option => option.setName('minuty').setDescription('Minuty').setRequired(true).setMinValue(1).setMaxValue(10080))
        .addStringOption(option => option.setName('powod').setDescription('Powód').setRequired(false)),
    new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Zdejmuje wyciszenie')
        .addUserOption(option => option.setName('uzytkownik').setDescription('Gracz').setRequired(true))
].map(command => command.toJSON());

// --- TESTY ŁĄCZNOŚCI I START BOTA ---
client.once('clientReady', async () => {
    console.log('==================================================');
    console.log(`[TEST ŁĄCZNOŚCI] ✅ Połączono pomyślnie z Discord API!`);
    console.log(`[TEST ŁĄCZNOŚCI] 🤖 Zalogowano jako: ${client.user.tag}`);
    console.log(`[TEST ŁĄCZNOŚCI] 🌐 Bot obsługuje serwery: ${client.guilds.cache.size}`);
    console.log(`[TEST ŁĄCZNOŚCI] 📂 Ścieżka konfiguracji: ${CONFIG_FILE}`);
    console.log('==================================================');

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('[TEST ŁĄCZNOŚCI] ✅ Pomyślnie zarejestrowano komendy Slash (/panel-...)!');
    } catch (error) {
        console.error('[TEST ŁĄCZNOŚCI] ❌ Błąd rejestracji komend Slash:', error);
    }
    console.log('==================================================');
});

// --- POWITANIA I POŻEGNANIA ---
client.on('guildMemberAdd', async (member) => {
    if (!botSettings.welcomeEnabled) return;
    const channel = member.guild.channels.cache.get(botSettings.welcomeChannelId);
    if (!channel) return;

    const formattedText = botSettings.welcomeMessage
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{tag}/g, member.user.username)
        .replace(/{server}/g, member.guild.name)
        .replace(/{members}/g, member.guild.memberCount.toString());

    try {
        if (botSettings.welcomeStyle === 'embed') {
            const embed = new EmbedBuilder().setTitle(`👋 Witaj na serwerze ${member.guild.name}!`).setDescription(formattedText).setThumbnail(member.user.displayAvatarURL({ dynamic: true })).setColor(0x00FF00).setTimestamp();
            await channel.send({ embeds: [embed] });
        } else {
            await channel.send({ content: formattedText });
        }
    } catch (e) {}
});

client.on('guildMemberRemove', async (member) => {
    if (!botSettings.goodbyeEnabled) return;
    const channel = member.guild.channels.cache.get(botSettings.goodbyeChannelId);
    if (!channel) return;

    const formattedText = botSettings.goodbyeMessage
        .replace(/{user}/g, `**${member.user.tag}**`)
        .replace(/{tag}/g, member.user.username)
        .replace(/{server}/g, member.guild.name)
        .replace(/{members}/g, member.guild.memberCount.toString());

    try {
        if (botSettings.goodbyeStyle === 'embed') {
            const embed = new EmbedBuilder().setTitle(`📤 Użytkownik opuścił serwer`).setDescription(formattedText).setThumbnail(member.user.displayAvatarURL({ dynamic: true })).setColor(0xFF0000).setTimestamp();
            await channel.send({ embeds: [embed] });
        } else {
            await channel.send({ content: formattedText });
        }
    } catch (e) {}
});

async function handleInfraction(guild, member, category, punishmentType, reason, messageContent) {
    const userId = member.id;
    const nowStr = new Date().toLocaleString('pl-PL');
    
    if (!userWarnings.has(userId)) {
        userWarnings.set(userId, { badWords: 0, links: 0, spam: 0, pings: 0 });
    }
    let warnsData = userWarnings.get(userId);

    let currentWarns = 0;
    let maxLimit = 3;

    if (category === 'badWord') { warnsData.badWords++; currentWarns = warnsData.badWords; maxLimit = botSettings.warnsBadWordLimit; }
    else if (category === 'link') { warnsData.links++; currentWarns = warnsData.links; maxLimit = botSettings.warnsLinkLimit; }
    else if (category === 'spam') { warnsData.spam++; currentWarns = warnsData.spam; maxLimit = botSettings.warnsSpamLimit; }
    else if (category === 'ping') { warnsData.pings++; currentWarns = warnsData.pings; maxLimit = botSettings.warnsPingLimit; }

    let actionTaken = `Ostrzeżenie (${currentWarns}/${maxLimit})`;
    let finalPunishmentApplied = false;

    if (currentWarns >= maxLimit) {
        finalPunishmentApplied = true;
        if (category === 'badWord') warnsData.badWords = 0;
        if (category === 'link') warnsData.links = 0;
        if (category === 'spam') warnsData.spam = 0;
        if (category === 'ping') warnsData.pings = 0;
        
        try {
            if (punishmentType === 'timeout') {
                await member.timeout(botSettings.muteDurationMinutes * 60 * 1000, reason);
                actionTaken = `Limit ostrzeżeń! Wyciszenie na ${botSettings.muteDurationMinutes} min.`;
            } else if (punishmentType === 'kick') {
                await member.kick(reason);
                actionTaken = `Limit ostrzeżeń! Wyrzucono z serwera (Kick).`;
            } else if (punishmentType === 'ban') {
                await member.ban({ reason: reason });
                actionTaken = `Limit ostrzeżeń! Zbanowano (Ban).`;
            }
        } catch (e) {
            actionTaken = `Brak uprawnień do wykonania kary.`;
        }
    }

    addHistoryLog(userId, `Kategoria: ${category.toUpperCase()}`, `Powód: ${reason} | Akcja: ${actionTaken}`);
    await safeSendDM(member, category, reason, currentWarns, maxLimit);

    const modChannel = guild.channels.cache.get(botSettings.modChannelId);
    if (modChannel) {
        const logEmbed = new EmbedBuilder()
            .setTitle(`🚨 Log Moderacji – ${category.toUpperCase()}`)
            .setColor(finalPunishmentApplied ? 0xFF0000 : 0xFFA500)
            .addFields(
                { name: '👤 Użytkownik', value: `${member.user.tag} (${userId})`, inline: true },
                { name: '📂 Kategoria', value: category, inline: true },
                { name: '⚠️ Ostrzeżenia', value: `${currentWarns} / ${maxLimit}`, inline: true },
                { name: '💬 Treść', value: messageContent ? messageContent.slice(0, 500) : 'Brak', inline: false },
                { name: '🔨 Wynik', value: actionTaken, inline: false },
                { name: '📅 Data', value: nowStr, inline: false }
            )
            .setTimestamp();
        await modChannel.send({ embeds: [logEmbed] });
    }
}

async function sendEphemeralWarning(channel, member, customText) {
    const formatted = (customText || botSettings.warnChatMessage)
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{tag}/g, member.user.username);

    try {
        const msg = await channel.send({ content: formatted });
        setTimeout(() => msg.delete().catch(() => {}), 4000);
    } catch (e) {}
}

// --- AUTOMODERACJA I CENZURA ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const member = message.member;
    const userId = message.author.id;
    const contentLower = message.content.toLowerCase();

    if (member.permissions.has(PermissionFlagsBits.Administrator)) return;

    // 1. Anty-Ping
    const totalPings = message.mentions.users.size + message.mentions.roles.size;
    if (botSettings.maxPingsPerMessage > 0 && totalPings > botSettings.maxPingsPerMessage) {
        try {
            await message.delete();
            await sendEphemeralWarning(message.channel, member, `⚠️ {user}, za dużo wzmianek w jednej wiadomości!`);
            await handleInfraction(message.guild, member, 'ping', botSettings.punishmentPing, 'Masowe oznaczanie osób/ról', message.content);
        } catch (e) {}
        return;
    }

    // 2. Blokada zaproszeń Discord
    const discordInviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/[a-zA-Z0-9]+/gi;
    if (botSettings.blockDiscordInvites && discordInviteRegex.test(message.content)) {
        try {
            await message.delete();
            await sendEphemeralWarning(message.channel, member, `⚠️ {user}, wysyłanie zaproszeń na inne serwery jest zabronione!`);
            await handleInfraction(message.guild, member, 'link', botSettings.punishmentLink, 'Wysłanie zaproszenia Discord', message.content);
        } catch (e) {}
        return;
    }

    // 3. Blokada linków
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    if (botSettings.blockLinks && urlRegex.test(message.content)) {
        try {
            await message.delete();
            await sendEphemeralWarning(message.channel, member, `⚠️ {user}, wysyłanie linków jest zabronione!`);
            await handleInfraction(message.guild, member, 'link', botSettings.punishmentLink, 'Wysłanie linku', message.content);
        } catch (e) {}
        return;
    }

    // 4. Cenzura słów
    const containsBadWord = botSettings.badWords.some(word => {
        const clean = word.trim().toLowerCase();
        return clean.length > 0 && contentLower.includes(clean);
    });

    if (containsBadWord) {
        try {
            await message.delete();
            await sendEphemeralWarning(message.channel, member, botSettings.warnChatMessage);
            await handleInfraction(message.guild, member, 'badWord', botSettings.punishmentBadWord, 'Użycie słowa z cenzury', message.content);
        } catch (e) {}
        return;
    }

    // 5. Anty-Spam
    const now = Date.now();
    if (!userMessageTracker.has(userId)) userMessageTracker.set(userId, []);
    let timestamps = userMessageTracker.get(userId);
    timestamps.push(now);
    timestamps = timestamps.filter(t => now - t < botSettings.spamTime);
    userMessageTracker.set(userId, timestamps);

    if (timestamps.length >= botSettings.spamLimit) {
        try {
            await message.delete();
            await sendEphemeralWarning(message.channel, member, `⚠️ {user}, zwolnij ze spamem!`);
            await handleInfraction(message.guild, member, 'spam', botSettings.punishmentSpam, 'Przekroczenie limitu spamu', 'Masowe wiadomości');
        } catch (err) {}
    }
});

// --- OBSŁUGA INTERAKCJI ---
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'panel-moderacyjny') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ Wymagany Administrator!', flags: MessageFlags.Ephemeral });
            }

            const panelEmbed = new EmbedBuilder()
                .setTitle('🛡️ Centrum Konfiguracji Moderacji')
                .setDescription('Wybierz kategorię zarządzania z menu:')
                .setColor(0x00008B);

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('panel_categories_menu')
                .setPlaceholder('📂 Wybierz kategorię...')
                .addOptions([
                    { label: '🧹 Wyczyść Czat', description: 'Usuń 10 wiadomości', value: 'cat_clear' },
                    { label: '📝 Formularz Zgłoszeniowy', description: 'Otwórz formularz', value: 'cat_form' },
                    { label: '⚙️ Konfiguracja Kar i Spamu', description: 'Limity, kary i ostrzeżenia', value: 'cat_edit_antispam' },
                    { label: '🛑 Cenzura, Linki, Zaproszenia i Wygląd', description: 'Edycja słów, zaproszeń i komunikatów', value: 'cat_edit_words' },
                    { label: '📊 Status Bota', description: 'Aktualne ustawienia', value: 'cat_status' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            return await interaction.reply({ embeds: [panelEmbed], components: [row], flags: MessageFlags.Ephemeral });
        }

        else if (commandName === 'panel-powitan') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ Wymagany Administrator!', flags: MessageFlags.Ephemeral });
            }

            const welcomeEmbed = new EmbedBuilder()
                .setTitle('👋 Panel Konfiguracji Powitań')
                .setColor(0x00FF00)
                .addFields(
                    { name: 'Status', value: botSettings.welcomeEnabled ? '✅ Włączone' : '❌ Wyłączone', inline: true },
                    { name: 'Kanał ID', value: `\`${botSettings.welcomeChannelId}\``, inline: true },
                    { name: 'Treść', value: botSettings.welcomeMessage, inline: false }
                );

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('welcome_select_menu')
                .setPlaceholder('⚙️ Wybierz akcję...')
                .addOptions([
                    { label: '📝 Edytuj Treść i Kanał Powitań', value: 'w_edit_text' },
                    { label: botSettings.welcomeEnabled ? '❌ Wyłącz Powitania' : '✅ Włącz Powitania', value: 'w_toggle' },
                    { label: '🎨 Zmień Wygląd (Embed / Tekst)', value: 'w_style' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            return await interaction.reply({ embeds: [welcomeEmbed], components: [row], flags: MessageFlags.Ephemeral });
        }

        else if (commandName === 'panel-pozegnan') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ Wymagany Administrator!', flags: MessageFlags.Ephemeral });
            }

            const goodbyeEmbed = new EmbedBuilder()
                .setTitle('📤 Panel Konfiguracji Pożegnań')
                .setColor(0xFF0000)
                .addFields(
                    { name: 'Status', value: botSettings.goodbyeEnabled ? '✅ Włączone' : '❌ Wyłączone', inline: true },
                    { name: 'Kanał ID', value: `\`${botSettings.goodbyeChannelId}\``, inline: true },
                    { name: 'Treść', value: botSettings.goodbyeMessage, inline: false }
                );

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('goodbye_select_menu')
                .setPlaceholder('⚙️ Wybierz akcję...')
                .addOptions([
                    { label: '📝 Edytuj Treść i Kanał Pożegnań', value: 'g_edit_text' },
                    { label: botSettings.goodbyeEnabled ? '❌ Wyłącz Pożegnania' : '✅ Włącz Pożegnania', value: 'g_toggle' },
                    { label: '🎨 Zmień Wygląd (Embed / Tekst)', value: 'g_style' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            return await interaction.reply({ embeds: [goodbyeEmbed], components: [row], flags: MessageFlags.Ephemeral });
        }

        else if (commandName === 'sprawdz-uzytkownika') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ Brak uprawnień!', flags: MessageFlags.Ephemeral });
            }

            const targetUser = interaction.options.getUser('uzytkownik');
            const history = userHistoryLogs.get(targetUser.id) || [];
            const warns = userWarnings.get(targetUser.id) || { badWords: 0, links: 0, spam: 0, pings: 0 };

            let historyText = history.length === 0 ? 'Brak incydentów.' : history.map(h => `• **[${h.date}]** ${h.action}\n  ↳ *${h.details}*`).join('\n');
            if (historyText.length > 900) historyText = historyText.slice(0, 900) + '...';

            const embed = new EmbedBuilder()
                .setTitle(`📊 Gracz: ${targetUser.tag}`)
                .setColor(0xFFD700)
                .addFields(
                    { name: '⚠️ Aktywne Ostrzeżenia', value: `• Słowa: ${warns.badWords}/${botSettings.warnsBadWordLimit}\n• Linki: ${warns.links}/${botSettings.warnsLinkLimit}\n• Spam: ${warns.spam}/${botSettings.warnsSpamLimit}\n• Pingi: ${warns.pings}/${botSettings.warnsPingLimit}`, inline: false },
                    { name: '📜 Historia', value: historyText, inline: false }
                );

            return await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        else if (commandName === 'mute') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                return interaction.reply({ content: '❌ Brak uprawnień!', flags: MessageFlags.Ephemeral });
            }
            const targetMember = interaction.options.getMember('uzytkownik');
            const minutes = interaction.options.getInteger('minuty');
            const reason = interaction.options.getString('powod') || 'Brak';
            try {
                await targetMember.timeout(minutes * 60 * 1000, reason);
                return await interaction.reply({ content: `✅ Wyciszono ${targetMember.user.tag} na ${minutes} min.`, flags: MessageFlags.Ephemeral });
            } catch (e) {
                return await interaction.reply({ content: '❌ Błąd wyciszania.', flags: MessageFlags.Ephemeral });
            }
        }

        else if (commandName === 'unmute') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                return interaction.reply({ content: '❌ Brak uprawnień!', flags: MessageFlags.Ephemeral });
            }
            const targetMember = interaction.options.getMember('uzytkownik');
            try {
                await targetMember.timeout(null, 'Odciszenie');
                return await interaction.reply({ content: `✅ Odciszono ${targetMember.user.tag}.`, flags: MessageFlags.Ephemeral });
            } catch (e) {
                return await interaction.reply({ content: '❌ Błąd odciszania.', flags: MessageFlags.Ephemeral });
            }
        }
    }

    // OBSŁUGA MENU POWITAŃ
    if (interaction.isStringSelectMenu() && interaction.customId === 'welcome_select_menu') {
        const value = interaction.values[0];

        if (value === 'w_toggle') { 
            botSettings.welcomeEnabled = !botSettings.welcomeEnabled; 
            saveConfig(); 

            const updatedEmbed = new EmbedBuilder()
                .setTitle('👋 Panel Konfiguracji Powitań')
                .setColor(0x00FF00)
                .addFields(
                    { name: 'Status', value: botSettings.welcomeEnabled ? '✅ Włączone' : '❌ Wyłączone', inline: true },
                    { name: 'Kanał ID', value: `\`${botSettings.welcomeChannelId}\``, inline: true },
                    { name: 'Treść', value: botSettings.welcomeMessage, inline: false }
                );

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('welcome_select_menu')
                .setPlaceholder('⚙️ Wybierz akcję...')
                .addOptions([
                    { label: '📝 Edytuj Treść i Kanał Powitań', value: 'w_edit_text' },
                    { label: botSettings.welcomeEnabled ? '❌ Wyłącz Powitania' : '✅ Włącz Powitania', value: 'w_toggle' },
                    { label: '🎨 Zmień Wygląd (Embed / Tekst)', value: 'w_style' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            return await interaction.update({ embeds: [updatedEmbed], components: [row] });
        }
        else if (value === 'w_style') { 
            botSettings.welcomeStyle = botSettings.welcomeStyle === 'embed' ? 'tekst' : 'embed'; 
            saveConfig(); 
            return await interaction.reply({ content: `✅ Wygląd powitań: **${botSettings.welcomeStyle.toUpperCase()}**`, flags: MessageFlags.Ephemeral }); 
        }
        else if (value === 'w_edit_text') {
            const modal = new ModalBuilder().setCustomId('modal_welcome').setTitle('Edycja Powitań');
            const chInput = new TextInputBuilder().setCustomId('w_ch').setLabel('ID Kanału').setStyle(TextInputStyle.Short).setValue(botSettings.welcomeChannelId).setRequired(true);
            const msgInput = new TextInputBuilder().setCustomId('w_msg').setLabel('Treść ({user}, {tag}, {server}, {members})').setStyle(TextInputStyle.Paragraph).setValue(botSettings.welcomeMessage).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(chInput), new ActionRowBuilder().addComponents(msgInput));
            return await interaction.showModal(modal);
        }
    }

    // OBSŁUGA MENU POŻEGNAN
    if (interaction.isStringSelectMenu() && interaction.customId === 'goodbye_select_menu') {
        const value = interaction.values[0];

        if (value === 'g_toggle') { 
            botSettings.goodbyeEnabled = !botSettings.goodbyeEnabled; 
            saveConfig(); 

            const updatedEmbed = new EmbedBuilder()
                .setTitle('📤 Panel Konfiguracji Pożegnań')
                .setColor(0xFF0000)
                .addFields(
                    { name: 'Status', value: botSettings.goodbyeEnabled ? '✅ Włączone' : '❌ Wyłączone', inline: true },
                    { name: 'Kanał ID', value: `\`${botSettings.goodbyeChannelId}\``, inline: true },
                    { name: 'Treść', value: botSettings.goodbyeMessage, inline: false }
                );

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('goodbye_select_menu')
                .setPlaceholder('⚙️ Wybierz akcję...')
                .addOptions([
                    { label: '📝 Edytuj Treść i Kanał Pożegnań', value: 'g_edit_text' },
                    { label: botSettings.goodbyeEnabled ? '❌ Wyłącz Pożegnania' : '✅ Włącz Pożegnania', value: 'g_toggle' },
                    { label: '🎨 Zmień Wygląd (Embed / Tekst)', value: 'g_style' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            return await interaction.update({ embeds: [updatedEmbed], components: [row] });
        }
        else if (value === 'g_style') { 
            botSettings.goodbyeStyle = botSettings.goodbyeStyle === 'embed' ? 'tekst' : 'embed'; 
            saveConfig(); 
            return await interaction.reply({ content: `✅ Wygląd pożegnań: **${botSettings.goodbyeStyle.toUpperCase()}**`, flags: MessageFlags.Ephemeral }); 
        }
        else if (value === 'g_edit_text') {
            const modal = new ModalBuilder().setCustomId('modal_goodbye').setTitle('Edycja Pożegnań');
            const chInput = new TextInputBuilder().setCustomId('g_ch').setLabel('ID Kanału').setStyle(TextInputStyle.Short).setValue(botSettings.goodbyeChannelId).setRequired(true);
            const msgInput = new TextInputBuilder().setCustomId('g_msg').setLabel('Treść ({user}, {tag}, {server}, {members})').setStyle(TextInputStyle.Paragraph).setValue(botSettings.goodbyeMessage).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(chInput), new ActionRowBuilder().addComponents(msgInput));
            return await interaction.showModal(modal);
        }
    }

    // GŁÓWNE MENU MODERACJI
    if (interaction.isStringSelectMenu() && interaction.customId === 'panel_categories_menu') {
        const category = interaction.values[0];

        if (category === 'cat_clear') {
            try {
                await interaction.channel.bulkDelete(10, true);
                return await interaction.reply({ content: '✅ Usunięto 10 wiadomości.', flags: MessageFlags.Ephemeral });
            } catch (e) {
                return await interaction.reply({ content: '❌ Błąd usuwania.', flags: MessageFlags.Ephemeral });
            }
        } else if (category === 'cat_form') {
            const modal = new ModalBuilder().setCustomId('modal_form').setTitle('Zgłoszenie');
            const q1 = new TextInputBuilder().setCustomId('f1').setLabel('Treść').setStyle(TextInputStyle.Paragraph).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(q1));
            return await interaction.showModal(modal);
        } else if (category === 'cat_edit_antispam') {
            const modal = new ModalBuilder().setCustomId('modal_antispam').setTitle('Ustawienia Kar i Spamu');
            const limit = new TextInputBuilder().setCustomId('l').setLabel('Max spam msg').setStyle(TextInputStyle.Short).setValue(botSettings.spamLimit.toString()).setRequired(true);
            const pSpam = new TextInputBuilder().setCustomId('ps').setLabel('Kara spam (timeout/kick/ban)').setStyle(TextInputStyle.Short).setValue(botSettings.punishmentSpam).setRequired(true);
            const wSpam = new TextInputBuilder().setCustomId('ws').setLabel('Max ostrzeżeń spam').setStyle(TextInputStyle.Short).setValue(botSettings.warnsSpamLimit.toString()).setRequired(true);
            const dur = new TextInputBuilder().setCustomId('d').setLabel('Czas mute (min)').setStyle(TextInputStyle.Short).setValue(botSettings.muteDurationMinutes.toString()).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(limit), new ActionRowBuilder().addComponents(pSpam), new ActionRowBuilder().addComponents(wSpam), new ActionRowBuilder().addComponents(dur));
            return await interaction.showModal(modal);
        } else if (category === 'cat_edit_words') {
            const modal = new ModalBuilder().setCustomId('modal_words').setTitle('Cenzura, Linki, Wygląd i Logi');
            const ch = new TextInputBuilder().setCustomId('ch').setLabel('ID Kanału Logów').setStyle(TextInputStyle.Short).setValue(botSettings.modChannelId).setRequired(true);
            const words = new TextInputBuilder().setCustomId('w').setLabel('Słowa (po przecinku)').setStyle(TextInputStyle.Paragraph).setValue(botSettings.badWords.join(', ')).setRequired(true);
            const invites = new TextInputBuilder().setCustomId('inv').setLabel('Blokuj zaproszenia Discord? (tak/nie)').setStyle(TextInputStyle.Short).setValue(botSettings.blockDiscordInvites ? 'tak' : 'nie').setRequired(true);
            const chatWarn = new TextInputBuilder().setCustomId('cw').setLabel('Ostrzeżenie Czat ({user})').setStyle(TextInputStyle.Short).setValue(botSettings.warnChatMessage).setRequired(true);
            const dmWarn = new TextInputBuilder().setCustomId('dw').setLabel('Wiadomość DM ({user},{reason},{warns})').setStyle(TextInputStyle.Paragraph).setValue(botSettings.warnDmMessage).setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(ch), 
                new ActionRowBuilder().addComponents(words), 
                new ActionRowBuilder().addComponents(invites),
                new ActionRowBuilder().addComponents(chatWarn),
                new ActionRowBuilder().addComponents(dmWarn)
            );
            return await interaction.showModal(modal);
        } else if (category === 'cat_status') {
            return await interaction.reply({ content: `📊 **Ustawienia:**\n• Kanał logów: \`${botSettings.modChannelId}\`\n• Zaproszenia Discord: ${botSettings.blockDiscordInvites ? 'Blokowane' : 'Dozwolone'}\n• Wszystkie Linki: ${botSettings.blockLinks ? 'Tak' : 'Nie'}`, flags: MessageFlags.Ephemeral });
        }
    }

    // OBSŁUGA OKIENEK MODALNYCH
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_welcome') {
            botSettings.welcomeChannelId = interaction.fields.getTextInputValue('w_ch').trim();
            botSettings.welcomeMessage = interaction.fields.getTextInputValue('w_msg');
            saveConfig();
            return await interaction.reply({ content: '✅ Zaktualizowano powitania!', flags: MessageFlags.Ephemeral });
        } else if (interaction.customId === 'modal_goodbye') {
            botSettings.goodbyeChannelId = interaction.fields.getTextInputValue('g_ch').trim();
            botSettings.goodbyeMessage = interaction.fields.getTextInputValue('g_msg');
            saveConfig();
            return await interaction.reply({ content: '✅ Zaktualizowano pożegnania!', flags: MessageFlags.Ephemeral });
        } else if (interaction.customId === 'modal_antispam') {
            botSettings.spamLimit = parseInt(interaction.fields.getTextInputValue('l')) || botSettings.spamLimit;
            botSettings.punishmentSpam = interaction.fields.getTextInputValue('ps').trim().toLowerCase();
            botSettings.warnsSpamLimit = parseInt(interaction.fields.getTextInputValue('ws')) || botSettings.warnsSpamLimit;
            botSettings.muteDurationMinutes = parseInt(interaction.fields.getTextInputValue('d')) || botSettings.muteDurationMinutes;
            saveConfig();
            return await interaction.reply({ content: '✅ Zapisano ustawienia w pliku JSON!', flags: MessageFlags.Ephemeral });
        } else if (interaction.customId === 'modal_words') {
            botSettings.modChannelId = interaction.fields.getTextInputValue('ch').trim();
            botSettings.badWords = interaction.fields.getTextInputValue('w').split(',').map(w => w.trim()).filter(w => w.length > 0);
            botSettings.blockDiscordInvites = interaction.fields.getTextInputValue('inv').trim().toLowerCase() === 'tak';
            botSettings.warnChatMessage = interaction.fields.getTextInputValue('cw');
            botSettings.warnDmMessage = interaction.fields.getTextInputValue('dw');
            saveConfig();
            return await interaction.reply({ content: '✅ Zaktualizowano ustawienia i cenzurę w JSON!', flags: MessageFlags.Ephemeral });
        } else if (interaction.customId === 'modal_form') {
            const content = interaction.fields.getTextInputValue('f1');
            const modChannel = interaction.guild.channels.cache.get(botSettings.modChannelId);
            if (modChannel) {
                await modChannel.send({ content: `📝 Zgłoszenie od ${interaction.user.tag}: ${content}` });
                return await interaction.reply({ content: '✅ Wysłano zgłoszenie!', flags: MessageFlags.Ephemeral });
            } else {
                return await interaction.reply({ content: '❌ Nie znaleziono kanału logów!', flags: MessageFlags.Ephemeral });
            }
        }
    }
});

process.on('unhandledRejection', error => {
    console.error('[BLAD KRYTYCZNY - PROCES]:', error);
});

client.login(TOKEN);
