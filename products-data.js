export const PRODUCTS_DATA = {
    products: [
        {
            name: "The Real World Account",
            price_dzd: 2900,
            description: "حساب مشترك للكورسات ومنصة The Real World",
            durations: []
        },
        {
            name: "ChatGPT Plus",
            price_dzd: 1000,
            description: "حساب ChatGPT Plus للاستخدام المشترك",
            durations: [
                { key: "plus", price_dzd: 1000 },
                { key: "go", price_dzd: 1800 }
            ]
        },
        {
            name: "Adobe Creative Cloud",
            price_dzd: 1200,
            description: "اشتراك Adobe Creative Cloud يشمل أكثر من 20 تطبيقًا احترافيًا",
            durations: [
                { key: "1month", price_dzd: 1200 },
                { key: "2months", price_dzd: 1800 },
                { key: "3months", price_dzd: 2500 }
            ]
        },
        {
            name: "Gamma.AI",
            price_dzd: 1200,
            description: "حساب Gamma.AI للعروض التقديمية",
            durations: [
                { key: "1month", price_dzd: 1200 },
                { key: "3months", price_dzd: 2900 }
            ]
        },
        {
            name: "Perplexity AI Pro",
            price_dzd: 1200,
            description: "حساب Perplexity AI Pro للبحث الذكي",
            durations: []
        },
        {
            name: "Canva Pro",
            price_dzd: 600,
            description: "اشتراك Canva Pro الكامل مع جميع المميزات الاحترافية للتصميم والإبداع (سنة كاملة).",
            durations: [
                { key: "standard", price_dzd: 600 },
                { key: "reseller", price_dzd: 3900 }
            ]
        },
        {
            name: "CapCut Pro",
            price_dzd: 800,
            description: "محرر فيديو احترافي مع مميزات الذكاء الاصطناعي - 30 يوم",
            durations: [
                { key: "1month", price_dzd: 800 },
                { key: "3months", price_dzd: 1200 },
                { key: "6months", price_dzd: 2000 },
                { key: "1year", price_dzd: 3500 }
            ]
        },
        {
            name: "Netflix Premium",
            price_dzd: 600,
            description: "حساب Netflix Premium مشترك",
            durations: [
                { key: "1month", price_dzd: 600 },
                { key: "3months", price_dzd: 1200 },
                { key: "12months", price_dzd: 2000 }
            ]
        },
        {
            name: "TradingView Premium",
            price_dzd: 1500,
            description: "حساب TradingView Premium للتحليل المالي",
            durations: []
        },
        {
            name: "Cursor AI",
            price_dzd: 900,
            description: "محرر أكواد ذكي بالذكاء الاصطناعي (حساب خاص متوفر)",
            durations: [
                { key: "7days", price_dzd: 900 },
                { key: "30days", price_dzd: 3800 }
            ]
        },
        {
            name: "Lovable AI",
            price_dzd: 1300,
            description: "أداة متقدمة لبناء تطبيقات الويب بالذكاء الاصطناعي",
            durations: [
                { key: "1month", price_dzd: 1300 },
                { key: "2months", price_dzd: 2200 },
                { key: "3months", price_dzd: 3000 }
            ]
        },
        {
            name: "Prime Video",
            price_dzd: 1200,
            description: "اشتراك Amazon Prime Video لمدة 3 أشهر",
            durations: []
        },
        {
            name: "Crunchyroll",
            price_dzd: 1200,
            description: "اشتراك Crunchyroll Premium لمدة شهر واحد",
            durations: []
        },
        {
            name: "HMA VPN",
            price_dzd: 2000,
            description: "اشتراك HMA VPN مع وصول لكافة الخوادم.",
            durations: [
                { key: "1year", price_dzd: 2000 },
                { key: "2years", price_dzd: 3200 }
            ]
        },
        {
            name: "Alight Motion PRO",
            price_dzd: 2500,
            description: "اشتراك Alight Motion Pro لمدة سنة كاملة لتصميم الفيديو باحترافية.",
            durations: [
                { key: "1year", price_dzd: 2500 }
            ]
        }
    ],
    payment_methods: [
        { id: "baridimob", name: "BaridiMob", rip: "00799999002787548473" },
        { id: "usdt", name: "USDT", networks: { trc20: "TWTgY41LNFqZcgBiRCZYsSq6ooeCx8gus9" } },
        { id: "redotpay", name: "RedotPay", id_number: "1117632168" }
    ]
};
