import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';
import qrcodeTerminal from 'qrcode-terminal';
import { generateResponse } from './ai-handler.js';
import { fetchCurrentProducts, formatProductsForAI } from './products-fetcher.js';
import { sendNotification, sendNotificationWithButton, startTelegramPolling } from './telegram-notify.js';
import { sendMetaEvent } from './meta-capi.js';
import mongoose from 'mongoose';
import History from './History.js';
import { saveSaleToSheet } from './sheets-logger.js';

// Connection Lock to prevent loops
let isStarting = false;
let sock;

// 🗄️ Database Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

const chatHistory = new Map();
const pausedChats = new Set();
const contactNames = new Map();
const pendingSales = new Map();
let isBotStoppedGlobal = false;

function resumeChat(chatId) {
    const digits = chatId.replace(/\D/g, '');
    pausedChats.delete(chatId);
    pausedChats.delete(digits);
    console.log(`✅ AI Resumed for ${chatId}`);
}

async function startBot() {
    if (isStarting) return;
    isStarting = true;

    console.log('🚀 Finalizing Bot Start Sequence...');

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["3Ahub Bot", "Chrome", "1.0.0"],
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && process.env.USE_PAIRING_CODE !== 'true') {
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            isStarting = false;
            const statusCode = (lastDisconnect?.error instanceof Boom)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log('🔌 Connection closed. Reason:', lastDisconnect?.error?.message || statusCode);

            if (shouldReconnect) {
                console.log('🔄 Reconnecting in 10 seconds...');
                setTimeout(() => startBot(), 10000);
            } else {
                console.log('❌ Logged out. Manual intervention required (Clear auth_info).');
                // Auto-clean on logout to allow fresh pairing
                fs.rmSync('./auth_info', { recursive: true, force: true });
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            isStarting = false;
            console.log('\n==================================================');
            console.log('✅ BOT IS ONLINE AND READY TO RESPOND!');
            console.log('==================================================\n');
        }
    });

    // 🔹 Pairing Code Logic (Restored to working state)
    if (!state.creds.registered && process.env.USE_PAIRING_CODE === 'true') {
        const phoneNumber = process.env.PAIRING_NUMBER;
        if (phoneNumber) {
            setTimeout(async () => {
                try {
                    console.log(`📱 Requesting Pairing Code for: ${phoneNumber}`);
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(`\n==================================================`);
                    console.log(`🔢 YOUR PAIRING CODE:  ${code}`);
                    console.log(`==================================================\n`);
                } catch (err) {
                    console.error("❌ Pairing Request Failed:", err.message);
                }
            }, 8000); // 8 seconds delay to ensure socket is ready
        }
    }

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const chatId = msg.key.remoteJid;
        const normalizedId = chatId.replace(/\D/g, '');

        const getMessageText = (m) => {
            const message = m.message;
            if (!message) return '';
            const content = message.ephemeralMessage?.message || message.viewOnceMessage?.message || message.viewOnceMessageV2?.message || message;
            return content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || '';
        };

        const text = getMessageText(msg);
        const messageText = text.trim().toLowerCase();

        if (chatId.includes('@g.us')) return;

        if (msg.key.fromMe) {
            if (messageText === '!ok') resumeChat(normalizedId);
            return;
        }

        if (isBotStoppedGlobal || pausedChats.has(normalizedId)) return;

        try {
            const data = await fetchCurrentProducts();
            const aiResponse = await generateResponse(text, formatProductsForAI(data), []);
            await sock.sendMessage(chatId, { text: aiResponse.trim() });
        } catch (err) { }
    });
}

// 📡 Telegram Polling
startTelegramPolling(async ({ action, waChatId, data }) => {
    if (action === 'resume') resumeChat(waChatId);
    else if (action === 'stop_bot') isBotStoppedGlobal = true;
    else if (action === 'start_bot') isBotStoppedGlobal = false;
    else if (action === 'payment' || action === 'payform') {
        const phone = action === 'payform' ? data.split('_')[1] : waChatId.split('@')[0];
        await sendMetaEvent('Purchase', { phone: phone }, { value: 1200, currency: 'DZD', contentName: 'Confirmed Order' });
        if (sock && waChatId) {
            try {
                await sock.sendMessage(waChatId, { text: "🎉 تم تأكيد دفعك بنجاح!" });
            } catch (e) { }
        }
    }
});

startBot();
