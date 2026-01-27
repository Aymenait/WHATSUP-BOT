import fetch from 'node-fetch';

async function testOpenRouter() {
    const key = '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';
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${key}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "google/gemini-2.0-flash-exp:free",
                "messages": [{ "role": "user", "content": "Say hello in Algerian Darija" }]
            })
        });
        const data = await response.json();
        console.log('STATUS:', response.status);
        console.log('RESPONSE:', JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('ERROR:', e);
    }
}

testOpenRouter();
