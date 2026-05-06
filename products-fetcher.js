import { db, collection, getDocs, query, where, orderBy } from './firebase-config.js';

/**
 * جلب قائمة المنتجات المحدثة من Firebase Firestore
 */
async function fetchCurrentProducts() {
    try {
        console.log('🔥 Fetching products from Firebase...');

        // Query active products from Firestore (same collection as website)
        const q = query(
            collection(db, 'products_v2'),
            where('isArchived', '==', false)
        );

        const querySnapshot = await getDocs(q);
        const products = [];

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            products.push({
                id: doc.id,
                name: data.name?.ar || data.name || 'منتج',
                category: data.category || 'عام',
                keywords: data.keywords || [],
                description: data.description?.ar || data.description || '',
                price_dzd: data.priceDZD || 0,
                price_usd: data.priceUSD || 0,
                durations: data.durations || [],
                availability: data.availability || 'available',
                delivery_type: data.deliveryType || 'email_password'
            });
        });

        console.log(`✅ Loaded ${products.length} products from Firebase`);

        // Return in same format as before
        return {
            products: products,
            payment_methods: [
                { id: "baridimob", name: "BaridiMob", rip: process.env.BARIDIMOB_RIP || "00799999002787548473" },
                { id: "usdt", name: "USDT", networks: {
                    trc20: process.env.USDT_TRC20 || "TWTgY41LNFqZcgBiRCZYsSq6ooeCx8gus9",
                    bep20: process.env.USDT_BEP20 || "0xa07c3892bd946f61ec736f52dd8ecacb8c2edec0"
                }},
                { id: "redotpay", name: "RedotPay", id_number: process.env.REDOTPAY_ID || "1117632168" },
                { id: "binance", name: "Binance Pay", pay_id: process.env.BINANCE_PAY_ID || "527899700" }
            ]
        };

    } catch (error) {
        console.error('❌ Firebase Error:', error.message);
        console.log('⚠️ Falling back to local products data...');

        // Fallback to local data if Firebase fails
        const { PRODUCTS_DATA } = await import('./products-data.js');
        return PRODUCTS_DATA;
    }
}

/**
 * تنسيق المنتجات بشكل مفصل للـ AI
 */
function formatProductsForAI(data) {
    if (!data || !data.products) return "لا توجد معلومات منتجات.";

    let productsText = "قائمة المنتجات والأسعار المتوفرة عندنا:\n\n";

    data.products.forEach(p => {
        productsText += `📦 المنتج: ${p.name}\n`;
        productsText += `📁 الفئة: ${p.category || 'عام'}\n`;
        productsText += `🔖 كلمات مفتاحية: ${p.keywords ? p.keywords.join(', ') : ''}\n`;
        productsText += `📝 الوصف: ${p.description}\n`;

        if (p.durations && p.durations.length > 0) {
            productsText += `💰 الأسعار المتوفرة لهذا المنتج:\n`;
            p.durations.forEach(d => {
                let durationName = d.key;

                // Map standard keys to readable format
                const durationMap = {
                    '1month': '1 Month',
                    '3months': '3 Months',
                    '6months': '6 Months',
                    '1year': '1 Year',
                    'lifetime': 'Lifetime'
                };

                if (durationMap[d.key]) {
                    durationName = durationMap[d.key];
                } else {
                    durationName = d.key.replace('_', ' ');
                }

                if (d.description) {
                    productsText += `   - ${durationName}: ${d.description} (السعر: ${d.price_dzd} DA / $${d.price_usd} USD)\n`;
                } else {
                    productsText += `   - ${durationName}: السعر ${d.price_dzd} DA / $${d.price_usd} USD\n`;
                }
            });
        } else {
            productsText += `💰 السعر: ${p.price_dzd} DA / $${p.price_usd || 'N/A'} USD\n`;
        }
        productsText += `-------------------\n`;
    });

    productsText += "\n💳 طرق الدفع المتاحة:\n";
    data.payment_methods.forEach(pm => {
        if (pm.id === 'usdt') {
            productsText += `- ${pm.name}:\n`;
            if (pm.networks.trc20) productsText += `  * Network TRC20: ${pm.networks.trc20}\n`;
            if (pm.networks.erc20) productsText += `  * Network ERC20: ${pm.networks.erc20}\n`;
            if (pm.networks.bep20) productsText += `  * Network BEP20: ${pm.networks.bep20}\n`;
        } else if (pm.id === 'binance') {
            productsText += `- ${pm.name}: ID ${pm.pay_id}\n`;
        } else {
            productsText += `- ${pm.name}: ${pm.rip || pm.id_number || ''}\n`;
        }
    });

    return productsText;
}

export { fetchCurrentProducts, formatProductsForAI };
