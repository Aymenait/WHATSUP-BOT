import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import { exec } from 'child_process';
import qrcodeTerminal from 'qrcode-terminal';
import { generateResponse, checkPurchaseIntent, checkSupportIntent } from './ai-handler.js';
import { fetchCurrentProducts, formatProductsForAI } from './products-fetcher.js';
import { notifyNewLead, sendNotification, sendNotificationWithButton, startTelegramPolling } from './telegram-notify.js';
import { sendMetaEvent } from './meta-capi.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import mongoose from 'mongoose';
import History from './History.js';
import { saveSaleToSheet } from './sheets-logger.js';

// 🗄️ الاتصال بقاعدة البيانات
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

const AUTO_RESUME_DELAY = 24 * 60 * 60 * 1000;

let sock;

function generateTransactionId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = 'TRX-';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function resumeChat(chatId) {
    const digits = chatId.replace(/\D/g, '');
    for (const pausedId of pausedChats) {
        if (pausedId.replace(/\D/g, '') === digits || pausedId === chatId || pausedId === digits) {
            pausedChats.delete(pausedId);
            console.log(`✅ AI Resumed: Removed ${pausedId}`);
        }
    }
    if (autoResumeTimers.has(digits)) {
        clearTimeout(autoResumeTimers.get(digits));
        autoResumeTimers.delete(digits);
    }
}

