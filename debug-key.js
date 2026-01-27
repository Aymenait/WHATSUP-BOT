import fetch from 'node-fetch';

async function testKey() {
    const key = 'AIzaSyBUDcGDqJtxtUhMpbB9FkcRmg8O_altTWg';
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        console.log('STATUS:', response.status);
        if (data.models) {
            const geminiModels = data.models.filter(m => m.name.includes('gemini')).map(m => m.name);
            console.log('GEMINI MODELS:', geminiModels);
        } else {
            console.log('DATA:', JSON.stringify(data, null, 2));
        }
    } catch (e) {
        console.error('FETCH ERROR:', e);
    }
}

testKey();
