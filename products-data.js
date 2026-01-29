export const PRODUCTS_DATA = {
    products: [
        {
            name: "The Real World Account",
            category: "Education & Business",
            keywords: ["andrew tate", "trw", "business", "e-commerce", "trading", "money making", "real time platform"],
            delivery_type: "email_password",
            price_dzd: 2900,
            price_usd: 12,
            description: "دخول رسمي لمنصة The Real World (خطة Veteran Plan) المفعلة منذ ديسمبر 2024. تشمل كل الكورسات والدردشات الحية (ليست فيديوهات مسجلة فقط).",
            durations: []
        },
        {
            name: "ChatGPT Plus",
            category: "AI Chat & Assistant",
            keywords: ["gpt-4", "gpt4", "openai", "writing", "analysis", "ai assistance"],
            delivery_type: "email_password",
            price_dzd: 1000,
            price_usd: 4,
            description: "حساب ChatGPT Plus شخصي خاص بك (إيميل وكلمة سر)",
            durations: [
                { key: "plus", price_dzd: 1000, price_usd: 4 }
            ]
        },
        {
            name: "Adobe Creative Cloud",
            category: "Design & Creative",
            keywords: ["photoshop", "illustrator", "premiere", "design", "video editing", "designer"],
            delivery_type: "email_password",
            price_dzd: 1200,
            price_usd: 4.5,
            description: "اشتراك Adobe Creative Cloud كامل - يدعم جهازين (2 Devices) - (إيميل وكلمة سر)",
            durations: [
                { key: "1month", price_dzd: 1200, price_usd: 4.5 },
                { key: "2months", price_dzd: 1800, price_usd: 7 },
                { key: "3months", price_dzd: 2500, price_usd: 10 }
            ]
        },
        {
            name: "Gamma.AI",
            category: "AI Presentations",
            keywords: ["slides", "presentation", "powerpoint", "ai design"],
            delivery_type: "email_password",
            price_dzd: 1200,
            price_usd: 4.5,
            description: "حساب Gamma.AI للعروض التقديمية (إيميل وكلمة سر)",
            durations: [
                { key: "1month", price_dzd: 1200, price_usd: 4.5 },
                { key: "3months", price_dzd: 2900, price_usd: 11.6 }
            ]
        },
        {
            name: "Perplexity AI Pro",
            category: "AI Search & Research",
            keywords: ["search engine", "research", "citations", "academic"],
            delivery_type: "email_password",
            price_dzd: 1200,
            price_usd: 4.5,
            description: "حساب Perplexity AI Pro (إيميل وكلمة سر)",
            durations: []
        },
        {
            name: "Canva Pro",
            category: "Design & Creative",
            keywords: ["design", "social media", "templates", "easy design"],
            delivery_type: "invite_link",
            price_dzd: 600,
            price_usd: 2.5,
            description: "اشتراك Canva Pro (يرسل الزبون إيميله الشخصي لاستقبال دعوة التفعيل)",
            durations: [
                { key: "standard", price_dzd: 600, price_usd: 2.5 },
                { key: "reseller", price_dzd: 3900, price_usd: 16, delivery_type: "full_access", description: "حساب ريسيلر كامل (3 سنوات) مع إيميل التحكم لتغيير المعلومات، يتيح لك إضافة 500 عضو (500 People)" }
            ]
        },
        {
            name: "CapCut Pro",
            category: "Video Editing",
            keywords: ["video editor", "tiktok", "reels", "ai video"],
            delivery_type: "email_password",
            price_dzd: 800,
            price_usd: 3,
            description: "محرر فيديو احترافي - يدعم جهازين (2 Devices) - (إيميل وكلمة سر)",
            durations: [
                { key: "1month", price_dzd: 800, price_usd: 3 },
                { key: "3months", price_dzd: 1200, price_usd: 4.5 },
                { key: "6months", price_dzd: 2000, price_usd: 8 },
                { key: "1year", price_dzd: 3500, price_usd: 14 }
            ]
        },
        {
            name: "Netflix Premium",
            category: "Streaming & Movies",
            keywords: ["movies", "series", "entertainment", "4k"],
            delivery_type: "email_password",
            price_dzd: 600,
            price_usd: 2.5,
            description: "حساب Netflix Premium مشترك (إيميل وكلمة سر)",
            durations: [
                { key: "1month", price_dzd: 600, price_usd: 2.5 },
                { key: "3months", price_dzd: 1200, price_usd: 4.5 },
                { key: "12months", price_dzd: 2000, price_usd: 8 }
            ]
        },
        {
            name: "TradingView Premium",
            category: "Trading & Finance",
            keywords: ["trading", "charts", "crypto", "forex", "stocks"],
            delivery_type: "email_password",
            price_dzd: 1500,
            price_usd: 6,
            description: "حساب TradingView Premium (إيميل وكلمة سر)",
            durations: []
        },
        {
            name: "Cursor AI",
            category: "AI Coding & Programming",
            keywords: ["coding", "programming", "developer", "vibe coding", "vscode", "ai editor"],
            delivery_type: "email_password",
            price_dzd: 900,
            price_usd: 3.6,
            description: "محرر أكواد ذكي (إيميل وكلمة سر)",
            durations: [
                { key: "7days", price_dzd: 900, price_usd: 3.6 },
                { key: "30days", price_dzd: 3800, price_usd: 15.2 }
            ]
        },
        {
            name: "Lovable AI",
            category: "Vibe Coding & App Building",
            keywords: ["vibe coding", "app builder", "no code", "web app", "ai dev", "full stack"],
            delivery_type: "email_password",
            price_dzd: 1300,
            price_usd: 5.2,
            description: "أداة بناء تطبيقات الويب (إيميل وكلمة سر)",
            durations: [
                { key: "1month", price_dzd: 1300, price_usd: 5.2 },
                { key: "2months", price_dzd: 2200, price_usd: 8.8 },
                { key: "3months", price_dzd: 3000, price_usd: 12 }
            ]
        },
        {
            name: "Prime Video",
            category: "Streaming & Movies",
            keywords: ["amazon movies", "series", "entertainment"],
            delivery_type: "email_password",
            price_dzd: 1200,
            price_usd: 4.5,
            description: "اشتراك Amazon Prime Video مشترك (إيميل وكلمة سر)",
            durations: []
        },
        {
            name: "Crunchyroll",
            category: "Anime",
            keywords: ["anime", "otaku", "japanese series"],
            delivery_type: "email_password",
            price_dzd: 1200,
            price_usd: 4.5,
            description: "اشتراك Crunchyroll Premium (إيميل وكلمة سر)",
            durations: []
        },
        {
            name: "HMA VPN",
            category: "Security & Privacy",
            keywords: ["vpn", "privacy", "ip address", "security"],
            delivery_type: "activation_key",
            price_dzd: 2000,
            price_usd: 8,
            description: "اشتراك HMA VPN (كود تفعيل Activation Key)",
            durations: [
                { key: "1year", price_dzd: 2000, price_usd: 8 },
                { key: "2years", price_dzd: 3200, price_usd: 12.8 }
            ]
        },
        {
            name: "Alight Motion PRO",
            category: "Video Editing & Animation",
            keywords: ["animation", "motion graphics", "video design"],
            delivery_type: "email_password",
            price_dzd: 2500,
            price_usd: 10,
            description: "اشتراك Alight Motion Pro (إيميل وكلمة سر)",
            durations: [
                { key: "1year", price_dzd: 2500, price_usd: 10 }
            ]
        },
        {
            name: "SciSpace Premium",
            category: "AI Research & Academic",
            keywords: ["study", "university", "research paper", "academic assistant"],
            delivery_type: "email_password",
            price_dzd: 1800,
            price_usd: 7.2,
            description: "مساعد بحث علمي (إيميل وكلمة سر)",
            durations: [
                { key: "1month", price_dzd: 1800, price_usd: 7.2 },
                { key: "3months", price_dzd: 3000, price_usd: 12 }
            ]
        }
    ],
    payment_methods: [
        { id: "baridimob", name: "BaridiMob", rip: "00799999002787548473" },
        { id: "usdt", name: "USDT", networks: { trc20: "TWTgY41LNFqZcgBiRCZYsSq6ooeCx8gus9", bep20: "0xa07c3892bd946f61ec736f52dd8ecacb8c2edec0" } },
        { id: "redotpay", name: "RedotPay", id_number: "1117632168" },
        { id: "binance", name: "Binance Pay", pay_id: "527899700" }
    ]
};
