import { generateResponse } from './ai-handler.js';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function startChat() {
    console.log('\n=== 🤖 تجربة بوت 3Ahub (Interative Test) ===');
    console.log('--- اكتب رسالتك واضغط Enter (اكتب "exit" للخروج) ---\n');

    // سياق المنتجات (محاكاة لما سيراه البوت)
    const context = `
    - Netflix Premium: 600 DA / 2.5 USD
    - ChatGPT Plus: 1000 DA / 4 USD
    - Canva Pro: 600 DA / 2.5 USD
    - Adobe Creative Cloud: 1500 DA / 8 USD
    - The Real World: 1800 DA / 15 USD
    `;

    const history = [];

    const ask = () => {
        rl.question('👤 أنت: ', async (userInput) => {
            if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
                console.log('\nإلى اللقاء! 👋');
                rl.close();
                return;
            }

            console.log('⏳ البوت يفكر...');
            try {
                // استدعاء دالة الذكاء الاصطناعي
                const response = await generateResponse(userInput, context, history);

                console.log('\n🤖 البوت: ' + response + '\n');

                // تحديث السجل
                history.push({ role: 'user', text: userInput });
                history.push({ role: 'assistant', text: response });
                if (history.length > 10) history.shift();

            } catch (error) {
                console.error('\n❌ خطأ:', error.message);
            }

            ask();
        });
    };

    ask();
}

startChat();
