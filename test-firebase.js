import { fetchCurrentProducts, formatProductsForAI } from './products-fetcher.js';

console.log('🧪 Testing Firebase connection...\n');

try {
    const data = await fetchCurrentProducts();

    console.log(`\n✅ Success! Loaded ${data.products.length} products from Firebase\n`);

    console.log('📦 Sample products:');
    data.products.slice(0, 3).forEach(p => {
        console.log(`  - ${p.name} (${p.category})`);
        console.log(`    Price: ${p.price_dzd} DA / $${p.price_usd} USD`);
        if (p.durations && p.durations.length > 0) {
            console.log(`    Durations: ${p.durations.length} options`);
        }
    });

    console.log('\n💳 Payment methods:');
    data.payment_methods.forEach(pm => {
        console.log(`  - ${pm.name}`);
    });

    console.log('\n📝 AI-formatted preview (first 500 chars):');
    const aiText = formatProductsForAI(data);
    console.log(aiText.substring(0, 500) + '...\n');

    console.log('✅ Firebase connection test PASSED!');

} catch (error) {
    console.error('\n❌ Firebase connection test FAILED!');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
}
