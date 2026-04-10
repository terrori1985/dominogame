const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN';
const bot = new Telegraf(BOT_TOKEN);
const MINI_APP_URL = 'https://your-username.github.io/telegram-domino-multiplayer';

// Команда /start
bot.start((ctx) => {
    const userName = ctx.from.first_name;
    
    ctx.replyWithHTML(
        `🎲 <b>Добро пожаловать в Домино, ${userName}!</b>\n\n` +
        `Играй с друзьями в реальном времени!\n` +
        `Создавай столы и приглашай соперников.`,
        Markup.inlineKeyboard([
            [Markup.button.webApp('🎮 Создать игру', `${MINI_APP_URL}/index.html`)],
            [Markup.button.url('📢 Присоединиться к игре', `https://t.me/share/url?url=${MINI_APP_URL}`)]
        ])
    );
});

// Команда /newgame - создать новую игру
bot.command('newgame', (ctx) => {
    ctx.reply(
        '🎲 Создай новую игру в домино!',
        Markup.inlineKeyboard([
            [Markup.button.webApp('🃏 Открыть игровой стол', `${MINI_APP_URL}/index.html`)]
        ])
    );
});

// Команда /help
bot.help((ctx) => {
    ctx.reply(
        '📖 <b>Правила игры:</b>\n\n' +
        '1. Нажми "Создать игру"\n' +
        '2. Настрой параметры (камни, стол)\n' +
        '3. Пригласи друга по ссылке\n' +
        '4. Начинайте игру!\n\n' +
        '🏆 Побеждает тот, кто первым выложит все камни.',
        { parse_mode: 'HTML' }
    );
});

// Запуск бота
bot.launch()
    .then(() => console.log('🤖 Бот запущен'))
    .catch(err => console.error('Ошибка запуска бота:', err));

// Webhook для Render/Heroku
app.use(await bot.createWebhook({ domain: 'your-domain.com' }));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot;