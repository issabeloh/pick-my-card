// Global variables
let currentUser = null;
let userSelectedCards = new Set(); // Store user's selected card IDs
let auth = null;
let db = null;
let cardsData = null;

// Embedded cards data to avoid CORS issues
cardsData = {
  "cards": [
    {
      "id": "taishin-richart",
      "name": "å°æ–°Richartå¡",
      "fullName": "å°æ–°éŠ€è¡ŒRichartä¿¡ç”¨å¡",
      "basicCashback": 0.3,
      "annualFee": "æ­£å¡æ¯å¡å¹´NT$1,500ã€é™„å¡æ¯å¡æ¯å¹´NT$750",
      "feeWaiver": "é¦–å¹´å…å¹´è²»ï¼Œæ¬¡å¹´èµ·ä½¿ç”¨å°æ–°é›»å­/è¡Œå‹•ç°¡è¨Šå¸³å–®ä¸”ç”Ÿæ•ˆï¼Œäº«å…å¹´è²»å„ªæƒ ",
      "website": "https://www.taishinbank.com.tw/TSB/personal/credit/intro/overview/cg047/card001/",
      "cashbackRates": [
        {
          "rate": 3.8,
          "cap": 480000,
          "items": ["å°ç£Payå ´åŸŸ", "è¶…å•†ï¼ˆå–®ç­†é™é¡æœ€é«˜ NT3,000å…ƒï¼Œä¸”ä¸å«ä»£æ”¶æ°´é›»ç¨…è²»/ç¦®ç‰©å¡/å„²å€¼ï¼‰"]
        },
        {
          "rate": 3.3,
          "cap": 480000,
          "items": [
            "è¯èˆª", "é•·æ¦®", "æ˜Ÿå®‡", "è™Žèˆª", "åœ‹æ³°èˆªç©º", "è¯ä¿¡", "ç«‹æ¦®", "klook", "kkday", "airsim", "agoda", "booking.com", "trip.com", "airbnb", "hotels.com", "expedia", "é›„ç…æ—…éŠ", "æ˜“éŠç¶²", "æ±å—æ—…éŠ", "æµ·å¤–å¯¦é«”", "æµ·å¤–ç·šä¸Š", "è¦çš®", "momo", "é…·æ¾Ž", "coupang", "pchome", "yahoo", "amazon", "æ±æ£®", "åšå®¢ä¾†", "richart mart", "hahow", "pressplay", "amazing talker", "udemy", "kobo", "readmoo", "uniqlo", "gu", "zara", "net", "lativ", "gap", "uber eats", "foodpanda", "ä¸­æ²¹ç›´ç‡Ÿ", "å°äºžç›´ç‡Ÿ", "å…¨åœ‹åŠ æ²¹", "æºé»ževoasis", "è¯åŸŽé›»èƒ½evalue", "æ‹“å…ƒå”®ç¥¨", "kktix", "å¹´ä»£å”®ç¥¨", "å¯¬å®å”®ç¥¨", "opentixå…©å»³é™¢æ–‡åŒ–ç”Ÿæ´»", "æ™¶è¯åœ‹éš›é…’åº—é›†åœ˜", "å°ç£è¬è±ªåœ‹éš›é›†åœ˜æ——ä¸‹é£¯åº—", "ç…™æ³¢é£¯åº—", "è€çˆºé…’åº—é›†åœ˜", "ç¦è¯é›†åœ˜", "æ¼¢ä¾†é£¯åº—äº‹æ¥­ç¾¤", "å°åŒ—å›æ‚…é…’åº—", "é«˜é›„æ´²éš›é…’åº—", "ç¤æºªå¯’æ²", "ç¾©å¤§éŠæ¨‚ä¸–ç•Œ", "éº—å¯¶æ¨‚åœ’", "å…­ç¦æ‘ä¸»é¡ŒéŠæ¨‚åœ’", "ä¹æ—æ–‡åŒ–æ‘", "åŠæ¹–å±±ä¸–ç•Œä¸»é¡ŒéŠæ¨‚åœ’", "x-park", "åœ‹ç«‹æµ·æ´‹ç”Ÿç‰©åšç‰©é¤¨", "é é›„æµ·æ´‹å…¬åœ’", "å¤§é­¯é–£", "å°äººåœ‹ä¸»é¡Œæ¨‚åœ’", "å…¨å°é¤é£²æ–°å…‰ä¸‰è¶Š", "é æ±sogo", "å»£ä¸‰sogo", "é æ±ç™¾è²¨", "å¾®é¢¨", "å°åŒ—101", "é æ±å·¨åŸŽ", "å—ç´¡è³¼ç‰©ä¸­å¿ƒ", "æ¼¢ç¥žç™¾è²¨", "æ¼¢ç¥žå·¨è›‹", "èª å“ç”Ÿæ´»", "mitsui shopping park", "lalaport", "mitsui outlet park", "è¯æ³°åå“åŸŽ", "skm park outlets", "ikea", "ç‰¹åŠ›å±‹", "hola", "å®œå¾—åˆ©", "ç‘ªé»‘å®¶å±…", "7-11", "å…¨å®¶", "å®¶æ¨‚ç¦", "å¤§è²·å®¶", "è‡ºéµ", "é«˜éµ", "å°ç£å¤§è»ŠéšŠ", "linego", "yoxi", "uber", "å˜Ÿå˜Ÿæˆ¿", "autopass", "åŸŽå¸‚è»Šæ—…", "vivipark", "uspace", "udrive", "irent", "å’Œé‹ç§Ÿè»Š", "æ ¼ä¸Šç§Ÿè»Š"
          ]
        }
      ]
    },
    {
      "id": "yushan-unicard",
      "name": "çŽ‰å±±Uniå¡",
      "fullName": "çŽ‰å±±éŠ€è¡ŒUniCardä¿¡ç”¨å¡",
      "basicCashback": 1.0,
      "annualFee": "å¾¡ç’½å¡NT$3,000",
      "feeWaiver": "é¦–å¹´å…å¹´è²»ï¼Œæ¯å¹´æœ‰æ¶ˆè²»å¹´å¹´å…å¹´è²»ï¼Œæˆ–ä½¿ç”¨çŽ‰å±±å¸³æˆ¶è‡ªå‹•æ‰£ç¹³ä¿¡ç”¨å¡æ¬¾æˆ–å¸³å–®eåŒ–æœŸé–“äº«å…å¹´è²»å„ªæƒ ",
      "website": "https://www.esunbank.com/zh-tw/personal/credit-card/intro/bank-card/unicard",
      "cashbackRates": [
        {
          "rate": 3.5,
          "cap": 20000,
          "items": [
            "linepay", "è¡—å£", "æ‚ éŠä»˜", "å…¨ç›ˆæ”¯ä»˜", "å…¨æ”¯ä»˜", "æ©˜å­æ”¯ä»˜", "momoè³¼ç‰©ç¶²", "è¦çš®è³¼ç‰©", "æ·˜å¯¶", "coupang", "æ±æ£®è³¼ç‰©", "åšå®¢ä¾†", "æ–°å…‰ä¸‰è¶Š", "å°åŒ—101", "è¯æ³°åå“åŸŽ", "ä¸‰äº•outlet", "äº¬ç«™", "ç¾Žéº—è¯", "ç§€æ³°ç”Ÿæ´»", "lalaport", "çµ±é ˜å»£å ´", "é‡‡ç›Ÿ", "æ˜‡æ†æ˜Œ", "å¤ªå¹³æ´‹ç™¾è²¨", "çµ±ä¸€æ™‚ä»£ç™¾è²¨", "é æ±ç™¾è²¨", "é æ±sogo", "é æ±å·¨åŸŽ", "å¤§é ç™¾", "æ¼¢ç¥žç™¾è²¨", "å¾®é¢¨å»£å ´", "å¾®é¢¨ä¿¡ç¾©", "å¾®é¢¨å—äº¬", "å¾®é¢¨å—å±±", "å¾®é¢¨å°åŒ—è»Šç«™", "èª å“ç”Ÿæ´»", "èª å“ç·šä¸Š", "èª å“æ›¸åº—", "å®¶æ¨‚ç¦", "å±ˆè‡£æ°", "ç‰¹åŠ›å±‹", "hola", "hoiå¥½å¥½ç”Ÿæ´»", "uniqlo", "net", "å¤§æ¨¹è—¥å±€", "ä¸ä¸è—¥å¦", "uber eats", "ubereats", "foodpanda", "eztable", "çŽ‹å“ç˜‹ç¾Žé£Ÿ", "æ‘©æ–¯", "è·¯æ˜“èŽŽ", "é¥—é£Ÿå¤©å ‚", "æžœç„¶åŒ¯", "åŠ é›†", "é–‹é£¯", "éŸ¿æ³°å¤š", "çœŸç ", "ç“¦åŸŽ", "éžå¸¸æ³°", "æ™‚æ™‚é¦™", "1010æ¹˜", "å¤§å¿ƒ", "ä¹¾æ¯ç‡’è‚‰å±…é…’å±‹", "è€ä¹¾æ¯", "æ¼¢ä¾†æµ·æ¸¯", "å³¶èªž", "æ¼¢ä¾†è”¬é£Ÿ", "æ¼¢ä¾†åäººåŠ", "æ±æ–¹æ¨“", "æ¼¢ä¾†ä¸Šæµ·æ¹¯åŒ…", "æºœæºœé…¸èœ", "é­šå°ˆè³£åº—", "ä¸Šèœç‰‡çš®é´¨", "ç¿ åœ’", "æ¼¢ä¾†è»’", "ç„°", "pavo", "ç²¾ç€²æµ·é®®ç«é‹", "æ—¥æœ¬æ–™ç†å¼æ…¶", "ç¦åœ’å°èœæµ·é®®", "æ—¥æ—¥çƒ˜ç„™åŠ", "ç³•é¤…å°èˆ–", "å°åŒ—æ¼¢ä¾†å¤§å»³é…’å»Š", "hi lai cafe", "å°ç£ä¸­æ²¹", "å°ç£å¤§è»ŠéšŠ", "å°éµ", "é«˜éµ", "yoxi", "æ¡ƒåœ’æ©Ÿå ´æ·é‹", "ä¸­è¯èˆªç©º", "é•·æ¦®èˆªç©º", "æ—¥æœ¬èˆªç©º", "å°ç£è™Žèˆª", "æ¨‚æ¡ƒèˆªç©º", "é…·èˆª", "ç«‹æ¦®èˆªç©º", "è¯ä¿¡èˆªç©º", "trip.com", "booking.com", "hotels.com", "asiayo", "expedia", "kkday", "klook", "é›„ç…æ—…", "å¯æ¨‚æ—…", "æ±å—æ—…è¡Œç¤¾", "appleç›´ç‡Ÿ", "å°ç±³å°ç£", "å…¨åœ‹é›»å­", "ç‡¦å¤", "è¿ªå¡å„‚", "å¯µç‰©å…¬åœ’", "youbike 2.0"
          ]
        }
      ]
    },
    {
      "id": "cathay-cube",
      "name": "åœ‹æ³°CUBEå¡",
      "fullName": "åœ‹æ³°ä¸–è¯CUBEä¿¡ç”¨å¡",
      "basicCashback": 0.3,
      "annualFee": "é¦–å¹´å…å¹´è²»ï¼Œæ¬¡å¹´èµ·å¹´è²»NT$1,800",
      "feeWaiver": "ç”³è¾¦é›»å­å¸³å–®ã€å‰å¹´åº¦æ¶ˆè²»12æ¬¡ã€å‰ä¸€å¹´ç´¯ç©æ¶ˆè²»é”18è¬(ä¸‰æ“‡ä¸€)å³å¯æ¸›å…å¹´è²»",
      "website": "https://www.cathay-cube.com.tw/cathaybk/personal/product/credit-card/cards/cube",
      "hasLevels": true,
      "levelSettings": {
        "level1": {
          "specialRate": 2.0,
          "generalRate": 2.0
        },
        "level2": {
          "specialRate": 3.0,
          "generalRate": 2.0
        },
        "level3": {
          "specialRate": 3.3,
          "generalRate": 2.0
        }
      },
      "specialItems": [
        "chatgpt", "canva", "claude", "cursor", "duolingo", "gamma", "gemini", "notion", "perplexity", "speak", "apple åª’é«”æœå‹™", "google play", "disney+", "netflix", "spotify", "kkbox", "youtube premium", "max", "è¦çš®è³¼ç‰©", "momoè³¼ç‰©ç¶²", "pchome 24hè³¼ç‰©", "å°æ¨¹è³¼", "coupang é…·æ¾Ž", "æ·˜å¯¶/å¤©è²“", "é æ±sogoç™¾è²¨", "é æ±garden city", "å¤ªå¹³æ´‹ç™¾è²¨", "æ–°å…‰ä¸‰è¶Š", "skm park", "bellavita", "å¾®é¢¨å»£å ´", "é æ±ç™¾è²¨", "big cityé æ±å·¨åŸŽè³¼ç‰©ä¸­å¿ƒ", "èª å“ç”Ÿæ´»", "ç’°çƒè³¼ç‰©ä¸­å¿ƒ", "citylink", "çµ±ä¸€æ™‚ä»£å°åŒ—åº—", "å°åŒ—101", "att 4 fun", "æ˜Žæ›œç™¾è²¨", "äº¬ç«™", "ç¾Žéº—è¯", "å¤§è‘‰é«˜å³¶å±‹", "æ¯”æ¼¾å»£å ´", "å¤§æ±Ÿåœ‹éš›è³¼ç‰©ä¸­å¿ƒ", "ä¸­å‹ç™¾è²¨", "å»£ä¸‰sogo", "tiger city", "å‹¤ç¾Žèª å“ç¶ åœ’é“", "å¤§é­¯é–£æ–°æ™‚ä»£", "è€æ–¯å»£å ´", "å—ç´¡è³¼ç‰©ä¸­å¿ƒ", "å¤¢æ™‚ä»£", "æ¼¢ç¥žç™¾è²¨", "æ¼¢ç¥žå·¨è›‹", "mitsui outlet park", "mitsui shopping park lalaport", "ç¾©å¤§ä¸–ç•Œè³¼ç‰©å»£å ´", "è¯æ³°åå“åŸŽ", "ç¾©äº«å¤©åœ°", "éº—å¯¶outlet mall", "ç§€æ³°ç”Ÿæ´»", "å°èŒ‚è³¼ç‰©ä¸­å¿ƒ", "æ–°æœˆå»£å ´", "ä¸‰å‰µç”Ÿæ´»", "å®åŒ¯å»£å ´", "nokeå¿ æ³°æ¨‚ç”Ÿæ´»", "uber eats", "foodpanda", "åœ‹å…§é¤é£²", "éº¥ç•¶å‹ž", "åº·æ˜¯ç¾Ž", "å±ˆè‡£æ°", "å¤§é˜ªè¬åœ‹åšè¦½æœƒå®˜ç¶²", "surutto qrttoå®˜ç¶²", "å¤§é˜ªç¾Žé£Ÿexpo", "æµ·å¤–å¯¦é«”æ¶ˆè²»", "æ±äº¬è¿ªå£«å°¼æ¨‚åœ’", "æ±äº¬è¯ç´å…„å¼Ÿå“ˆåˆ©æ³¢ç‰¹å½±åŸŽ", "å¤§é˜ªç’°çƒå½±åŸŽ", "appleéŒ¢åŒ…æŒ‡å®šäº¤é€šå¡", "uber", "grab", "å°ç£é«˜éµ", "yoxi", "å°ç£å¤§è»ŠéšŠ", "irent", "å’Œé‹ç§Ÿè»Š", "æ ¼ä¸Šç§Ÿè»Š", "ä¸­è¯èˆªç©º", "é•·æ¦®èˆªç©º", "æ˜Ÿå®‡èˆªç©º", "å°ç£è™Žèˆª", "åœ‹æ³°èˆªç©º", "æ¨‚æ¡ƒèˆªç©º", "é˜¿è¯é…‹èˆªç©º", "é…·èˆª", "æ•æ˜Ÿèˆªç©º", "æ—¥æœ¬èˆªç©º", "anaå…¨æ—¥ç©º", "äºžæ´²èˆªç©º", "è¯åˆèˆªç©º", "æ–°åŠ å¡èˆªç©º", "è¶Šæ·èˆªç©º", "å¤§éŸ“èˆªç©º", "é”ç¾Žèˆªç©º", "åœŸè€³å…¶èˆªç©º", "å¡é”èˆªç©º", "æ³•åœ‹èˆªç©º", "æ˜Ÿé‡Žé›†åœ˜", "å…¨çƒè¿ªå£«å°¼é£¯åº—", "æ±æ©« inn", "åœ‹å…§é£¯åº—ä½å®¿", "kkday", "agoda", "klook", "airbnb", "booking.com", "trip.com", "eztravelæ˜“éŠç¶²", "é›„ç…æ—…éŠ", "å¯æ¨‚æ—…éŠ", "æ±å—æ—…éŠ", "äº”ç¦æ—…éŠ", "ç‡¦æ˜Ÿæ—…éŠ", "å±±å¯Œæ—…éŠ", "é•·æ±Žå‡æœŸ", "é³³å‡°æ—…è¡Œç¤¾", "ezflyæ˜“é£›ç¶²", "ç†æƒ³æ—…éŠ", "æ°¸åˆ©æ—…è¡Œç¤¾", "ä¸‰è³€æ—…è¡Œç¤¾", "å®¶æ¨‚ç¦", "lopiaå°ç£", "å…¨è¯ç¦åˆ©ä¸­å¿ƒ", "å°ç£ä¸­æ²¹ç›´ç‡Ÿç«™", "7-11", "å…¨å®¶", "ikea", "linepay"
      ],
      "cashbackRates": [
        {
          "rate": 2.0,
          "cap": null,
          "category": "集精選",
          "items": [
            "家樂福", "lopia台灣", "全聯福利中心", "台灣中油直營站", "7-11", "全家", "ikea"
          ]
        },
        {
          "rate": 2.0,
          "cap": null,
          "category": "來支付",
          "items": [
            "linepay"
          ]
        },
        {
          "rate": 10.0,
          "cap": null,
          "category": "童樂匯",
          "period": "2025/8/1-2025/11/20",
          "conditions": "每月20日(含)前客戶須符合以下2項條件，次月1日起可切換至童樂匯。條件一：客戶與其未成年子女須持有本行帳戶。條件二：客戶須持有有效CUBE信用卡正卡。",
          "items": [
            "大樹先生的家", "Money Jump 媽你講親子餐廳", "淘憩時光親子餐廳", "大房子親子餐廳樂園", "小島3.5度親子餐廳", "咱們小時候", "甲蟲秘境", "Zone Cafe 弄咖啡親子餐廳", "10mois台灣官網", "Mamas&Papas台灣官網", "Nuna品牌官網", "Tender Leaf台灣官網", "cybex台灣官網", "朱宗慶打擊樂教學系統", "雲門舞集舞蹈教室", "Yamaha音樂教室", "TutorABC Junior", "Cambly Kids", "Etalking Kids", "iSKI滑雪俱樂部", "汐遊寶寶", "國立臺灣科學教育館"
          ]
        },
        {
          "rate": 5.0,
          "cap": null,
          "category": "童樂匯",
          "period": "2025/8/1-2025/11/20",
          "conditions": "每月20日(含)前客戶須符合以下2項條件，次月1日起可切換至童樂匯。條件一：客戶與其未成年子女須持有本行帳戶。條件二：客戶須持有有效CUBE信用卡正卡。",
          "items": [
            "klook", "東京迪士尼樂園", "大阪環球影城", "麗寶樂園", "六福村主題樂園", "九族文化村", "劍湖山世界主題遊樂園", "義大遊樂世界", "小叮當科學園區主題樂園", "蘭城晶英酒店", "礁溪寒沐酒店", "大溪笠復威斯汀度假酒店", "煙波大飯店新竹湖濱館", "麗寶福容大飯店", "雲品溫泉酒店", "和逸飯店(台南西門館、桃園館)", "義大皇家酒店", "高雄洲際酒店", "高雄萬豪酒店", "增丁凱撒大飯店", "花蓮遠雄悅來大飯店", "瑞穗天合國際觀光酒店", "六福莊", "卡多摩嬰童館", "營養銀行", "安琦兒婦嬰百貨", "宜兒樂", "麗兒采家", "Taobaby濤寶日記", "媽媽好", "媽媽餵mamaway", "俏媽咪"
          ]
        },
        {
          "rate": 10.0,
          "cap": null,
          "category": "慶生月",
          "period": "2025/7/1-2025/9/30",
          "conditions": "需為用戶生日月份",
          "items": [
            "Onitsuka Tiger 鬼塚虎台灣官網", "東京迪士尼樂園", "大阪環球影城", "肌膚之鑽台灣官網", "Samsonite 台灣官網", "American Tourister 台灣官網", "creammm.t", "某某法式甘點", "CJSJ", "紅葉蛋糕指定網站", "畜室法式巧克力", "貓吃魚", "昭日堂燒肉", "昭日堂鍋煮", "匠屋燒肉 朝馬館", "匠屋明義本店", "Wagyu Club和牛俱樂部", "Amber Hill", "D&C Residence", "高雄Capstone Steakhouse", "路易奇電力公司Bulimia溫體牛火鍋", "山上走走日式無菜單海鮮鍋物", "山上走走燒肉專賣店", "UNCLE SHAWN 燒肉餐酒館", "大股熟成燒肉", "秘町炭火燒肉", "錢櫃KTV", "好樂辪KTV", "星聚點KTV", "享溫馨KTV", "PlayStation", "Nintendo", "巴哈姆特動畫瘋"
          ]
        },
        {
          "rate": 3.5,
          "cap": null,
          "category": "慶生月",
          "period": "2025/7/1-2025/9/30",
          "conditions": "需為用戶生日月份",
          "items": [
            "新光三越", "klook", "funnow", "uber eats"
          ]
        }
      ],
      "couponCashbacks": [
        {
          "merchant": "å¤§ä¸¸ç¦å²¡å¤©ç¥žåº—",
          "rate": 4.5,
          "conditions": "éœ€é€éŽCUBE Appé ˜å–å„ªæƒ åˆ¸",
          "period": "2025/07/01-2025/12/31"
        },
        {
          "merchant": "MITSUIæœ¨æ›´æ´¥æ¸¯é«˜è‡º",
          "rate": 6.3,
          "conditions": "éœ€é€éŽCUBE Appé ˜å–å„ªæƒ åˆ¸",
          "period": "2025/07/07-2025/10/31"
        },
        {
          "merchant": "æ˜Ÿå·´å…‹ç·šä¸Š/è‡ªå‹•å„²å€¼",
          "rate": 8.0,
          "conditions": "éœ€é€éŽCUBE Appé ˜å–å„ªæƒ åˆ¸",
          "period": "2025/07/01-2025/12/31"
        },
        {
          "merchant": "æ˜‡æ†æ˜Œ",
          "rate": 3.0,
          "conditions": "éœ€é€éŽCUBE Appé ˜å–å„ªæƒ åˆ¸ï¼Œå–®ç­†æ¶ˆè²»æ»¿NT$300",
          "period": "2025/09/17-2025/12/31"
        },
        {
          "merchant": "å°åŒ—å’Œé€¸é£¯åº—",
          "rate": 8.0,
          "conditions": "éœ€é€éŽCUBE Appé ˜å–å„ªæƒ åˆ¸",
          "period": "2025/04/01-2025/09/30"
        },
        {
          "merchant": "å¤§æ¨¹è—¥å±€",
          "rate": 5.0,
          "conditions": "éœ€é€éŽCUBE Appé ˜å–å„ªæƒ åˆ¸",
          "period": "2025/09/01-2025/09/30"
        },
        {
          "merchant": "è˜‡è»’é£¯åº—",
          "rate": 11.0,
          "conditions": "éœ€é€éŽCUBE Appé ˜å–å„ªæƒ åˆ¸",
          "period": "2025/04/01-2025/09/30"
        },
        {
          "merchant": "å…¨çƒé€£æµè»Š",
          "rate": 3.8,
          "conditions": "éœ€é€éŽCUBE Appé ˜å–å„ªæƒ åˆ¸",
          "period": "2025/01/01-2025/12/31"
        },
        {
          "merchant": "æ¡ƒåœ’æ·é‹æ©Ÿå ´",
          "rate": 5.0,
          "conditions": "éœ€é€éŽCUBE Appé ˜å–å„ªæƒ åˆ¸",
          "period": "2025/07/01-2025/09/30"
        },
        {
          "merchant": "Hotels.com",
          "rate": 5.0,
          "conditions": "éœ€é€éŽCUBE Appé ˜å–å„ªæƒ åˆ¸",
          "period": "2025/03/15-2025/12/31"
        },
        {
          "merchant": "Expedia",
          "rate": 5.0,
          "conditions": "éœ€é€éŽCUBE Appé ˜å–å„ªæƒ åˆ¸",
          "period": "2024/08/31-2025/12/31"
        },
        {
          "merchant": "å±ˆè‡£æ°å®˜æ–¹ç¶²è·¯å•†åº—",
          "rate": 2.0,
          "conditions": "éœ€é€éŽCUBE Appé ˜å–å„ªæƒ åˆ¸ï¼Œéœ€è¨»å†Š",
          "period": "2025/07/01-2025/12/31"
        },
        {
          "merchant": "éŸ“åœ‹å¯¦é«”æ¶ˆè²»",
          "rate": 5.0,
          "conditions": "éœ€é€éŽCUBE Appé ˜å–å„ªæƒ åˆ¸ï¼Œå¯¦é«”NT$50,000æˆ–ç¶²è·¯NT$2,000æ¶ˆè²»é–€æª»",
          "period": "2025/09/17-2025/12/31"
        },
        {
          "merchant": "CASETIFYå°ç£å®˜ç¶²",
          "rate": 3.5,
          "conditions": "éœ€é€éŽCUBE Appé ˜å–å„ªæƒ åˆ¸",
          "period": "2025/09/11-2025/11/30"
        }
      ]
    },
    {
      "id": "sinopac-sport",
      "name": "æ°¸è±Sportå¡",
      "fullName": "æ°¸è±éŠ€è¡ŒSportä¿¡ç”¨å¡",
      "basicCashback": 1.0,
      "basicConditions": "æ±—æ°´ä¸ç™½æµAPPæœ‰é‹å‹•æ•¸æ“š",
      "annualFee": "é¦–å¹´å…å¹´è²»ï¼Œæ¬¡å¹´èµ·å¹´è²»NT$3,000",
      "feeWaiver": "ç”³è«‹ä¿¡ç”¨å¡é›»å­åŒ–å¸³å–®ï¼ˆé›»å­å¸³å–®/è¡Œå‹•å¸³å–®ï¼‰ä¸”å–æ¶ˆå¯¦é«”å¸³å–®ï¼Œæˆ–(é‘½é‡‘å¡Visa/Mastercard)å‰ä¸€å¹´åˆ·æ»¿3.6è¬å…ƒæˆ–12ç­†æ¶ˆè²»ï¼›(å¾¡ç’½å¡Titanium/Signature)å‰ä¸€å¹´åˆ·æ»¿12è¬å…ƒæˆ–12ç­†æ¶ˆè²»",
      "website": "https://bank.sinopac.com/sinopacBT/personal/credit-card/introduction/bankcard/sportcard.html",
      "cashbackRates": [
        {
          "rate": 1.0,
          "cap": 5000,
          "period": "2025/07/01-2025/12/31",
          "conditions": "ç•¶æœˆAPPæ•¸æ“šé”10,000æ‰“å¡æˆ–Apple Watchåœ“æ»¿åŠƒåœˆï¼‘ï¼æ¬¡ï¼Œä¸¦è¨­å®šæ°¸è±å¸³æˆ¶è‡ªå‹•æ‰£ç¹³ä¿¡ç”¨å¡å¸³æ¬¾",
          "items": [
            "ä¸€èˆ¬æ¶ˆè²»"
          ]
        },
        {
          "rate": 4.0,
          "cap": 7500,
          "period": "2025/07/01-2025/12/31",
          "conditions": "ç•¶æœˆAPPæ•¸æ“šé”10,000æ‰“å¡æˆ–Apple Watchåœ“æ»¿åŠƒåœˆï¼‘ï¼æ¬¡ï¼Œä¸¦è¨­å®šæ°¸è±å¸³æˆ¶è‡ªå‹•æ‰£ç¹³ä¿¡ç”¨å¡å¸³æ¬¾",
          "items": [
            "world gym", "å¥èº«å·¥å» ", "true yoga", "curves", "é‹å‹•ä¸­å¿ƒ", "anytime fitness", "å±ˆè‡£æ°", "åº·æ˜¯ç¾Ž", "å¯¶é›…", "å¥½å¿ƒè‚", "æä¸€", "å¤§æ¨¹è—¥å±€", "ä¸ä¸è—¥å±€", "æ–°é«˜æ©‹è—¥å±€", "app store", "google play", "nintendo", "playstation", "steam", "apple pay", "google pay", "samsung pay", "garmin pay"
          ]
        }
      ]
    },
    {
      "id": "sinopac-green",
      "name": "æ°¸è±Greenå¡",
      "fullName": "æ°¸è±éŠ€è¡ŒGreenä¿¡ç”¨å¡",
      "basicCashback": 1.0,
      "annualFee": "é¦–å¹´å…å¹´è²»ï¼Œæ¬¡å¹´èµ·å¹´è²»NT$3,000",
      "feeWaiver": "ç”³è«‹é›»å­å¸³å–®æˆ–å‰ä¸€å¹´åˆ·æ»¿15è¬å…ƒæˆ–12ç­†æ¶ˆè²»",
      "website": "https://bank.sinopac.com/sinopacBT/personal/credit-card/introduction/bankcard/cashcard.html",
      "cashbackRates": [
        {
          "rate": 5.0,
          "cap": 7500,
          "items": [
            "æ‚ éŠå¡è‡ªå‹•åŠ å€¼", "æ„›è²·", "å®¶æ¨‚ç¦", "å¤§æ½¤ç™¼", "uniqlo", "h&m", "zara", "gu", "gap", "net", "æ–°å…‰å½±åŸŽ", "å¨ç§€", "å–œæ¨‚æ™‚ä»£", "è—å£½å¸", "mos", "ç¯‰é–“", "ç¾©ç¾Žé£Ÿå“", "é¦¬å¯å…ˆç”Ÿ", "å¯¬å¿ƒåœ’", "miacucina", "å°å°æ¨¹é£Ÿ", "é™½æ˜Žæ˜¥å¤©", "å±‹é¦¬", "ç†±æµªå³¶", "è‰è•²å®´", "åŽŸç´ é£Ÿåºœ", "herbivore", "å°åº¦è•²é£Ÿ", "é¤Šå¿ƒèŒ¶æ¨“", "å±±æµ·æ¨“", "qburger", "éº¥å‘³ç™»", "ä¸€ä¹‹è»’", "æ·çµ²æ—…", "æ‰¿å„„", "ç…™æ³¢", "ç¿°å“", "å¸Œçˆ¾é “", "åœ‹è³“", "ç¦å®¹", "æ–°é©›", "åœ“å±±", "åŸŽå¸‚å•†æ—…", "å‡±è–©", "è€çˆº", "kktix", "æ‹“å…ƒå”®ç¥¨", "å…¨åœ‹é›»å­", "studioa", "straighta", "o'right", "aesop", "10/10 hope", "ä¸»å©¦è¯ç›Ÿ", "é‡Œä»", "æ£‰èŠ±ç”°", "è–å¾·ç§‘æ–¯", "ç¾©ç¾Žç”Ÿæ©Ÿ", "çµ±ä¸€ç”Ÿæ©Ÿ", "ç¶ è—¤ç”Ÿæ©Ÿ", "èŒ¶ç±½å ‚", "è‰¾ç‘ªçµ²", "é•·åº·ç”ŸæŠ€", "ç‡Ÿé¤Šå¸«è¼•é£Ÿ", "å®‰æ°¸é®®ç‰©", "é‡Žèœæ‘", "ç„¡æ¯’çš„å®¶", "ç„¡æ¯’è¾²", "å¥åº·é£Ÿå½©", "ç›´æŽ¥è·Ÿè¾²å¤«è²·", "irent", "zipcar", "gosmart", "goshare", "gogoro", "wemo", "line go", "tesla å……é›»", "è£•é›»ä¿ƒé›»", "evalue", "evoasis", "sharkparking", "zocha", "begin", "æ˜ŸèˆŸå¿«å……", "emoving", "emoving é›»æ± "
          ]
        }
      ]
    },
    {
      "id": "sinopac-daway",
      "name": "æ°¸è±DAWAYå¡",
      "fullName": "æ°¸è±éŠ€è¡ŒDAWAYä¿¡ç”¨å¡",
      "basicCashback": 0.5,
      "annualFee": "é¦–å¹´å…å¹´è²»ï¼Œæ¬¡å¹´èµ·å¹´è²»NT$3,000",
      "feeWaiver": "ç”³è«‹é›»å­å¸³å–®ä¸”å–æ¶ˆå¯¦é«”å¸³å–®ï¼Œæˆ–å‰ä¸€å¹´åˆ·æ»¿15è¬å…ƒæˆ–12ç­†æ¶ˆè²»",
      "website": "https://bank.sinopac.com/sinopacbt/personal/credit-card/introduction/bankcard/DAWAY.html",
      "cashbackRates": [
        {
          "rate": 4.0,
          "cap": null,
          "items": ["æµ·å¤–"]
        },
        {
          "rate": 2.0,
          "cap": 20000,
          "items": ["linepay"]
        }
      ]
    },
    {
      "id": "yushan-ubear",
      "name": "çŽ‰å±±ubearå¡",
      "fullName": "çŽ‰å±±éŠ€è¡Œubearä¿¡ç”¨å¡",
      "basicCashback": 1.0,
      "annualFee": "é¦–å¹´å…å¹´è²»ï¼Œæ¬¡å¹´èµ·å¹´è²»NT$3,000",
      "feeWaiver": "å‰ä¸€å¹´åº¦æœ‰åˆ·å¡æ¶ˆè²»ç´€éŒ„æˆ–ç”³è«‹é›»å­è³¬å–®",
      "website": "https://www.esunbank.com/zh-tw/personal/credit-card/intro/bank-card/u-bear",
      "cashbackRates": [
        {
          "rate": 10.0,
          "cap": 1000,
          "cashbackType": "ç¾é‡‘å›žé¥‹",
          "conditions": "é™åŽŸå¹³å°ä»˜æ¬¾ï¼Œç¶“Googleã€PayPalç­‰ä»£æ‰£ä¸é©ç”¨ã€‚ä¸èˆ‡ä¸€èˆ¬/ç¶²è·¯æ¶ˆè²»å›žé¥‹ä½µè¨ˆï¼Œé”ä¸Šé™å³åœæ­¢å›žé¥‹ã€‚",
          "items": [
            "disney+", "nintendo", "playstation", "netflix"
          ]
        },
        {
          "rate": 3.0,
          "cap": 7500,
          "items": [
            "line pay", "è¡—å£æ”¯ä»˜", "æ‚ éŠä»˜", "openéŒ¢åŒ…", "icash pay", "å…¨ç›ˆ+pay", "å…¨æ”¯ä»˜", "æ©˜å­æ”¯ä»˜", "skm pay", "ä¸­æ²¹pay", "çŽ‰å±±wallet", "pi æ‹éŒ¢åŒ…", "æ­ä»˜å¯¶è¡Œå‹•æ”¯ä»˜", "paypal", "hami payæŽƒç¢¼ä»˜", "pchome", "momoè³¼ç‰©ç¶²", "è¦çš®", "coupangé…·æ¾Ž", "yahooè³¼ç‰©ä¸­å¿ƒ", "yahooæ‹è³£", "æ·˜å¯¶", "éœ²å¤©", "åšå®¢ä¾†", "å…¨é›»å•†", "ç”Ÿæ´»å¸‚é›†", "æ¾æžœè³¼ç‰©", "èª å“ç¶²è·¯æ›¸åº—", "fridayè³¼ç‰©", "udnå”®ç¥¨ç¶²", "gomaji", "17life", "æ¨‚å¤©å¸‚å ´", "citiesocial", "91-app", "åª½å’ªæ„›", "å±ˆè‡£æ°ç¶²è·¯å•†åŸŽ", "åº·æ˜¯ç¾Žç·šä¸Šå•†åŸŽ", "å®¶æ¨‚ç¦ç·šä¸Šè³¼ç‰©", "ç¥žè…¦å•†åŸŽ", "ç‡¦å¤ç·šä¸Šè³¼ç‰©", "ç˜‹ç‹‚è³£å®¢", "myfoneè³¼ç‰©", "486åœ˜è³¼ç¶²", "86å°èˆ–", "å°ä¸‰ç¾Žæ—¥", "appleå®˜ç¶²", "studio aå®˜ç¶²", "straight aå®˜ç¶²", "å°ç£å°ç±³", "å°ç£ç´¢å°¼è‚¡ä»½æœ‰é™å…¬å¸", "è‰¯èˆˆeclifeè³¼ç‰©ç¶²", "isunfaræ„›é †ç™¼3cè³¼ç‰©ç¶²", "è¿ªå¡å„‚ç·šä¸Šè³¼ç‰©", "æ‹“å…ƒå”®ç¥¨ç³»çµ±", "zara", "h&m", "guç¶²è·¯å•†åº—", "uniqloç¶²è·¯å•†åº—", "ob åš´é¸", "lativç±³æ ¼åœ‹éš›", "genquo", "zalora", "mosç·šä¸Šå„²å€¼", "æ˜Ÿå·´å…‹ç·šä¸Šå„²å€¼", "ibonå”®ç¥¨ç³»çµ±", "ibon mart çµ±ä¸€è¶…å•†ç·šä¸Šè³¼ç‰©ä¸­å¿ƒ", "eztable", "pinkoi", "55688 app", "uber", "å‘¼å«å°é»ƒ", "å°ç£é«˜éµt-exè¡Œå‹•è³¼ç¥¨", "å°éµç·šä¸Šè³¼ç¥¨", "eztravel", "agoda", "hotels.com", "expedia", "klook", "kkday", "booking.com", "airbnb", "ä¸­è¯èˆªç©º", "é•·æ¦®èˆªç©º", "å°ç£è™Žèˆª", "uber eats", "foodpanda", "foodomo", "lalamove", "ä½ è¨‚", "kkbox", "itunes", "google play", "funnow"
          ]
        }
      ]
    },
    {
      "id": "febank-lejia",
      "name": "é æ±æ¨‚å®¶+å¡",
      "fullName": "é æ±å•†æ¥­éŠ€è¡Œæ¨‚å®¶+ä¿¡ç”¨å¡",
      "basicCashback": 0.5,
      "annualFee": "é¦–å¹´å…å¹´è²»ï¼Œæ¬¡å¹´èµ·å¹´è²»NT$2,000",
      "feeWaiver": "å‰ä¸€å¹´åˆ·å¡éœ6è¬å…ƒæˆ–12ç­†æ¶ˆè²»ï¼Œæˆ–è¨­å®šé›»å­å¸³å–®+é éŠ€å¸³æˆ¶è‡ªæ‰£ä¸”åˆ·3ç­†",
      "website": "https://www.feib.com.tw/upload/creditcard/YACard/index.html",
      "overseasCashback": 2.5,
      "exclusions": [
        "é æ±ç™¾è²¨", "é æ±sogoç™¾è²¨", "é æ±å·¨åŸŽè³¼ç‰©ä¸­å¿ƒ", "é ä¼è³¼ç‰©ä¸­å¿ƒ", "ä»£æ‰£ç¹³é å‚³é›»ä¿¡å¸³å–®", "æ„›è²·é‡è²©", "é æ±é¦™æ ¼é‡Œæ‹‰", "mega50", "city'super", "fridayè³¼ç‰©"
      ],
      "overseasExclusions": [
        "æ­æ´²å¯¦é«”å•†åº—", "æµ·å¤–äº¤æ˜“æ¸…ç®—æ‰‹çºŒè²»", "é å€Ÿç¾é‡‘", "å­¸é›œè²»", "etoro", "å¢ƒå¤–æŠ•è³‡äº¤æ˜“å¹³è‡º"
      ],
      "cashbackRates": [
        {
          "rate": 10.0,
          "cap": 5263,
          "period": "2025/07/01-2026/03/31",
          "items": [
            "å¯µç‰©å…¬åœ’", "æ±æ£®å¯µç‰©", "é­šä¸­é­šå¯µç‰©æ°´æ—", "å¤§æ¨¹å¯µç‰©", "å‡±æœå¯µç‰©", "è²“ç‹—éšŠé•·", "æ¯›å­©å¸‚é›†", "é‡‘å‰åˆ©å¯µç‰©ç²¾å“", "å¥½ç‹—å‘½å¯µç‰©å¹¸ç¦ç”Ÿæ´»åŸŽ", "å¥½ç‹—é‹è²“ç‹—ç¦åˆ©ä¸­å¿ƒ", "é‡‘çŽ‹å­å¯µç‰©", "æ„›è²“åœ’", "ç¦å£½å¯µç‰©æ——è‰¦é¤¨", "å‹•ç‰©é†«é™¢", "å¯µç‰©é†«é™¢"
          ]
        },
        {
          "rate": 2.5,
          "cap": null,
          "hideInDisplay": true,
          "items": [
            "æµ·å¤–"
          ]
        },
        {
          "rate": 4.0,
          "cap": 5714,
          "period": "2025/07/01-2026/03/31",
          "category": "å¤§å°å®‰å¿ƒåˆ·",
          "conditions": "é ˆæœ¬æœŸå¸³æ¬¾ä»¥é éŠ€å¸³æˆ¶è‡ªå‹•æ‰£æ¬¾æˆåŠŸ,æ¬¡æœŸå¸³å–®ä¸­ä»¥æœ¬å¡æ–°å¢žä¸€èˆ¬æ¶ˆè²»æ»¿NT$3,000",
          "items": [
            "åœ‹å…§é¤å»³", "å¤§æ¨¹é€£éŽ–è—¥å±€", "æä¸€é†«ç™‚ç”¨å“", "ç¶­åº·é†«ç™‚ç”¨å“", "èºç…é€£éŽ–è—¥å±€", "åª½å’ªæ¨‚å±…å®¶æœå‹™", "æ½”å®¢å¹«", "å¡å¤šæ‘©å¬°ç«¥é¤¨", "å®œå…’æ¨‚å©¦å¬°ç”¨å“", "ç‡Ÿé¤ŠéŠ€è¡Œ", "éº—å…’é‡‡å®¶", "ikea", "ç’°çƒè³¼ç‰©ä¸­å¿ƒ", "ç§€æ³°ç”Ÿæ´»", "æ•…å®®åšç‰©é™¢", "çµ±ä¸€æ™‚ä»£ç™¾è²¨", "å¤§è‘‰é«˜å³¶å±‹", "ç¾Žéº—è¯ç™¾æ¨‚åœ’", "citylink", "å®åŒ¯å»£å ´", "ifgé é›„å»£å ´", "æ–°æœˆå»£å ´", "å°èŒ‚è³¼ç‰©ä¸­å¿ƒ", "å¤§æ±Ÿåœ‹éš›è³¼ç‰©ä¸­å¿ƒ", "æ¡ƒçŸ¥é“geleven plaza", "å°äººåœ‹ä¸»é¡Œæ¨‚åœ’", "å…­ç¦æ‘ä¸»é¡ŒéŠæ¨‚åœ’", "å¤§é­¯é–£æ¹³é›…å»£å ´", "å°šé †è‚²æ¨‚ä¸–ç•Œ", "å°ä¸­lalaport", "éº—å¯¶æ¨‚åœ’æ¸¡å‡å€", "å²¡å±±æ¨‚è³¼å»£å ´", "å—ç´¡è³¼ç‰©ä¸­å¿ƒ", "skmpark", "çµ±ä¸€å¤¢æ™‚ä»£è³¼ç‰©ä¸­å¿ƒ"
          ]
        },
        {
          "rate": 4.0,
          "cap": 5714,
          "period": "2025/07/01-2026/03/31",
          "category": "ç”Ÿæ´»ç¦®é‡",
          "conditions": "é ˆæœ¬æœŸå¸³æ¬¾ä»¥é éŠ€å¸³æˆ¶è‡ªå‹•æ‰£æ¬¾æˆåŠŸ,æ¬¡æœŸå¸³å–®ä¸­ä»¥æœ¬å¡æ–°å¢žä¸€èˆ¬æ¶ˆè²»æ»¿NT$3,000",
          "items": [
            "æ„›è²·", "å®¶æ¨‚ç¦", "ç¾Žå»‰ç¤¾", "å°åŒ—ç™¾è²¨", "å¤§è²·å®¶", "å–œäº’æƒ ", "è–å¾·ç§‘æ–¯", "æ£‰èŠ±ç”°", "æ°¸è±é¤˜ç”ŸæŠ€", "green&safe", "é‡Œä»", "å°ç£ä¸»å©¦è¯ç›Ÿ", "å¥åº·é£Ÿå½©", "å®‰éº—", "è‘¡çœ¾", "ç¾Žæ¨‚å®¶", "åœ‹å…§åŠ æ²¹", "gogoro", "tesla", "å°ç£å¤§è»ŠéšŠ", "yoxi", "uber", "goshare", "irent", "wemo scooter", "ä»£æ‰£é å‚³é›»ä¿¡", "ä»£æ‰£å°ç£å¤§å“¥å¤§å¸³å–®", "å°ç£è™¨å±‹", "tsutaya bookstore", "å·¨åŒ é›»è…¦", "è¯æˆé›»è…¦", "æœ±å®—æ…¶æ‰“æ“Šæ¨‚æ•™å®¤", "é›²é–€èˆžè¹ˆæ•™å®¤", "èª å“æ›¸åº—", "èª å“ç”Ÿæ´»", "åšå®¢ä¾†ç¶²è·¯å•†åº—", "é‡‘çŸ³å ‚æ›¸åº—", "å¥èº«å·¥å ´", "worldgym", "beingspa", "beingsport", "curveså¯çˆ¾å§¿", "ä½ç™»å¦®çµ²"
          ]
        }
      ]
    },
    {
      "id": "tbb-chaotian",
      "name": "ä¼éŠ€æœå¤©å®®å¡",
      "fullName": "å°ç£ä¼éŠ€åŒ—æ¸¯æœå¤©å®®èªåŒå¡",
      "basicCashback": 0.3,
      "annualFee": "é¦–å¹´å…å¹´è²»ï¼Œæ¬¡å¹´èµ·å¹´è²»NT$2,400",
      "feeWaiver": "æœ‰æ¶ˆè²»ï¼Œæˆ–ç”³è¾¦é›»å­å¸³å–®ä¸¦å–æ¶ˆå¯¦é«”å¸³å–®",
      "website": "https://www.tbb.com.tw/zh-tw/personal/cards/products/overview/chaotiangong-creditcard",
      "overseasCashback": 1.5,
      "cashbackRates": [
        {
          "rate": 6.0,
          "cap": 8772,
          "conditions": "ä½¿ç”¨é›»å­å¸³å–®+ç™»éŒ„ä¸€æ¬¡",
          "period": "2024/10/01-2025/12/31",
          "items": [
            "uber eats", "foodpanda", "å±ˆè‡£æ°", "åº·æ˜¯ç¾Ž", "poyaå¯¶é›…", "j-martä½³ç‘ª", "å”å‰è¨¶å¾·", "ç¶­åº·é†«ç™‚ç”¨å“", "å¤§æ¨¹è—¥å±€", "å•„æœ¨é³¥è—¥å¸«è—¥å±€", "æä¸€é†«ç™‚ç”¨å“", "ä¸ä¸è—¥å±€", "èºç…é€£éŽ–è—¥å±€", "æ–°é«˜æ©‹è—¥å±€", "æ¾æœ¬æ¸…", "tomod'sç‰¹ç¾Žäº‹", "æ—¥è—¥æœ¬èˆ–", "å°ä¸‰ç¾Žæ—¥", "æœ­å¹Œè—¥å¦", "é«˜éµ", "å°éµ", "uber", "å°ç£å¤§è»ŠéšŠ", "å¤§éƒ½æœƒè»ŠéšŠ", "line go", "yoxi", "å’Œé‹ç§Ÿè»Š", "æ ¼ä¸Šç§Ÿè»Š"
          ]
        },
        {
          "rate": 1.5,
          "cap": 6667,
          "conditions": "ç¶å®šå°ç£Payè¡Œå‹•æ”¯ä»˜",
          "period": "2025/01/01-2025/12/31",
          "items": [
            "ä¼éŠ€æœå¤©å®®+å°ç£pay"
          ]
        }
      ]
    },
    {
      "id": "hsbc-liveplus",
      "name": "æ»™è±Live+å¡",
      "fullName": "æ»™è± Live+ ç¾é‡‘å›žé¥‹å¡",
      "basicCashback": 1.88,
      "annualFee": "é¦–å¹´å…å¹´è²»ï¼Œæ¬¡å¹´èµ·å¹´è²»NT$2,000",
      "feeWaiver": "æ¶ˆè²»æ»¿NT$80,000æˆ–12ç­†ï¼Œæˆ–ç”³è«‹é›»å­/è¡Œå‹•å¸³å–®ï¼Œå°±å¯çµ‚èº«å…å¹´è²»",
      "website": "https://www.hsbc.com.tw/credit-cards/products/liveplus/",
      "autoBillCashback": 0,
      "autoBillCap": 0,
      "overseasBonusRate": 1.0,
      "overseasBonusCap": 20000,
      "basicPeriod": "2025/07/01-2025/12/31",
      "cashbackRates": [
        {
          "rate": 3.0,
          "cap": 29600,
          "period": "2025/07/01-2025/12/31",
          "items": [
            "é¤é£²mcc", "è³¼ç‰©mcc", "å¨›æ¨‚mcc", "è¦çš®è³¼ç‰©", "pchome 24hè³¼ç‰©", "é…·æ¾Ž", "ebay", "amazon", "fridayè³¼ç‰©", "gomaji", "éº¥ç•¶å‹ž", "æ˜Ÿå·´å…‹", "çŽ‹å“é›†åœ˜", "äº«é´¨", "å¤æ…•å°¼", "çŽ‹å“", "è¥¿å ¤", "çŸ³äºŒé‹", "é™¶æ¿å±‹", "é’èŠ±é©•", "é¥—è³“é¤æ—…", "äº«äº«", "é–‹é£¯", "ç“¦åŸŽ", "é¼Žæ³°è±", "å¯ŒçŽ‹å¤§é£¯åº—æ–‡å…¬é¤¨", "æ•™çˆ¶ç‰›æŽ’", "å±±æµ·æ¨“", "é¹½ä¹‹è¯", "ç‰¡ä¸¹tempura", "å‰å…†å‰²çƒ¹å£½å¸", "æ˜Žå£½å¸", "logy", "inita", "æµ·åº•æ’ˆ", "é‡‘å¤§é‹„å£½å–œç‡’", "ç¯‰é–“å¹¸ç¦é‹ç‰©", "å£½å¸éƒŽ", "è—å£½å¸", "çˆ­é®®", "é‡‘è‰²ä¸‰éº¥", "è²´æ—ä¸–å®¶", "èŽ«å‡¡å½¼", "æ˜¥å¤§ç›´", "è²³æ¨“", "æ¶µè±†è…", "hooters", "å‹ç”°æ—¥å¼è±¬æŽ’", "å¿…å‹å®¢", "é”ç¾Žæ¨‚", "ikea", "å°åŒ—101", "ä¸‰äº•outlet", "å¾®é¢¨å—å±±", "å¾®é¢¨å—äº¬", "å¾®é¢¨ä¿¡ç¾©", "å¾®é¢¨æ¾é«˜", "å¾®é¢¨å»£å ´", "å¾®é¢¨ä¸‰ç¸½", "å¾®é¢¨åŒ—è»Š", "é æ±sogoç™¾è²¨", "æ¼¢ç¥žå·¨è›‹", "è¯æ³°åå“åŸŽ", "æ–°å…‰ä¸‰è¶Š", "skm park outlet", "att 4 fun", "ç¾Žéº—è¯ç™¾æ¨‚åœ’", "å—ç´¡è³¼ç‰©ä¸­å¿ƒ", "çµ±ä¸€æ™‚ä»£ç™¾è²¨", "ifgé é›„å»£å ´", "äº¬ç«™æ™‚å°šå»£å ´", "citylink", "å¤¢æ™‚ä»£è³¼ç‰©ä¸­å¿ƒ", "lalaportå°ä¸­", "å¤§è‘‰é«˜å³¶å±‹ç™¾è²¨", "ä¸­å‹ç™¾è²¨", "é ä¼è³¼ç‰©ä¸­å¿ƒ", "éº—å¯¶outlet", "æ¯”æ¼¾å»£å ´", "å¤§æ±Ÿåœ‹éš›è³¼ç‰©ä¸­å¿ƒ", "é æ±å·¨åŸŽ", "é æ±ç™¾è²¨", "global mall", "æ¼¢ç¥žååº—ç™¾è²¨", "ç¾©å¤§ä¸–ç•Œè³¼ç‰©å»£å ´", "å°èŒ‚è³¼ç‰©ä¸­å¿ƒ", "å¯¶é›…", "ç„¡å°è‰¯å“", "bellavita", "å®åŒ¯å»£å ´", "ç¾©äº«æ™‚å°šå»£å ´", "nokeå¿ æ³°æ¨‚ç”Ÿæ´»", "å¤§é­¯é–£æ¹³é›…å»£å ´", "æ˜Žæ›œç™¾è²¨", "æ–°å…‰å½±åŸŽ", "å¨ç§€å½±åŸŽ", "åœ‹è³“å½±åŸŽ", "ç§€æ³°å½±åŸŽ", "ç’°çƒå½±åŸŽ", "è¿ªå£«å°¼æ¨‚åœ’", "å‰åœåŠ›å…¬åœ’", "æ¨‚å¤©ä¸–ç•Œ", "legoland", "safari world", "å…’ç«¥æ–°æ¨‚åœ’", "x park", "å°äººåœ‹", "å…­ç¦æ‘", "å¤§é­¯é–£", "é é›„æµ·æ´‹å…¬åœ’", "éº—å¯¶æ¨‚åœ’", "åŠæ¹–å±±ä¸–ç•Œ", "ä¹æ—æ–‡åŒ–æ‘", "å°šé †è‚²æ¨‚ä¸–ç•Œ", "ç¾©å¤§éŠæ¨‚ä¸–ç•Œ", "å·§è™Žå¤¢æƒ³æ¨‚åœ’", "å°åŒ—å¸‚ç«‹å‹•ç‰©åœ’", "åœ‹ç«‹æµ·æ´‹ç”Ÿç‰©åšç‰©é¤¨", "å¥‡ç¾Žåšç‰©é¤¨", "å°å®ç•¶ç§‘å­¸ä¸»é¡Œæ¨‚åœ’", "é‡ŽæŸ³æµ·æ´‹ä¸–ç•Œ", "æ˜Ÿå¤¢æ£®æž—åŠ‡å ´", "åŸ”å¿ƒç‰§å ´", "é£›ç‰›ç‰§å ´", "é ‘çš®ä¸–ç•Œ", "è‡ªè¡Œè»Šæ–‡åŒ–é¤¨", "æ¡ƒåœ’å¸‚ç«‹ç¾Žè¡“é¤¨", "çƒä¾†å°è»Š", "æ—¥æœˆæ½­çºœè»Š", "å’Œå¹³å³¶å…¬åœ’", "å°å—åé¼“ä»ç³–æ–‡å‰µåœ’å€", "å¤ªå¹³å±±éŠæ¨‚å€", "é˜¿é‡Œå±±åœ‹å®¶æ£®æž—éŠæ¨‚å€", "å¤§é›ªå±±æ£®æž—éŠæ¨‚å€", "å¢“ä¸åœ‹å®¶æ£®æž—éŠæ¨‚å€", "å…§æ´žåœ‹å®¶æ£®æž—éŠæ¨‚å€", "momo", "è‚¯å¾·åŸº", "æ‘©æ–¯æ¼¢å ¡"
          ]
        },
        {
          "rate": 1.0,
          "cap": 20000,
          "period": "2025/07/01-2025/12/31",
          "items": [
            "æ—¥æœ¬ç•¶åœ°å¯¦é«”é¤é£²mcc", "æ–°åŠ å¡ç•¶åœ°å¯¦é«”é¤é£²mcc", "é¦¬ä¾†è¥¿äºžç•¶åœ°å¯¦é«”é¤é£²mcc", "è¶Šå—ç•¶åœ°å¯¦é«”é¤é£²mcc", "è²å¾‹è³“ç•¶åœ°å¯¦é«”é¤é£²mcc", "å°åº¦ç•¶åœ°å¯¦é«”é¤é£²mcc", "æ–¯é‡Œè˜­å¡ç•¶åœ°å¯¦é«”é¤é£²mcc"
          ]
        }
      ]
    },
    {
      "id": "sinopac-coin",
      "name": "æ°¸è±å¹£å€å¡",
      "fullName": "æ°¸è±éŠ€è¡Œå¹£å€å¡",
      "basicCashback": 1.0,
      "annualFee": "é¦–å¹´å…å¹´è²»ï¼Œæ¬¡å¹´èµ·å¹´è²»NT$3,000",
      "feeWaiver": "ç”³è«‹é›»å­æˆ–è¡Œå‹•å¸³å–®æœŸé–“æ­£é™„å¡çš†çµ‚èº«å…å¹´è²»ï¼Œæˆ–ä»»ä¸€å¹´æ¶ˆè²»æ»¿36,000å…ƒæˆ–æ¶ˆè²»12æ¬¡",
      "website": "https://bank.sinopac.com/sinopacBT/personal/credit-card/introduction/bankcard/dual-currency-card.html",
      "domesticBonusRate": 1.0,
      "domesticBonusCap": 20000,
      "overseasCashback": 3.0,
      "overseasBonusRate": 4.0,
      "overseasBonusCap": 7500,
      "cashbackRates": [
        {
          "rate": 4.0,
          "cap": 7500,
          "items": [
            "amazon", "æ·˜å¯¶", "dokodemoå¤šå’Œå¤¢", "lookfantastic", "selfridges", "farfetch", "casetify", "daikokudrug", "ebay", "shopbop", "zalora", "asos", "iherb", "gmarket", "yoox", "yesstyle", "èˆªç©ºå…¬å¸", "agoda", "booking.com", "æ˜“éŠç¶²", "é›„ç…æ—…è¡Œç¤¾", "é£¯åº—é¡ž", "æ¸¡å‡æ‘", "æ—…é¤¨æ°‘å®¿", "æ­ç‰¹å„€æ¾å±±æ©Ÿå ´åœè»Š", "ä¸­è¯èˆªç©º", "é•·æ¦®èˆªç©º", "æ˜Ÿå®‡èˆªç©º", "å°ç£è™Žèˆª", "åœ‹æ³°èˆªç©º", "æ¨‚æ¡ƒèˆªç©º", "æ—¥æœ¬èˆªç©º", "å…¨æ—¥ç©º", "å¤§éŸ“èˆªç©º", "æ–°åŠ å¡èˆªç©º", "é£¯åº—", "æ¸¡å‡æ‘", "æ—…é¤¨", "æ°‘å®¿"
          ]
        },
        {
          "rate": 3.0,
          "cap": null,
          "items": [
            "æµ·å¤–"
          ]
        }
      ]
    },
    {
      "id": "taishin-jiekou",
      "name": "å°æ–°è¡—å£å¡",
      "fullName": "å°æ–°éŠ€è¡Œè¡—å£è¯åå¡",
      "basicCashback": 1.0,
      "basicCashbackType": "è¡—å£å¹£",
      "annualFee": "æ­£å¡NT$4,500",
      "feeWaiver": "æŽ¡é›»å­/è¡Œå‹•ç°¡è¨Šå¸³å–®",
      "website": "https://www.taishinbank.com.tw/",
      "domesticBonusRate": 2.5,
      "domesticBonusCap": 400000,
      "cashbackRates": [
        {
          "rate": 2.5,
          "cap": 400000,
          "cashbackType": "è¡—å£å¹£",
          "period": "æ´»å‹•è‡³2025/12/31",
          "items": [
            "æ—¥æœ¬PayPay(é™æ–¼è¡—å£æ”¯ä»˜ç¶å®š)", "éŸ“åœ‹(å«å¯¦é«”åŠç¶²è·¯)", "æ˜“éŠç¶²", "agoda", "airbnb", "é«˜éµ", "uber", "æ–°å…‰ä¸‰è¶Š", "é æ±ç™¾è²¨", "lalaport", "ä¸‰äº•(MITSUI OUTLET PARK)", "åº·æ˜¯ç¾Žå¯¦é«”é–€å¸‚", "å±ˆè‡£æ°å¯¦é«”é–€å¸‚", "å¯¶é›…å¯¦é«”é–€å¸‚", "uber eats", "foodpanda", "æ˜Ÿå·´å…‹(é™å¯¦é«”)", "è·¯æ˜“èŽŽå’–å•¡", "85åº¦C", "cama cafÃ©", "å¤šé‚£ä¹‹", "æ¸…å¿ƒç¦å…¨", "è¿·å®¢å¤", "å¯ä¸å¯", "éº»å¤èŒ¶åŠ", "COMEBUY", "å¤§èŒ—", "é¾œè¨˜", "UG", "é®®èŒ¶é“", "äº”æ¡è™Ÿ", "èŒ¶æ¹¯æœƒ", "TEATOP ç¬¬ä¸€å‘³", "çç…®ä¸¹", "è€è³´èŒ¶æ£§"
          ]
        }
      ]
    }
  ]
};

