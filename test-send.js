import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox']
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('✅ Connected!');
    const number = '213656165400@c.us'; // The number from logs
    console.log(`Testing send to ${number}...`);
    try {
        await client.sendMessage(number, 'Test direct message from system.');
        console.log('✅ Sent successfully!');
    } catch (e) {
        console.error('❌ Failed:', e.message);
    }
    process.exit();
});

client.initialize();
