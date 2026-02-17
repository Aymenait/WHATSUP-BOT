import { PRODUCTS_DATA } from './products-data.js';

/**
 * جلب قائمة المنتجات المحدثة (من الملف المحلي مباشرة)
 */
async function fetchCurrentProducts() {
    return PRODUCTS_DATA;
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