// Load cards data function - now simplified since data is embedded
async function loadCardsData() {
    console.log('âœ… ä¿¡ç”¨å¡è³‡æ–™å·²å…§åµŒè¼‰å…¥');
    return true;
}

// Show error message to user
function showErrorMessage(message) {
    const container = document.querySelector('.container');
    if (container) {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            background: #fee2e2;
            border: 1px solid #fca5a5;
            color: #dc2626;
            padding: 16px;
            margin: 16px;
            border-radius: 8px;
            text-align: center;
            font-weight: 500;
        `;
        errorDiv.innerHTML = `âš ï¸ ${message}`;
        container.insertBefore(errorDiv, container.firstChild);
    }
}

let currentMatchedItem = null;

// DOM elements - will be initialized after DOM is loaded
let merchantInput, amountInput, calculateBtn, resultsSection, resultsContainer, couponResultsSection, couponResultsContainer, matchedItemDiv;

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 DOM loaded, initializing application...');
    
    // Initialize DOM elements
    merchantInput = document.getElementById('merchant-input');
    amountInput = document.getElementById('amount-input');
    calculateBtn = document.getElementById('calculate-btn');
    resultsSection = document.getElementById('results-section');
    resultsContainer = document.getElementById('results-container');
    couponResultsSection = document.getElementById('coupon-results-section');
    couponResultsContainer = document.getElementById('coupon-results-container');
    matchedItemDiv = document.getElementById('matched-item');
    
    // Check if essential DOM elements exist
    if (!merchantInput || !amountInput || !calculateBtn) {
        console.error('❌ Essential DOM elements not found!');
        showErrorMessage('頁面載入錯誤，請重新整理頁面');
        return;
    }
    
    // Load cards data first
    const dataLoaded = await loadCardsData();
    if (!dataLoaded) {
        console.error('❌ Failed to load cards data');
        showErrorMessage('信用卡資料載入失敗');
        if (calculateBtn) calculateBtn.disabled = true;
        return;
    }
    
    console.log('✅ Cards data loaded, initializing user cards...');
    // Initialize user cards (all cards for non-logged users)
    loadUserCards();
    
    console.log('✅ Populating card chips...');
    populateCardChips();
    
    console.log('✅ Setting up event listeners...');
    setupEventListeners();
    
    console.log('✅ Setting up authentication...');
    setupAuthentication();
});

// Populate card chips in header
function populateCardChips() {
    console.log('🔄 populateCardChips called, currentUser:', currentUser ? currentUser.email : 'not logged in');
    
    const cardChipsContainer = document.getElementById('card-chips');
    if (!cardChipsContainer) {
        console.error('❌ card-chips container not found!');
        return;
    }
    
    // Clear existing chips
    cardChipsContainer.innerHTML = '';
    
    // Check if cards data exists
    if (!cardsData || !cardsData.cards || cardsData.cards.length === 0) {
        console.error('❌ No cards data available!');
        cardChipsContainer.innerHTML = '<div style="color: red; padding: 10px;">信用卡資料載入失敗</div>';
        return;
    }
    
    // Show cards based on user selection or all cards if not logged in
    const cardsToShow = currentUser ? 
        cardsData.cards.filter(card => userSelectedCards.has(card.id)) :
        cardsData.cards;
    
    console.log('📊 Cards to show:', cardsToShow.length, 'total cards:', cardsData.cards.length);
    console.log('📋 Selected cards:', Array.from(userSelectedCards));
    
    if (cardsToShow.length === 0) {
        if (currentUser && userSelectedCards.size === 0) {
            cardChipsContainer.innerHTML = '<div style="color: #666; padding: 10px;">尚未選擇任何信用卡，請點擊設定按鈕選擇</div>';
        } else {
            cardChipsContainer.innerHTML = '<div style="color: red; padding: 10px;">找不到符合條件的信用卡</div>';
        }
        return;
    }
    
    cardsToShow.forEach(card => {
        const chip = document.createElement('div');
        chip.className = 'card-chip chip-clickable';
        chip.textContent = card.name;
        chip.addEventListener('click', () => showCardDetail(card.id));
        cardChipsContainer.appendChild(chip);
    });
    
    console.log('✅ Successfully populated', cardsToShow.length, 'card chips');
}

// Setup event listeners
function setupEventListeners() {
    // Merchant input with real-time matching
    merchantInput.addEventListener('input', handleMerchantInput);
    
    // Amount input validation
    amountInput.addEventListener('input', validateInputs);
    
    // Calculate button
    calculateBtn.addEventListener('click', calculateCashback);
    
    // Enter key support
    document.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !calculateBtn.disabled) {
            calculateCashback();
        }
    });
}

// Handle merchant input changes
function handleMerchantInput() {
    const input = merchantInput.value.trim().toLowerCase();
    
    if (input.length === 0) {
        hideMatchedItem();
        currentMatchedItem = null;
        validateInputs();
        return;
    }
    
    // Find matching items
    const matchedItem = findMatchingItem(input);
    
    if (matchedItem) {
        showMatchedItem(matchedItem);
        currentMatchedItem = matchedItem;
    } else {
        hideMatchedItem();
        currentMatchedItem = null;
    }
    
    validateInputs();
}

// Find matching item in cards database
function findMatchingItem(searchTerm) {
    if (!cardsData) return null;
    
    const searchLower = searchTerm.toLowerCase().trim();
    let allMatches = [];
    
    // Collect all possible matches
    for (const card of cardsData.cards) {
        for (const rateGroup of card.cashbackRates) {
            for (const item of rateGroup.items) {
                const itemLower = item.toLowerCase();
                
                // Only add if there's a match
                if (itemLower.includes(searchLower) || searchLower.includes(itemLower)) {
                    allMatches.push({
                        originalItem: item,
                        searchTerm: searchTerm,
                        itemLower: itemLower,
                        searchLower: searchLower,
                        // Calculate match quality
                        isExactMatch: itemLower === searchLower,
                        isFullContainment: itemLower.includes(searchLower),
                        length: itemLower.length
                    });
                }
            }
        }
    }
    
    if (allMatches.length === 0) return null;
    
    // Remove duplicates (same item appearing in multiple cards)
    const uniqueMatches = [];
    const seenItems = new Set();
    for (const match of allMatches) {
        if (!seenItems.has(match.itemLower)) {
            seenItems.add(match.itemLower);
            uniqueMatches.push(match);
        }
    }
    
    // Sort by match quality
    uniqueMatches.sort((a, b) => {
        // 1. Exact matches first
        if (a.isExactMatch && !b.isExactMatch) return -1;
        if (!a.isExactMatch && b.isExactMatch) return 1;
        
        // 2. Full containment (search term fully contained in item)
        if (a.isFullContainment && !b.isFullContainment) return -1;
        if (!a.isFullContainment && b.isFullContainment) return 1;
        
        // 3. For non-exact matches, prefer shorter items (more specific)
        if (!a.isExactMatch && !b.isExactMatch) {
            return a.length - b.length;
        }
        
        return 0;
    });
    
    // Return the best match
    return uniqueMatches[0];
}

// Show matched item
function showMatchedItem(matchedItem) {
    matchedItemDiv.innerHTML = `âœ“ ç³»çµ±åŒ¹é…åˆ°: <strong>${matchedItem.originalItem}</strong>`;
    matchedItemDiv.className = 'matched-item';
    matchedItemDiv.style.display = 'block';
}

// Show no match message with red styling
function showNoMatchMessage() {
    matchedItemDiv.innerHTML = `âœ“ ç³»çµ±åŒ¹é…åˆ°: <strong>æ²’æœ‰ä»»ä½•åŒ¹é…çš„é …ç›®ï¼Œä»¥ä¸‹çµæžœé¡¯ç¤ºåŸºæœ¬å›žé¥‹</strong>`;
    matchedItemDiv.className = 'matched-item no-match';
    matchedItemDiv.style.display = 'block';
}

// Hide matched item
function hideMatchedItem() {
    matchedItemDiv.style.display = 'none';
}


// Validate inputs
function validateInputs() {
    const merchantValue = merchantInput.value.trim();
    const amountValue = parseFloat(amountInput.value);
    
    const isValid = merchantValue.length > 0 && 
                   !isNaN(amountValue) && 
                   amountValue > 0;
    
    calculateBtn.disabled = !isValid;
}

// Calculate cashback for all cards
function calculateCashback() {
    if (!cardsData) {
        return;
    }
    
    const amount = parseFloat(amountInput.value);
    const merchantValue = merchantInput.value.trim();
    
    let results;
    let isBasicCashback = false;
    
    // Get cards to compare (user selected or all)
    const cardsToCompare = currentUser ? 
        cardsData.cards.filter(card => userSelectedCards.has(card.id)) :
        cardsData.cards;
    
    if (currentMatchedItem) {
        // User input matched specific items - show special cashback rates
        const searchTerm = currentMatchedItem.originalItem.toLowerCase();
        results = cardsToCompare.map(card => {
            const result = calculateCardCashback(card, searchTerm, amount);
            return {
                ...result,
                card: card
            };
        })
        // Filter out cards with no special cashback
        .filter(result => result.cashbackAmount > 0);
        
        // Show no-match message and basic rates when no special rates found
        if (results.length === 0 && merchantValue.length > 0) {
            showNoMatchMessage();
            // Show basic cashback for selected cards when no special rates found
            isBasicCashback = true;
            results = cardsToCompare.map(card => {
                let basicCashbackAmount = 0;
                let effectiveRate = card.basicCashback;
                
                // Handle complex cards like HSBC Live+ with multiple basic rates
                if (card.autoBillCashback && card.autoBillCap) {
                    const autoBillAmount = Math.min(amount, card.autoBillCap);
                    const autoBillCashback = Math.floor(autoBillAmount * (card.basicCashback + card.autoBillCashback) / 100);
                    const normalAmount = amount - autoBillAmount;
                    const normalCashback = Math.floor(normalAmount * card.basicCashback / 100);
                    basicCashbackAmount = autoBillCashback + normalCashback;
                    effectiveRate = ((autoBillCashback + normalCashback) / amount * 100).toFixed(2);
                } else if (card.domesticBonusRate && card.domesticBonusCap) {
                    // Handle æ°¸è±å¹£å€ type cards with domestic bonus
                    const bonusAmount = Math.min(amount, card.domesticBonusCap);
                    const bonusCashback = Math.floor(bonusAmount * card.domesticBonusRate / 100);
                    const basicCashback = Math.floor(amount * card.basicCashback / 100);
                    basicCashbackAmount = bonusCashback + basicCashback;
                    effectiveRate = card.basicCashback + card.domesticBonusRate;
                } else {
                    basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
                }
                
                // Determine cap for display
                let displayCap = null;
                if (card.domesticBonusRate && card.domesticBonusCap) {
                    displayCap = card.domesticBonusCap;
                }
                
                return {
                    rate: effectiveRate,
                    cashbackAmount: basicCashbackAmount,
                    cap: displayCap,
                    matchedItem: null,
                    effectiveAmount: amount,
                    card: card,
                    isBasic: true
                };
            });
        }
    } else {
        // No match found or no input - show basic cashback for selected cards
        isBasicCashback = true;
        results = cardsToCompare.map(card => {
            let basicCashbackAmount = 0;
            let effectiveRate = card.basicCashback;
            
            // Handle complex cards like HSBC Live+ with multiple basic rates
            if (card.autoBillCashback && card.autoBillCap) {
                const autoBillAmount = Math.min(amount, card.autoBillCap);
                const autoBillCashback = Math.floor(autoBillAmount * (card.basicCashback + card.autoBillCashback) / 100);
                const normalAmount = amount - autoBillAmount;
                const normalCashback = Math.floor(normalAmount * card.basicCashback / 100);
                basicCashbackAmount = autoBillCashback + normalCashback;
                effectiveRate = ((autoBillCashback + normalCashback) / amount * 100).toFixed(2);
            } else if (card.domesticBonusRate && card.domesticBonusCap) {
                // Handle æ°¸è±å¹£å€ type cards with domestic bonus
                const bonusAmount = Math.min(amount, card.domesticBonusCap);
                const bonusCashback = Math.floor(bonusAmount * card.domesticBonusRate / 100);
                const basicCashback = Math.floor(amount * card.basicCashback / 100);
                basicCashbackAmount = bonusCashback + basicCashback;
                effectiveRate = card.basicCashback + card.domesticBonusRate;
            } else {
                basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
            }
            
            // Determine cap for display
            let displayCap = null;
            if (card.domesticBonusRate && card.domesticBonusCap) {
                displayCap = card.domesticBonusCap;
            }
            
            return {
                rate: effectiveRate,
                cashbackAmount: basicCashbackAmount,
                cap: displayCap,
                matchedItem: null,
                effectiveAmount: amount,
                card: card,
                isBasic: true
            };
        });
        
        // Show no match message if user has typed something
        if (merchantValue.length > 0) {
            showNoMatchMessage();
        }
    }
    
    // Sort by cashback amount (highest first)
    results.sort((a, b) => b.cashbackAmount - a.cashbackAmount);
    
    // Display results
    displayResults(results, amount, currentMatchedItem ? currentMatchedItem.originalItem : merchantValue, isBasicCashback);
    
    // Display coupon cashbacks
    displayCouponCashbacks(amount, merchantValue);
}

// Calculate cashback for a specific card
function calculateCardCashback(card, searchTerm, amount) {
    let bestRate = 0;
    let applicableCap = null;
    let matchedItem = null;
    let matchedCategory = null;
    let matchedRateGroup = null;
    
    // Handle CUBE card with levels and new category structure
    if (card.hasLevels && card.id === 'cathay-cube') {
        const savedLevel = localStorage.getItem(`cubeLevel-${card.id}`) || 'level1';
        const levelSettings = card.levelSettings[savedLevel];
        
        // First check special items (highest tier)
        let matchedSpecialItem = card.specialItems.find(item => item.toLowerCase() === searchTerm);
        
        if (matchedSpecialItem) {
            bestRate = levelSettings.specialRate;
            matchedItem = matchedSpecialItem;
            matchedCategory = '玩數位、樂饗購、趣旅行';
        } else {
            // Check other category items
            for (const rateGroup of card.cashbackRates) {
                let exactMatch = rateGroup.items.find(item => item.toLowerCase() === searchTerm);
                if (exactMatch && rateGroup.rate >= bestRate) {
                    // Check if it's birthday month category and user's birth month matches
                    if (rateGroup.category === '慶生月') {
                        const currentMonth = new Date().getMonth() + 1;
                        const userBirthMonth = localStorage.getItem(`birthMonth-${card.id}`);
                        if (!userBirthMonth || parseInt(userBirthMonth) !== currentMonth) {
                            continue; // Skip if not user's birth month
                        }
                    }
                    
                    bestRate = rateGroup.rate;
                    applicableCap = rateGroup.cap;
                    matchedItem = exactMatch;
                    matchedCategory = rateGroup.category;
                    matchedRateGroup = rateGroup;
                }
            }
            
            // If no match found, use general rate
            if (bestRate === 0) {
                bestRate = levelSettings.generalRate;
                matchedItem = '其他通路';
                matchedCategory = '其他通路';
            }
        }
        applicableCap = null; // CUBE card has no cap for most categories
    } else {
        // ONLY use exact matches for other cards
        for (const rateGroup of card.cashbackRates) {
            let exactMatch = rateGroup.items.find(item => item.toLowerCase() === searchTerm);
            if (exactMatch && rateGroup.rate > bestRate) {
                bestRate = rateGroup.rate;
                applicableCap = rateGroup.cap;
                matchedItem = exactMatch;
                matchedCategory = rateGroup.category || null;
                matchedRateGroup = rateGroup;
            }
        }
    }
    
    let cashbackAmount = 0;
    let effectiveAmount = amount;
    let totalRate = bestRate;
    
    if (bestRate > 0) {
        // Calculate special rate cashback
        let specialCashback = 0;
        let effectiveSpecialAmount = amount;
        
        if (applicableCap && amount > applicableCap) {
            effectiveSpecialAmount = applicableCap;
        }
        
        specialCashback = Math.floor(effectiveSpecialAmount * bestRate / 100);
        
        // Determine basic rate and additional bonuses based on card type and merchant
        let basicRate = card.basicCashback;
        let bonusRate = 0;
        
        // Handle special cards like æ°¸è±å¹£å€ with different domestic/overseas rates
        if (matchedItem === 'æµ·å¤–' && card.overseasCashback) {
            basicRate = card.overseasCashback;
            if (card.overseasBonusRate && card.overseasBonusCap) {
                bonusRate = card.overseasBonusRate;
            }
        } else if (card.domesticBonusRate && card.domesticBonusCap) {
            bonusRate = card.domesticBonusRate;
        }
        
        // For CUBE card, the rates already include basic cashback, so don't add it again
        let basicCashback = 0;
        if (card.id !== 'cathay-cube') {
            basicCashback = Math.floor(effectiveSpecialAmount * basicRate / 100);
        }
        
        // Add bonus cashback if applicable
        let bonusCashback = 0;
        if (bonusRate > 0) {
            let bonusAmount = effectiveSpecialAmount;
            if (matchedItem === 'æµ·å¤–' && card.overseasBonusCap) {
                bonusAmount = Math.min(effectiveSpecialAmount, card.overseasBonusCap);
            } else if (card.domesticBonusCap) {
                bonusAmount = Math.min(effectiveSpecialAmount, card.domesticBonusCap);
            }
            bonusCashback = Math.floor(bonusAmount * bonusRate / 100);
        }
        
        // Handle remaining amount if capped
        let remainingCashback = 0;
        if (applicableCap && amount > applicableCap) {
            const remainingAmount = amount - applicableCap;
            remainingCashback = Math.floor(remainingAmount * basicRate / 100);
            
            // Add bonus for remaining amount if applicable
            if (bonusRate > 0) {
                let remainingBonusAmount = remainingAmount;
                if (matchedItem === 'æµ·å¤–' && card.overseasBonusCap) {
                    const usedBonus = Math.min(effectiveSpecialAmount, card.overseasBonusCap);
                    const remainingBonusCapacity = Math.max(0, card.overseasBonusCap - usedBonus);
                    remainingBonusAmount = Math.min(remainingAmount, remainingBonusCapacity);
                } else if (card.domesticBonusCap) {
                    const usedBonus = Math.min(effectiveSpecialAmount, card.domesticBonusCap);
                    const remainingBonusCapacity = Math.max(0, card.domesticBonusCap - usedBonus);
                    remainingBonusAmount = Math.min(remainingAmount, remainingBonusCapacity);
                }
                remainingCashback += Math.floor(remainingBonusAmount * bonusRate / 100);
            }
        }
        
        cashbackAmount = specialCashback + basicCashback + bonusCashback + remainingCashback;
        // Fix floating point precision issues
        totalRate = Math.round((bestRate + basicRate + bonusRate) * 10) / 10;
        effectiveAmount = applicableCap; // Keep this for display purposes
    }
    
    return {
        rate: Math.round(totalRate * 10) / 10,
        specialRate: Math.round(bestRate * 10) / 10,
        basicRate: Math.round(card.basicCashback * 10) / 10,
        cashbackAmount: cashbackAmount,
        cap: applicableCap,
        matchedItem: matchedItem,
        matchedCategory: matchedCategory,
        effectiveAmount: effectiveAmount,
        matchedRateGroup: matchedRateGroup
    };
}

// Display calculation results
function displayResults(results, originalAmount, searchedItem, isBasicCashback = false) {
    resultsContainer.innerHTML = '';
    
    if (results.length === 0) {
        // No cards have cashback for this item
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'no-results';
        noResultsDiv.innerHTML = `
            <h3>ç„¡ç¬¦åˆçš„ä¿¡ç”¨å¡</h3>
            <p>æ²’æœ‰ä»»ä½•ä¿¡ç”¨å¡å°ã€Œ${searchedItem}ã€æä¾›ç¾é‡‘å›žé¥‹ã€‚</p>
        `;
        resultsContainer.appendChild(noResultsDiv);
    } else {
        const maxCashback = results[0].cashbackAmount;
        
        results.forEach((result, index) => {
            const cardElement = createCardResultElement(result, originalAmount, searchedItem, index === 0 && maxCashback > 0, isBasicCashback);
            resultsContainer.appendChild(cardElement);
        });
    }
    
    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Display coupon cashback results
function displayCouponCashbacks(amount, merchantValue) {
    couponResultsContainer.innerHTML = '';
    
    // Get cards to check (user selected or all)
    const cardsToCheck = currentUser ? 
        cardsData.cards.filter(card => userSelectedCards.has(card.id)) :
        cardsData.cards;
    
    // Collect all coupon cashbacks that match the merchant
    const matchingCoupons = [];
    
    cardsToCheck.forEach(card => {
        if (card.couponCashbacks) {
            card.couponCashbacks.forEach(coupon => {
                const merchantLower = merchantValue.toLowerCase();
                const couponMerchantLower = coupon.merchant.toLowerCase();
                
                // Check if merchant matches coupon merchant
                if (merchantLower.includes(couponMerchantLower) || 
                    couponMerchantLower.includes(merchantLower)) {
                    matchingCoupons.push({
                        ...coupon,
                        cardName: card.name,
                        cardId: card.id,
                        potentialCashback: Math.floor(amount * coupon.rate / 100)
                    });
                }
            });
        }
    });
    
    // If no matching coupons, hide the section
    if (matchingCoupons.length === 0) {
        couponResultsSection.style.display = 'none';
        return;
    }
    
    // Sort by cashback rate (highest first)
    matchingCoupons.sort((a, b) => b.rate - a.rate);
    
    // Display coupon results
    matchingCoupons.forEach(coupon => {
        const couponElement = createCouponResultElement(coupon, amount);
        couponResultsContainer.appendChild(couponElement);
    });
    
    couponResultsSection.style.display = 'block';
}

// Create coupon result element
function createCouponResultElement(coupon, amount) {
    const couponDiv = document.createElement('div');
    couponDiv.className = 'coupon-item fade-in';
    
    couponDiv.innerHTML = `
        <div class="coupon-header">
            <div class="coupon-merchant">${coupon.cardName}</div>
            <div class="coupon-rate">${coupon.rate}%</div>
        </div>
        <div class="coupon-details">
            <div class="coupon-detail-row">
                <div class="coupon-detail-label">å›žé¥‹é‡‘é¡:</div>
                <div class="coupon-detail-value">NT$${coupon.potentialCashback.toLocaleString()}</div>
            </div>
            <div class="coupon-detail-row">
                <div class="coupon-detail-label">å›žé¥‹æ¶ˆè²»ä¸Šé™:</div>
                <div class="coupon-detail-value">ç„¡ä¸Šé™</div>
            </div>
            <div class="coupon-detail-row">
                <div class="coupon-detail-label">å›žé¥‹æ¢ä»¶:</div>
                <div class="coupon-detail-value">${coupon.conditions}</div>
            </div>
            <div class="coupon-detail-row">
                <div class="coupon-detail-label">æ´»å‹•æœŸé–“:</div>
                <div class="coupon-detail-value">${coupon.period}</div>
            </div>
        </div>
        <div class="coupon-card-name">åŒ¹é…é …ç›®: ${coupon.merchant}</div>
    `;
    
    return couponDiv;
}

// Create card result element
function createCardResultElement(result, originalAmount, searchedItem, isBest, isBasicCashback = false) {
    const cardDiv = document.createElement('div');
    cardDiv.className = `card-result fade-in ${isBest ? 'best-card' : ''} ${result.cashbackAmount === 0 ? 'no-cashback' : ''}`;
    
    const capText = result.cap ? `NT$${result.cap.toLocaleString()}` : 'ç„¡ä¸Šé™';
    const cashbackText = result.cashbackAmount > 0 ? 
                        `NT$${result.cashbackAmount.toLocaleString()}` : 
                        'ç„¡å›žé¥‹';
    
    // Format rate display for complex cards
    let rateDisplay = result.rate > 0 ? `${Math.round(result.rate * 10) / 10}%` : '0%';
    if (result.specialRate && result.basicRate && result.specialRate > 0) {
        // Fix floating point precision issues
        const totalRate = Math.round((result.specialRate + result.basicRate) * 10) / 10;
        const specialRate = Math.round(result.specialRate * 10) / 10;
        const basicRate = Math.round(result.basicRate * 10) / 10;
        rateDisplay = `${totalRate}% (${specialRate}%+åŸºæœ¬${basicRate}%)`;
    }
    
    cardDiv.innerHTML = `
        <div class="card-header">
            <div class="card-name">${result.card.name}</div>
            ${isBest ? '<div class="best-badge">æœ€å„ªå›žé¥‹</div>' : ''}
        </div>
        <div class="card-details">
            <div class="detail-item">
                <div class="detail-label">å›žé¥‹çŽ‡</div>
                <div class="detail-value">${rateDisplay}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">å›žé¥‹é‡'é¡</div>
                <div class="detail-value ${result.cashbackAmount > 0 ? 'cashback-amount' : 'no-cashback-text'}">${cashbackText}</div>
                <div class="cashback-type-info">
                    ${isBasicCashback ? (result.card.basicCashbackType || '群金回饋') : (result.matchedRateGroup && result.matchedRateGroup.cashbackType ? result.matchedRateGroup.cashbackType : '現金回饋')}
                </div>
            </div>
            <div class="detail-item">
                <div class="detail-label">å›žé¥‹æ¶ˆè²»ä¸Šé™</div>
                <div class="detail-value">${capText}</div>
            </div>
        </div>
        <div class="matched-merchant"></div>
    `;
    
    // Set merchant info separately to avoid template literal complexity
    const merchantDiv = cardDiv.querySelector('.matched-merchant');
    if (isBasicCashback) {
        merchantDiv.textContent = '一般消費回饋率';
    } else if (result.matchedItem) {
        let content = `匹配項目: <strong>${result.matchedItem}</strong>`;
        if (result.matchedCategory && result.card.id !== 'cathay-cube') {
            content += ` (類別: ${result.matchedCategory})`;
        }
        if (result.matchedRateGroup) {
            if (result.matchedRateGroup.period) {
                content += `<br><small>活動期間: ${result.matchedRateGroup.period}</small>`;
            }
            if (result.matchedRateGroup.conditions) {
                content += `<br><small>條件: ${result.matchedRateGroup.conditions}</small>`;
            }
        }
        merchantDiv.innerHTML = content;
    } else {
        merchantDiv.textContent = '此卡無此項目回饋';
    }
    
    return cardDiv;
}

// Format currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('zh-TW', {
        style: 'currency',
        currency: 'TWD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

// Authentication setup
function setupAuthentication() {
    console.log('🔐 Setting up authentication...');
    
    // Wait for Firebase to load
    const checkFirebaseReady = () => {
        console.log('🔍 Checking Firebase ready state...');
        
        if (typeof window.firebaseAuth !== 'undefined' && typeof window.db !== 'undefined') {
            console.log('✅ Firebase is ready!');
            auth = window.firebaseAuth;
            db = window.db;
            initializeAuth();
        } else {
            console.log('⏳ Firebase not ready yet, retrying...');
            setTimeout(checkFirebaseReady, 100);
        }
    };
    
    // Start checking immediately
    checkFirebaseReady();
}

function initializeAuth() {
    console.log('🛠️ Initializing authentication...');
    
    const signInBtn = document.getElementById('sign-in-btn');
    const signOutBtn = document.getElementById('sign-out-btn');
    const userInfo = document.getElementById('user-info');
    const userPhoto = document.getElementById('user-photo');
    const userName = document.getElementById('user-name');
    
    // Check if all elements exist
    if (!signInBtn || !signOutBtn || !userInfo) {
        console.error('❌ Authentication elements not found!');
        return;
    }
    
    console.log('✅ Authentication elements found');
    
    // Sign in function
    signInBtn.addEventListener('click', async () => {
        console.log('💆 Sign in button clicked');
        
        // Check if Firebase functions are available
        if (!window.signInWithPopup || !window.googleProvider) {
            console.error('❌ Firebase auth functions not available');
            alert('登入功能不可用，請稍後再試');
            return;
        }
        
        try {
            console.log('🚀 Attempting sign in...');
            const result = await window.signInWithPopup(auth, window.googleProvider);
            console.log('✅ Sign in successful:', result.user.email);
        } catch (error) {
            console.error('❌ Sign in failed:', error);
            alert('登入失敗：' + error.message);
        }
    });
    
    // Sign out function
    signOutBtn.addEventListener('click', async () => {
        try {
            await window.signOut(auth);
            console.log('Sign out successful');
        } catch (error) {
            console.error('Sign out failed:', error);
        }
    });
    
    // Listen for authentication state changes
    window.onAuthStateChanged(auth, (user) => {
        if (user) {
            // User is signed in
            console.log('User signed in:', user);
            currentUser = user;
            signInBtn.style.display = 'none';
            userInfo.style.display = 'inline-flex';
            userPhoto.src = user.photoURL || '';
            userName.textContent = user.displayName || user.email;
            
            // Show manage cards button
            document.getElementById('manage-cards-btn').style.display = 'block';
            
            // Load user's selected cards from localStorage
            loadUserCards();
            
            // Update card chips display
            populateCardChips();
        } else {
            // User is signed out
            console.log('User signed out');
            currentUser = null;
            userSelectedCards.clear();
            signInBtn.style.display = 'inline-block';
            userInfo.style.display = 'none';
            
            // Hide manage cards button
            document.getElementById('manage-cards-btn').style.display = 'none';
            
            // Show all cards when signed out
            populateCardChips();
        }
    });
    
    // Setup manage cards modal
    setupManageCardsModal();
}

// Load user's selected cards from localStorage
function loadUserCards() {
    console.log('📚 Loading user cards, currentUser:', currentUser ? currentUser.email : 'not logged in');
    
    if (!currentUser) {
        console.log('ℹ️ No current user, using all cards');
        userSelectedCards = new Set(cardsData.cards.map(card => card.id));
        console.log('✅ Set all cards for non-logged user:', Array.from(userSelectedCards));
        return;
    }
    
    try {
        const storageKey = `selectedCards_${currentUser.uid}`;
        const savedCards = localStorage.getItem(storageKey);
        
        if (savedCards) {
            userSelectedCards = new Set(JSON.parse(savedCards));
            console.log('✅ Loaded user cards from localStorage:', Array.from(userSelectedCards));
        } else {
            // First time user - select all cards by default
            console.log('🎆 First time user, selecting all cards');
            userSelectedCards = new Set(cardsData.cards.map(card => card.id));
            saveUserCards();
        }
    } catch (error) {
        console.error('❌ Error loading user cards from localStorage:', error);
        // Default to all cards if error
        userSelectedCards = new Set(cardsData.cards.map(card => card.id));
        console.log('🔄 Defaulted to all cards due to error');
    }
}

// Save user's selected cards to localStorage
function saveUserCards() {
    if (!currentUser) {
        console.log('No user logged in, skipping save');
        return;
    }
    
    try {
        const storageKey = `selectedCards_${currentUser.uid}`;
        localStorage.setItem(storageKey, JSON.stringify(Array.from(userSelectedCards)));
        console.log('Saved user cards to localStorage:', Array.from(userSelectedCards));
    } catch (error) {
        console.error('Error saving user cards to localStorage:', error);
        throw error;
    }
}

// Setup manage cards modal
function setupManageCardsModal() {
    const manageBtn = document.getElementById('manage-cards-btn');
    const modal = document.getElementById('manage-cards-modal');
    const closeBtn = document.getElementById('close-modal');
    const cancelBtn = document.getElementById('cancel-cards-btn');
    const saveBtn = document.getElementById('save-cards-btn');
    
    // Open modal
    manageBtn.addEventListener('click', () => {
        if (!currentUser) {
            alert('è«‹å…ˆç™»å…¥æ‰èƒ½ç®¡ç†ä¿¡ç”¨å¡');
            return;
        }
        openManageCardsModal();
    });
    
    // Close modal function
    const closeModal = () => {
        modal.style.display = 'none';
    };
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    
    // Save cards
    saveBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('#cards-selection input[type="checkbox"]');
        const newSelection = new Set();
        
        checkboxes.forEach(checkbox => {
            if (checkbox.checked) {
                newSelection.add(checkbox.value);
            }
        });
        
        // Validate at least one card is selected
        if (newSelection.size === 0) {
            alert('è«‹è‡³å°‘é¸æ“‡ä¸€å¼µä¿¡ç”¨å¡');
            return;
        }
        
        // Update and save
        userSelectedCards = newSelection;
        saveUserCards();
        
        // Update UI immediately
        populateCardChips();
        
        // Close modal
        closeModal();
    });
    
    // Toggle all cards button
    const toggleAllBtn = document.getElementById('toggle-all-cards');
    toggleAllBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('#cards-selection input[type="checkbox"]');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        
        if (allChecked) {
            // Uncheck all
            checkboxes.forEach(checkbox => {
                checkbox.checked = false;
                checkbox.parentElement.classList.remove('selected');
            });
            toggleAllBtn.textContent = 'å…¨é¸';
        } else {
            // Check all
            checkboxes.forEach(checkbox => {
                checkbox.checked = true;
                checkbox.parentElement.classList.add('selected');
            });
            toggleAllBtn.textContent = 'å…¨ä¸é¸';
        }
    });
}

// Open manage cards modal
function openManageCardsModal() {
    const modal = document.getElementById('manage-cards-modal');
    const cardsSelection = document.getElementById('cards-selection');
    
    // Populate cards selection
    cardsSelection.innerHTML = '';
    
    // Sort cards by name
    const sortedCards = [...cardsData.cards].sort((a, b) => a.name.localeCompare(b.name));
    
    sortedCards.forEach(card => {
        const isSelected = userSelectedCards.has(card.id);
        
        const cardDiv = document.createElement('div');
        cardDiv.className = `card-checkbox ${isSelected ? 'selected' : ''}`;
        
        cardDiv.innerHTML = `
            <input type="checkbox" id="card-${card.id}" value="${card.id}" ${isSelected ? 'checked' : ''}>
            <label for="card-${card.id}" class="card-checkbox-label">${card.name}</label>
        `;
        
        // Update visual state on checkbox change
        const checkbox = cardDiv.querySelector('input');
        checkbox.addEventListener('change', () => {
            cardDiv.classList.toggle('selected', checkbox.checked);
        });
        
        cardsSelection.appendChild(cardDiv);
    });
    
    // Update toggle button state
    const toggleAllBtn = document.getElementById('toggle-all-cards');
    const allSelected = sortedCards.every(card => userSelectedCards.has(card.id));
    toggleAllBtn.textContent = allSelected ? 'å…¨ä¸é¸' : 'å…¨é¸';
    
    modal.style.display = 'flex';
}

// Show card detail modal
function showCardDetail(cardId) {
    const card = cardsData.cards.find(c => c.id === cardId);
    if (!card) return;
    
    const modal = document.getElementById('card-detail-modal');
    
    // Update basic information
    document.getElementById('card-detail-title').textContent = card.name + ' è©³æƒ…';
    
    const fullNameLink = document.getElementById('card-full-name-link');
    fullNameLink.textContent = card.fullName || card.name;
    if (card.website) {
        fullNameLink.href = card.website;
    } else {
        fullNameLink.removeAttribute('href');
        fullNameLink.style.textDecoration = 'none';
        fullNameLink.style.color = 'inherit';
    }
    
    // Format the combined annual fee and fee waiver information
    const formatFeeInfo = (card) => {
        const annualFee = card.annualFee || 'ç„¡è³‡æ–™';
        const feeWaiver = card.feeWaiver || 'ç„¡è³‡æ–™';
        
        // Extract fee amount from annualFee string
        const feeMatch = annualFee.match(/(NT\$[\d,]+)|(å…è²»)|(ç„¡å¹´è²»)/);
        let feeText = '';
        
        if (annualFee.includes('é¦–å¹´å…å¹´è²»') || annualFee.includes('é¦–å¹´å…è²»')) {
            feeText = 'å¹´è²»é¦–å¹´å…è²»';
            const nextYearMatch = annualFee.match(/æ¬¡å¹´èµ·.*?(NT\$[\d,]+)/);
            if (nextYearMatch) {
                feeText += `ï¼Œæ¬¡å¹´èµ·${nextYearMatch[1]}`;
            }
        } else if (feeMatch) {
            if (feeMatch[0].includes('å…è²»') || feeMatch[0].includes('ç„¡å¹´è²»')) {
                feeText = 'å¹´è²»å…è²»';
            } else {
                feeText = `å¹´è²»${feeMatch[0]}`;
            }
        } else {
            feeText = `å¹´è²»${annualFee}`;
        }
        
        // Format fee waiver conditions
        let waiverText = '';
        if (feeWaiver && feeWaiver !== 'ç„¡è³‡æ–™') {
            // Split conditions by common delimiters and wrap each in quotes
            const conditions = feeWaiver.split(/[,ï¼Œã€æˆ–]/)
                .map(condition => condition.trim())
                .filter(condition => condition.length > 0)
                .map(condition => `ã€Œ${condition}ã€`);
            
            waiverText = `å…å¹´è²»æ¢ä»¶ç‚º${conditions.join('æˆ–')}`;
        }
        
        return waiverText ? `${feeText}ã€‚${waiverText}ã€‚` : `${feeText}ã€‚`;
    };
    
    const combinedFeeInfo = formatFeeInfo(card);
    document.getElementById('card-annual-fee').textContent = combinedFeeInfo;
    document.getElementById('card-fee-waiver').style.display = 'none'; // Hide the separate fee waiver line
    
    // Update basic cashback
    const basicCashbackDiv = document.getElementById('card-basic-cashback');
    let basicContent = `<div class="cashback-detail-item">`;
    basicContent += `<div class="cashback-rate">åœ‹å…§ä¸€èˆ¬å›žé¥‹: ${card.basicCashback}%</div>`;
    basicContent += `<div class="cashback-condition">æ¶ˆè²»ä¸Šé™: ç„¡ä¸Šé™</div>`;
    
    if (card.overseasCashback) {
        basicContent += `<div class="cashback-rate">æµ·å¤–ä¸€èˆ¬å›žé¥‹: ${card.overseasCashback}%</div>`;
        basicContent += `<div class="cashback-condition">æµ·å¤–æ¶ˆè²»ä¸Šé™: ç„¡ä¸Šé™</div>`;
    }
    
    basicContent += `</div>`;
    
    if (card.domesticBonusRate) {
        basicContent += `<div class="cashback-detail-item">`;
        basicContent += `<div class="cashback-rate">åœ‹å…§åŠ ç¢¼å›žé¥‹: +${card.domesticBonusRate}%</div>`;
        basicContent += `<div class="cashback-condition">æ¶ˆè²»ä¸Šé™: NT$${card.domesticBonusCap?.toLocaleString()}</div>`;
        basicContent += `</div>`;
    }
    
    if (card.overseasBonusRate) {
        basicContent += `<div class="cashback-detail-item">`;
        basicContent += `<div class="cashback-rate">æµ·å¤–åŠ ç¢¼å›žé¥‹: +${card.overseasBonusRate}%</div>`;
        basicContent += `<div class="cashback-condition">æ¶ˆè²»ä¸Šé™: NT$${card.overseasBonusCap?.toLocaleString()}</div>`;
        basicContent += `</div>`;
    }
    
    basicCashbackDiv.innerHTML = basicContent;
    
    // Handle CUBE card level selection
    const cubeLevelSection = document.getElementById('cube-level-section');
    const cubeLevelSelect = document.getElementById('cube-level-select');
    
    if (card.hasLevels && card.id === 'cathay-cube') {
        cubeLevelSection.style.display = 'block';
        
        // Load saved level or default to level1
        const savedLevel = localStorage.getItem(`cubeLevel-${card.id}`) || 'level1';
        cubeLevelSelect.value = savedLevel;
        
        // Add change listener
        cubeLevelSelect.onchange = function() {
            localStorage.setItem(`cubeLevel-${card.id}`, this.value);
            updateCubeSpecialCashback(card);
        };
    } else {
        cubeLevelSection.style.display = 'none';
    }
    
    // Update special cashback
    const specialCashbackDiv = document.getElementById('card-special-cashback');
    let specialContent = '';
    
    if (card.hasLevels && card.id === 'cathay-cube') {
        specialContent = generateCubeSpecialContent(card);
    } else if (card.cashbackRates && card.cashbackRates.length > 0) {
        card.cashbackRates.forEach((rate, index) => {
            // è·³éŽéœ€è¦éš±è—çš„é …ç›®
            if (rate.hideInDisplay) {
                return;
            }
            
            specialContent += `<div class="cashback-detail-item">`;
            
            // å›žé¥‹çŽ‡å’Œæ˜¯å¦å«ä¸€èˆ¬å›žé¥‹çš„èªªæ˜Ž
            const includesBasic = rate.rate > card.basicCashback;
            if (includesBasic) {
                specialContent += `<div class="cashback-rate">${rate.rate}% å›žé¥‹ (å«ä¸€èˆ¬å›žé¥‹${card.basicCashback}%)</div>`;
            } else {
                specialContent += `<div class="cashback-rate">${rate.rate}% å›žé¥‹</div>`;
            }
            
            // æ¶ˆè²»ä¸Šé™
            if (rate.cap) {
                specialContent += `<div class="cashback-condition">æ¶ˆè²»ä¸Šé™: NT$${rate.cap.toLocaleString()}</div>`;
            } else {
                specialContent += `<div class="cashback-condition">æ¶ˆè²»ä¸Šé™: ç„¡ä¸Šé™</div>`;
            }
            
            if (rate.category) {
                specialContent += `<div class="cashback-condition">é¡žåˆ¥: ${rate.category}</div>`;
            }
            
            if (rate.conditions) {
                specialContent += `<div class="cashback-condition">æ¢ä»¶: ${rate.conditions}</div>`;
            }
            
            if (rate.period) {
                specialContent += `<div class="cashback-condition">æ´»å‹•æœŸé–“: ${rate.period}</div>`;
            }
            
            if (rate.items && rate.items.length > 0) {
                const merchantsId = `merchants-${card.id}-${index}`;
                const showAllId = `show-all-${card.id}-${index}`;
                
                if (rate.items.length <= 20) {
                    // å°‘æ–¼20å€‹ç›´æŽ¥é¡¯ç¤ºå…¨éƒ¨
                    const merchantsList = rate.items.join('ã€');
                    specialContent += `<div class="cashback-merchants">é©ç”¨é€šè·¯: ${merchantsList}</div>`;
                } else {
                    // è¶…éŽ20å€‹é¡¯ç¤ºå¯å±•é–‹çš„åˆ—è¡¨
                    const initialList = rate.items.slice(0, 20).join('ã€');
                    const fullList = rate.items.join('ã€');
                    
                    specialContent += `<div class="cashback-merchants">`;
                    specialContent += `é©ç”¨é€šè·¯: <span id="${merchantsId}">${initialList}</span>`;
                    specialContent += `<button class="show-more-btn" id="${showAllId}" data-merchants-id="${merchantsId}" data-initial-list="${initialList}" data-full-list="${fullList}">... 顯示全部${rate.items.length}個</button>`;
                    specialContent += `</div>`;
                }
            }
            
            specialContent += `</div>`;
        });
    } else {
        specialContent = '<div class="cashback-detail-item">ç„¡æŒ‡å®šé€šè·¯å›žé¥‹</div>';
    }
    
    specialCashbackDiv.innerHTML = specialContent;
    
    // Update coupon cashback
    const couponSection = document.getElementById('card-coupon-section');
    const couponCashbackDiv = document.getElementById('card-coupon-cashback');
    
    if (card.couponCashbacks && card.couponCashbacks.length > 0) {
        let couponContent = '';
        card.couponCashbacks.forEach(coupon => {
            couponContent += `<div class="cashback-detail-item">`;
            couponContent += `<div class="cashback-rate">${coupon.merchant}: ${coupon.rate}% å›žé¥‹</div>`;
            couponContent += `<div class="cashback-condition">æ¢ä»¶: ${coupon.conditions}</div>`;
            couponContent += `<div class="cashback-condition">æ´»å‹•æœŸé–“: ${coupon.period}</div>`;
            couponContent += `</div>`;
        });
        couponCashbackDiv.innerHTML = couponContent;
        couponSection.style.display = 'block';
    } else {
        couponSection.style.display = 'none';
    }
    
    // Load and setup user notes
    currentNotesCardId = card.id;
    const notesTextarea = document.getElementById('user-notes-input');
    const saveIndicator = document.getElementById('save-indicator');
    
    // è®€å–ç•¶å‰ç­†è¨˜
    loadUserNotes(card.id).then(notes => {
        notesTextarea.value = notes;
    });
    
    // è¨­ç½®è¼¸å…¥ç›£è½
    notesTextarea.oninput = (e) => {
        const notes = e.target.value;
        
        // è‡ªå‹•æœ¬åœ°å‚™ä»½
        autoBackupNotes(card.id, notes);
        
        // æ›´æ–°æŒ‰éˆ•ç‹€æ…‹
        updateSaveButtonState(card.id, notes);
    };
    
    // è¨­ç½®å„²å­˜æŒ‰éˆ•ç›£è½
    const saveBtn = document.getElementById('save-notes-btn');
    saveBtn.onclick = () => {
        const currentNotes = notesTextarea.value;
        saveUserNotes(card.id, currentNotes);
    };
    
    // è¨­ç½®å…å¹´è²»ç‹€æ…‹åŠŸèƒ½
    setupFeeWaiverStatus(card.id);
    
    // è¨­ç½®çµå¸³æ—¥æœŸåŠŸèƒ½
    setupBillingDates(card.id);
    
    // Show modal
    modal.style.display = 'flex';
    
    // Setup event delegation for show-more buttons
    modal.addEventListener('click', (e) => {
        if (e.target.classList.contains('show-more-btn')) {
            const buttonElement = e.target;
            const merchantsId = buttonElement.dataset.merchantsId;
            const initialList = buttonElement.dataset.initialList;
            const fullList = buttonElement.dataset.fullList;
            const merchantsElement = document.getElementById(merchantsId);
            
            if (!merchantsElement) return;
            
            const isExpanded = buttonElement.textContent.includes('收起');
            
            if (isExpanded) {
                // 收起
                merchantsElement.textContent = initialList;
                const totalCount = fullList.split('、').length;
                buttonElement.textContent = `... 顯示全部${totalCount}個`;
            } else {
                // 展開
                merchantsElement.textContent = fullList;
                buttonElement.textContent = '收起';
            }
        }
    });
    
    // Setup close events
    const closeBtn = document.getElementById('close-card-detail');
    const closeModal = () => {
        modal.style.display = 'none';
        currentNotesCardId = null;
    };
    
    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

// Generate CUBE special content based on selected level
function generateCubeSpecialContent(card) {
    const selectedLevel = document.getElementById('cube-level-select').value;
    const levelSettings = card.levelSettings[selectedLevel];
    let content = '';
    
    // Special categories (çŽ©æ•¸ä½ã€æ¨‚é¥—è³¼ã€è¶£æ—…è¡Œ)
    content += `<div class="cashback-detail-item">`;
    content += `<div class="cashback-rate">${levelSettings.specialRate}% å›žé¥‹ (çŽ©æ•¸ä½ã€æ¨‚é¥—è³¼ã€è¶£æ—…è¡Œ)</div>`;
    content += `<div class="cashback-condition">æ¶ˆè²»ä¸Šé™: ç„¡ä¸Šé™</div>`;
    
    const merchantsList = card.specialItems.join('ã€');
    if (card.specialItems.length <= 30) {
        content += `<div class="cashback-merchants">é©ç”¨é€šè·¯: ${merchantsList}</div>`;
    } else {
        const initialList = card.specialItems.slice(0, 30).join('ã€');
        const fullList = merchantsList;
        const merchantsId = `cube-merchants-${selectedLevel}`;
        const showAllId = `cube-show-all-${selectedLevel}`;
        
        content += `<div class="cashback-merchants">`;
        content += `é©ç”¨é€šè·¯: <span id="${merchantsId}">${initialList}</span>`;
        content += `<button class="show-more-btn" id="${showAllId}" data-merchants-id="${merchantsId}" data-initial-list="${initialList}" data-full-list="${fullList}">... 顯示全部${card.specialItems.length}個</button>`;
        content += `</div>`;
    }
    content += `</div>`;
    
    // Other categories (2%)
    content += `<div class="cashback-detail-item">`;
    content += `<div class="cashback-rate">${levelSettings.generalRate}% å›žé¥‹ (å…¶ä»–é€šè·¯)</div>`;
    content += `<div class="cashback-condition">æ¶ˆè²»ä¸Šé™: ç„¡ä¸Šé™</div>`;
    content += `<div class="cashback-merchants">é©ç”¨é€šè·¯: é™¤ä¸Šè¿°ç‰¹æ®Šé€šè·¯å¤–çš„æ‰€æœ‰æ¶ˆè²»</div>`;
    content += `</div>`;
    
    return content;
}

// Update CUBE special cashback when level changes
function updateCubeSpecialCashback(card) {
    const specialCashbackDiv = document.getElementById('card-special-cashback');
    const newContent = generateCubeSpecialContent(card);
    specialCashbackDiv.innerHTML = newContent;
}

// åˆ‡æ›é€šè·¯é¡¯ç¤ºå±•é–‹/æ”¶èµ·
function toggleMerchants(merchantsId, buttonId, shortList, fullList) {
    const merchantsElement = document.getElementById(merchantsId);
    const buttonElement = document.getElementById(buttonId);
    
    if (!merchantsElement || !buttonElement) return;
    
    const isExpanded = buttonElement.textContent.includes('æ”¶èµ·');
    
    if (isExpanded) {
        // æ”¶èµ·
        merchantsElement.textContent = shortList;
        const totalCount = fullList.split('ã€').length;
        buttonElement.textContent = `... é¡¯ç¤ºå…¨éƒ¨${totalCount}å€‹`;
    } else {
        // å±•é–‹
        merchantsElement.textContent = fullList;
        buttonElement.textContent = 'æ”¶èµ·';
    }
}

// ç”¨æˆ¶ç­†è¨˜ç›¸é—œåŠŸèƒ½
let currentNotesCardId = null;
let lastSavedNotes = new Map(); // è¨˜éŒ„æ¯å¼µå¡æœ€å¾Œå„²å­˜çš„å…§å®¹

// è®€å–ç”¨æˆ¶ç­†è¨˜ (è¨»: ç­†è¨˜åƒ…ä¾è³´cardIdï¼Œèˆ‡userSelectedCardsç‹€æ…‹ç„¡é—œ)
async function loadUserNotes(cardId) {
    const cacheKey = auth.currentUser ? `notes_${auth.currentUser.uid}_${cardId}` : `notes_${cardId}`;
    
    if (!auth.currentUser) {
        const localNotes = localStorage.getItem(cacheKey) || '';
        lastSavedNotes.set(cardId, localNotes);
        return localNotes;
    }
    
    try {
        const docRef = window.doc ? window.doc(db, 'userNotes', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.getDoc) throw new Error('Firestore not available');
        const docSnap = await window.getDoc(docRef);
        const notes = docSnap.exists() ? docSnap.data().notes : '';
        
        // æ›´æ–°æœ¬åœ°å¿«å–å’Œè¨˜éŒ„
        localStorage.setItem(cacheKey, notes);
        lastSavedNotes.set(cardId, notes);
        
        return notes;
    } catch (error) {
        console.log('è®€å–ç­†è¨˜å¤±æ•—ï¼Œä½¿ç”¨æœ¬åœ°å¿«å–:', error);
        const localNotes = localStorage.getItem(cacheKey) || '';
        lastSavedNotes.set(cardId, localNotes);
        return localNotes;
    }
}

// æœ¬åœ°å„²å­˜ï¼ˆè‡ªå‹•å‚™ä»½ï¼‰
function autoBackupNotes(cardId, notes) {
    const cacheKey = auth.currentUser ? `notes_${auth.currentUser.uid}_${cardId}` : `notes_${cardId}`;
    localStorage.setItem(cacheKey, notes);
}

// æ‰‹å‹•å„²å­˜ç­†è¨˜
async function saveUserNotes(cardId, notes) {
    const saveBtn = document.getElementById('save-notes-btn');
    const saveIndicator = document.getElementById('save-indicator');
    const btnText = document.querySelector('.btn-text');
    const btnIcon = document.querySelector('.btn-icon');
    
    if (!auth.currentUser) {
        // æœªç™»å…¥æ™‚åƒ…å„²å­˜åœ¨æœ¬åœ°
        autoBackupNotes(cardId, notes);
        lastSavedNotes.set(cardId, notes);
        
        // æ›´æ–°æŒ‰éˆ•ç‹€æ…‹
        saveBtn.disabled = true;
        saveIndicator.textContent = 'å·²å„²å­˜åœ¨æœ¬åœ° (æœªç™»å…¥)';
        saveIndicator.style.color = '#6b7280';
        return true;
    }
    
    try {
        // æ›´æ–°æŒ‰éˆ•ç‚ºå„²å­˜ä¸­ç‹€æ…‹
        saveBtn.className = 'save-notes-btn saving';
        saveBtn.disabled = true;
        btnIcon.textContent = 'â³';
        btnText.textContent = 'å„²å­˜ä¸­...';
        saveIndicator.textContent = '';
        
        const docRef = window.doc ? window.doc(db, 'userNotes', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.setDoc) throw new Error('Firestore not available');
        await window.setDoc(docRef, {
            notes: notes,
            updatedAt: new Date(),
            cardId: cardId
        });
        
        // ä¹Ÿå„²å­˜åœ¨æœ¬åœ°ä½œç‚ºå¿«å–
        autoBackupNotes(cardId, notes);
        lastSavedNotes.set(cardId, notes);
        
        // æˆåŠŸç‹€æ…‹
        saveBtn.className = 'save-notes-btn success';
        btnIcon.textContent = 'âœ“';
        btnText.textContent = 'å·²å„²å­˜';
        saveIndicator.textContent = 'âœ“ é›²ç«¯åŒæ­¥æˆåŠŸ';
        saveIndicator.style.color = '#10b981';
        
        // 2ç§’å¾Œæ¢å¾©æ­£å¸¸ç‹€æ…‹
        setTimeout(() => {
            saveBtn.className = 'save-notes-btn';
            saveBtn.disabled = true; // æ²’æœ‰è®Šæ›´æ™‚ä¿æŒç¦ç”¨
            btnIcon.textContent = 'ðŸ’¾';
            btnText.textContent = 'å„²å­˜ç­†è¨˜';
            saveIndicator.textContent = '';
        }, 2000);
        
        return true;
        
    } catch (error) {
        console.error('é›²ç«¯å„²å­˜å¤±æ•—:', error);
        
        // å¤±æ•—æ™‚ä»ç„¶å„²å­˜åœ¨æœ¬åœ°
        autoBackupNotes(cardId, notes);
        
        // éŒ¯èª¤ç‹€æ…‹
        saveBtn.className = 'save-notes-btn';
        saveBtn.disabled = false; // å¯ä»¥å†æ¬¡å˜—è©¦
        btnIcon.textContent = 'âš ï¸';
        btnText.textContent = 'é‡è©¦å„²å­˜';
        saveIndicator.textContent = 'é›²ç«¯å„²å­˜å¤±æ•—ï¼Œå·²æœ¬åœ°å„²å­˜';
        saveIndicator.style.color = '#dc2626';
        
        // 5ç§’å¾Œæ¢å¾©
        setTimeout(() => {
            btnIcon.textContent = 'ðŸ’¾';
            btnText.textContent = 'å„²å­˜ç­†è¨˜';
            saveIndicator.textContent = '';
        }, 5000);
        
        return false;
    }
}

// æª¢æŸ¥ç­†è¨˜æ˜¯å¦æœ‰è®Šæ›´
function hasNotesChanged(cardId, currentNotes) {
    const lastSaved = lastSavedNotes.get(cardId) || '';
    return currentNotes !== lastSaved;
}

// æ›´æ–°å„²å­˜æŒ‰éˆ•ç‹€æ…‹
function updateSaveButtonState(cardId, currentNotes) {
    const saveBtn = document.getElementById('save-notes-btn');
    if (!saveBtn) return;
    
    const hasChanged = hasNotesChanged(cardId, currentNotes);
    saveBtn.disabled = !hasChanged;
    
    if (hasChanged && !saveBtn.className.includes('saving')) {
        saveBtn.className = 'save-notes-btn';
    }
}

// å…å¹´è²»ç‹€æ…‹ç›¸é—œåŠŸèƒ½

// è®€å–å…å¹´è²»ç‹€æ…‹
async function loadFeeWaiverStatus(cardId) {
    if (!auth.currentUser) return false;
    
    try {
        const docRef = window.doc ? window.doc(db, 'feeWaiverStatus', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.getDoc) throw new Error('Firestore not available');
        const docSnap = await window.getDoc(docRef);
        return docSnap.exists() ? docSnap.data().isWaived : false;
    } catch (error) {
        console.log('è®€å–å…å¹´è²»ç‹€æ…‹å¤±æ•—:', error);
        const localKey = `feeWaiver_${auth.currentUser?.uid || 'local'}_${cardId}`;
        return localStorage.getItem(localKey) === 'true';
    }
}

// å„²å­˜å…å¹´è²»ç‹€æ…‹
async function saveFeeWaiverStatus(cardId, isWaived) {
    const localKey = `feeWaiver_${auth.currentUser?.uid || 'local'}_${cardId}`;
    localStorage.setItem(localKey, isWaived.toString());
    
    if (!auth.currentUser) return;
    
    try {
        const docRef = window.doc ? window.doc(db, 'feeWaiverStatus', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.setDoc) throw new Error('Firestore not available');
        await window.setDoc(docRef, {
            isWaived: isWaived,
            updatedAt: new Date(),
            cardId: cardId
        });
        console.log('å…å¹´è²»ç‹€æ…‹å·²åŒæ­¥è‡³é›²ç«¯');
    } catch (error) {
        console.error('é›²ç«¯å„²å­˜å…å¹´è²»ç‹€æ…‹å¤±æ•—:', error);
    }
}

// è¨­ç½®å…å¹´è²»ç‹€æ…‹åŠŸèƒ½
async function setupFeeWaiverStatus(cardId) {
    const checkbox = document.getElementById('fee-waiver-checked');
    if (!checkbox) return;
    
    // è®€å–ç•¶å‰ç‹€æ…‹
    const isWaived = await loadFeeWaiverStatus(cardId);
    checkbox.checked = isWaived;
    
    // è¨­ç½®è®Šæ›´ç›£è½
    checkbox.onchange = (e) => {
        const newStatus = e.target.checked;
        saveFeeWaiverStatus(cardId, newStatus);
        
        // æ›´æ–°è¦–è¦ºæç¤º (å¯é¸)
        const checkboxLabel = e.target.parentElement.querySelector('.checkbox-label');
        if (newStatus) {
            checkboxLabel.style.color = '#10b981';
            setTimeout(() => {
                checkboxLabel.style.color = '';
            }, 1000);
        }
    };
}

// çµå¸³æ—¥æœŸç›¸é—œåŠŸèƒ½

// è®€å–çµå¸³æ—¥æœŸ
async function loadBillingDates(cardId) {
    const defaultDates = { billingDate: '', statementDate: '' };
    
    if (!auth.currentUser) {
        const localKey = `billingDates_local_${cardId}`;
        const saved = localStorage.getItem(localKey);
        return saved ? JSON.parse(saved) : defaultDates;
    }
    
    try {
        const docRef = window.doc ? window.doc(db, 'billingDates', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.getDoc) throw new Error('Firestore not available');
        const docSnap = await window.getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                billingDate: data.billingDate || '',
                statementDate: data.statementDate || ''
            };
        }
        return defaultDates;
    } catch (error) {
        console.log('è®€å–çµå¸³æ—¥æœŸå¤±æ•—:', error);
        const localKey = `billingDates_${auth.currentUser?.uid || 'local'}_${cardId}`;
        const saved = localStorage.getItem(localKey);
        return saved ? JSON.parse(saved) : defaultDates;
    }
}

// å„²å­˜çµå¸³æ—¥æœŸ
async function saveBillingDates(cardId, billingDate, statementDate) {
    const dateData = {
        billingDate: billingDate || '',
        statementDate: statementDate || ''
    };
    
    const localKey = `billingDates_${auth.currentUser?.uid || 'local'}_${cardId}`;
    localStorage.setItem(localKey, JSON.stringify(dateData));
    
    if (!auth.currentUser) return;
    
    try {
        const docRef = window.doc ? window.doc(db, 'billingDates', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.setDoc) throw new Error('Firestore not available');
        await window.setDoc(docRef, {
            ...dateData,
            updatedAt: new Date(),
            cardId: cardId
        });
        console.log('çµå¸³æ—¥æœŸå·²åŒæ­¥è‡³é›²ç«¯');
    } catch (error) {
        console.error('é›²ç«¯å„²å­˜çµå¸³æ—¥æœŸå¤±æ•—:', error);
    }
}

// 設置結賬日期功能
async function setupBillingDates(cardId) {
    const billingInput = document.getElementById('billing-date');
    const birthMonthInput = document.getElementById('birth-month');
    
    if (!billingInput || !birthMonthInput) return;
    
    // 讀取已儲存的日期和生日月
    const savedDates = await loadBillingDates(cardId);
    billingInput.value = savedDates.billingDate;
    
    // 讀取生日月
    const savedBirthMonth = localStorage.getItem(`birthMonth-${cardId}`);
    if (savedBirthMonth) {
        birthMonthInput.value = savedBirthMonth;
    }
    
    // ç‚ºæœ‰å€¼çš„è¼¸å…¥æ¡†åŠ ä¸Šè¦–è¦ºå¼·èª¿
    const updateInputAppearance = (input) => {
        if (input.value.trim() !== '') {
            input.style.borderColor = '#10b981';
            input.style.background = 'white';
            input.style.fontWeight = '600';
        }
    };
    
    updateInputAppearance(billingInput);
    updateInputAppearance(birthMonthInput);
    
    // 儲存功能
    const saveDates = () => {
        const billing = billingInput.value;
        saveBillingDates(cardId, billing, '');
        
        // 更新視覺狀態
        updateInputAppearance(billingInput);
    };
    
    // 儲存生日月
    const saveBirthMonth = () => {
        const birthMonth = birthMonthInput.value;
        if (birthMonth) {
            localStorage.setItem(`birthMonth-${cardId}`, birthMonth);
        } else {
            localStorage.removeItem(`birthMonth-${cardId}`);
        }
        updateInputAppearance(birthMonthInput);
    };
    
    // 設置變更監聽
    billingInput.onchange = saveDates;
    billingInput.onblur = saveDates;
    birthMonthInput.onchange = saveBirthMonth;
    birthMonthInput.onblur = saveBirthMonth;
    
    // 輸入驗證
    billingInput.oninput = (e) => {
        let value = parseInt(e.target.value);
        if (value > 31) e.target.value = 31;
        if (value < 1 && e.target.value !== '') e.target.value = 1;
    };
    
    birthMonthInput.oninput = (e) => {
        let value = parseInt(e.target.value);
        if (value > 12) e.target.value = 12;
        if (value < 1 && e.target.value !== '') e.target.value = 1;
    };
}
