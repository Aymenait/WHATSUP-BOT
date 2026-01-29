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
                // d.key هو المدة (مثلا: 1_month, 12_months)
                let durationName = d.key.replace('_', ' ');

                // تصحيح المدد للـ ChatGPT والخطط الأخرى التي ليس لها اسم مدة واضح
                if (d.key === 'plus' || d.key === 'go') {
                    durationName += ' (مدة شهر واحد - 1 Month)';
                } else if (d.key === 'teachers') {
                    durationName += ' (مدة سنة كاملة - 1 Year)';
                }

                productsText += `   - ${durationName}: السعر ${d.price_dzd} DA / $${d.price_usd} USD\n`;
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