const handleAutoDelivery = async (productName, chatId, normalizedId, sock) => {
    try {
        const inventoryPath = './inventory.json';
        if (!fs.existsSync(inventoryPath)) return false;
        const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
        const productKey = Object.keys(inventory).find(k => k.toLowerCase().includes(productName.toLowerCase()) || productName.toLowerCase().includes(k.toLowerCase()));

        if (productKey && inventory[productKey] && inventory[productKey].length > 0) {
            const availableIndex = inventory[productKey].findIndex(item => item.status === 'available');
            if (availableIndex !== -1) {
                const item = inventory[productKey][availableIndex];
                let accountDetails = item.account;
                if (item.account.includes(':')) {
                    const [email, ...rest] = item.account.split(':');
                    const pass = rest.join(':');
                    accountDetails = `📧 الإيميل: \`${email}\` \n🔑 كلمة السر: \`${pass}\``;
                }
                const deliveryMsg = `🚀 *تسليم آلي ناجح!* \n\nتفضل حسابك الخاص بـ *${productKey}*:\n\n${accountDetails} \n\nاستمتع! ✨`;
                await sock.sendMessage(chatId, { text: deliveryMsg });

                if (!item.unlimited) {
                    inventory[productKey][availableIndex].status = 'used';
                    inventory[productKey][availableIndex].usedAt = new Date().toISOString();
                    inventory[productKey][availableIndex].usedBy = normalizedId;
                    fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));
                }
                await sendNotification(`🚚 <b>تسليم آلي:</b> ${normalizedId} -> ${productKey}`);
                return true;
            }
        }
        return false;
    } catch (e) { return false; }
};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["Mac OS", "Chrome", "110.0.5481.178"],
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔌 Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(() => startBot(), 5000);
            } else {
                console.log('❌ Logged out. Clearing auth_info...');
                fs.rmSync('./auth_info', { recursive: true, force: true });
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ BOT IS ONLINE AND READY!');
        }
    });

    // 🔹 Pairing Code Request
    if (!state.creds.registered && process.env.USE_PAIRING_CODE === 'true') {
        setTimeout(async () => {
            const phoneNumber = process.env.PAIRING_NUMBER;
            if (phoneNumber) {
                try {
                    console.log(`📱 Requesting Pairing Code for: ${phoneNumber}`);
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(`\n==================================================`);
                    console.log(`🔢 YOUR PAIRING CODE:  ${code}`);
                    console.log(`==================================================\n`);
                } catch (err) {
                    console.error("❌ Failed to request pairing code:", err.message);
                }
            }
        }, 6000);
    }

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const messageTimestamp = msg.messageTimestamp;
        const now = Math.floor(Date.now() / 1000);
        if (now - messageTimestamp > 120) return;

        const chatId = msg.key.remoteJid;
        const normalizedId = chatId.replace(/\D/g, '');
        const pushName = msg.pushName || 'User';
        const messageId = msg.key.id;

        const getMessageText = (m) => {
            const message = m.message;
            if (!message) return '';
            const content = message.ephemeralMessage?.message || message.viewOnceMessage?.message || message.viewOnceMessageV2?.message || message;
            return content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || '';
        };

        const text = getMessageText(msg);
        const messageText = text.trim().toLowerCase();

        if (chatId.includes('@g.us')) return;

        const updateHistoryPassively = async (role, content) => {
            try {
                let currentHistory = chatHistory.get(normalizedId);
                if (!currentHistory) {
                    const dbH = await History.findOne({ chatId: normalizedId });
                    currentHistory = dbH ? dbH.messages : [];
                }
                currentHistory.push({ role, text: content });
                if (currentHistory.length > 40) currentHistory.shift();
                chatHistory.set(normalizedId, currentHistory);
                await History.findOneAndUpdate({ chatId: normalizedId }, { messages: currentHistory, lastUpdate: new Date() }, { upsert: true });
            } catch (e) { }
        };

        if (msg.key.fromMe) {
            if (!botMessageIds.has(messageId)) {
                await updateHistoryPassively('assistant', text || '(وسائط)');
            }
            if (messageText === '!ok' || messageText === '!bot') resumeChat(normalizedId);
            if (messageText === '!stop') pausedChats.add(normalizedId);
            return;
        }

        if (isBotStoppedGlobal || pausedChats.has(normalizedId)) {
            await updateHistoryPassively('user', text || '(وسائط)');
            return;
        }

        try {
            const data = await fetchCurrentProducts();
            const context = data ? formatProductsForAI(data) : "منتجاتنا متوفرة.";
            if (!chatHistory.has(normalizedId)) {
                const dbH = await History.findOne({ chatId: normalizedId });
                chatHistory.set(normalizedId, dbH ? dbH.messages : []);
            }
            const history = chatHistory.get(normalizedId) || [];

            let imageBase64 = null;
            if (msg.message?.imageMessage) {
                const buffer = await downloadMediaMessage(msg, 'buffer');
                imageBase64 = buffer.toString('base64');
            }

            const aiResponse = await generateResponse(text, context, history, imageBase64);
            let cleanResponse = aiResponse.replace(/SAVE_SALE_TAG:.*?\n/g, '').replace(/STOP_BOT/g, '').trim();

            const sentResponse = await sock.sendMessage(chatId, { text: cleanResponse });
            if (sentResponse && sentResponse.key) botMessageIds.add(sentResponse.key.id);

            history.push({ role: 'user', text: text || '(وسائط)' });
            history.push({ role: 'assistant', text: cleanResponse });
            if (history.length > 40) history.shift();
            chatHistory.set(normalizedId, history);

            await History.findOneAndUpdate({ chatId: normalizedId }, { messages: history, lastUpdate: new Date() }, { upsert: true });
        } catch (err) { }
    });
}

startTelegramPolling(async ({ action, waChatId, data }) => {
    if (action === 'resume') resumeChat(waChatId);
    else if (action === 'stop_bot') isBotStoppedGlobal = true;
    else if (action === 'start_bot') isBotStoppedGlobal = false;
    else if (action === 'payment') {
        await sendMetaEvent('Purchase', { phone: waChatId.split('@')[0] }, { value: 1200, currency: 'DZD', contentName: 'Manual Confirm' });
        if (sock) await sock.sendMessage(waChatId, { text: "🎉 تم تأكيد دفعك!" });
    }
});

startBot();
