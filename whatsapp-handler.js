import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import qrcodeTerminal from 'qrcode-terminal';
import { generateResponse } from './ai-handler.js';
import { fetchCurrentProducts, formatProductsForAI } from './products-fetcher.js';
import { sendNotification, sendNotificationWithButton, startTelegramPolling } from './telegram-notify.js';
import { sendMetaEvent } from './meta-capi.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import mongoose from 'mongoose';
import History from './History.js';
import { saveSaleToSheet } from './sheets-logger.js';

// 🗄️ Database Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

const chatHistory = new Map();
const pausedChats = new Set();
const botMessageIds = new Set();
const autoResumeTimers = new Map();
const contactNames = new Map();
const pendingSales = new Map();
let isBotStoppedGlobal = false;

let sock;

function resumeChat(chatId) {
    const digits = chatId.replace(/\D/g, '');
    pausedChats.delete(chatId);
    pausedChats.delete(digits);
    if (autoResumeTimers.has(digits)) {
        clearTimeout(autoResumeTimers.get(digits));
        autoResumeTimers.delete(digits);
    }
    console.log(`✅ AI Resumed for ${chatId}`);
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    // 🔄 Returning to the OLD stable browser settings
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["3Ahub Bot", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && process.env.USE_PAIRING_CODE !== 'true') {
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔌 Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ BOT IS ONLINE AND READY!');
        }
    });

    // 🔹 Pairing Code (The way it was working)
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
                    console.error("❌ Pairing Error:", err.message);
                }
            }, 5000);
        }
    }

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const chatId = msg.key.remoteJid;
        const normalizedId = chatId.replace(/\D/g, '');
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';

        if (chatId.includes('@g.us')) return;

        if (msg.key.fromMe) {
            if (text.toLowerCase() === '!ok') resumeChat(normalizedId);
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

// 📡 Telegram Polling (Simplified to avoid loops)
startTelegramPolling(async ({ action, waChatId, data }) => {
    if (action === 'resume') resumeChat(waChatId);
    else if (action === 'stop_bot') isBotStoppedGlobal = true;
    else if (action === 'start_bot') isBotStoppedGlobal = false;
    else if (action === 'payment' || action === 'payform') {
        const phone = action === 'payform' ? data.split('_')[1] : waChatId.split('@')[0];
        await sendMetaEvent('Purchase', { phone: phone }, { value: 1200, currency: 'DZD', contentName: 'Confirmed Order' });
        if (sock && waChatId) await sock.sendMessage(waChatId, { text: "🎉 تم تأكيد دفعك بنجاح!" });
    }
});

startBot();
