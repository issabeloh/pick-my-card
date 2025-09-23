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
      "name": "台新Richart卡",
      "fullName": "台新銀行Richart信用卡",
      "basicCashback": 0.3,
      "annualFee": "正卡每卡年NT$1,500、附卡每卡每年NT$750",
      "feeWaiver": "首年免年費，次年起使用台新電子/行動簡訊帳單且生效，享免年費優惠",
      "website": "https://www.taishinbank.com.tw/TSB/personal/credit/intro/overview/cg047/card001/",
      "cashbackRates": [
        {
          "rate": 3.8,
          "cap": 480000,
          "items": ["台灣Pay場域", "超商（單筆限額最高 NT3,000元，且不含代收水電稅費/禮物卡/儲值）"]
        },
        {
          "rate": 3.3,
          "cap": 300000,
          "capDescription": "您的永久信用額度+NT300,000",
          "items": [
            "華航", "長榮", "星宇", "虎航", "國泰航空", "華信", "立榮", "klook", "kkday", "airsim", "agoda", "booking.com", "trip.com", "airbnb", "hotels.com", "expedia", "雄獅旅遊", "易遊網", "東南旅遊", "海外實體", "海外線上", "蝦皮", "momo", "酷澎", "coupang", "pchome", "yahoo", "amazon", "東森", "博客來", "richart mart", "hahow", "pressplay", "amazing talker", "udemy", "kobo", "readmoo", "uniqlo", "gu", "zara", "net", "lativ", "gap", "uber eats", "foodpanda", "中油直營", "台亞直營", "全國加油", "源點evoasis", "華城電能evalue", "拓元售票", "kktix", "年代售票", "寬宏售票", "opentix兩廳院文化生活", "晶華國際酒店集團", "台灣萬豪國際集團旗下飯店", "煙波飯店", "老爺酒店集團", "福華集團", "漢來飯店事業群", "台北君悅酒店", "高雄洲際酒店", "礁溪寒沐", "義大遊樂世界", "麗寶樂園", "六福村主題遊樂園", "九族文化村", "劍湖山世界主題遊樂園", "x-park", "國立海洋生物博物館", "遠雄海洋公園", "大魯閣", "小人國主題樂園", "全台餐飲新光三越", "遠東sogo", "廣三sogo", "遠東百貨", "微風", "台北101", "遠東巨城", "南紡購物中心", "漢神百貨", "漢神巨蛋", "誠品生活", "mitsui shopping park", "lalaport", "mitsui outlet park", "華泰名品城", "skm park outlets", "ikea", "特力屋", "hola", "宜得利", "瑪黑家居", "7-11", "全家", "家樂福", "大買家", "臺鐵", "高鐵", "台灣大車隊", "linego", "yoxi", "uber", "嘟嘟房", "autopass", "城市車旅", "vivipark", "uspace", "udrive", "irent", "和運租車", "格上租車"
          ]
        }
      ]
    },
    {
      "id": "yushan-unicard",
      "name": "玉山Uni卡",
      "fullName": "玉山銀行UniCard信用卡",
      "basicCashback": 1.0,
      "annualFee": "御璽卡NT$3,000",
      "feeWaiver": "首年免年費，每年有消費年年免年費，或使用玉山帳戶自動扣繳信用卡款或帳單e化期間享免年費優惠",
      "website": "https://www.esunbank.com/zh-tw/personal/credit-card/intro/bank-card/unicard",
      "cashbackRates": [
        {
          "rate": 3.5,
          "cap": 20000,
          "items": [
            "linepay", "街口", "悠遊付", "全盈支付", "全支付", "橘子支付", "momo購物網", "蝦皮購物", "淘寶", "coupang", "東森購物", "博客來", "新光三越", "台北101", "華泰名品城", "三井outlet", "京站", "美麗華", "秀泰生活", "lalaport", "統領廣場", "采盟", "昇恆昌", "太平洋百貨", "統一時代百貨", "遠東百貨", "遠東sogo", "遠東巨城", "大遠百", "漢神百貨", "微風廣場", "微風信義", "微風南京", "微風南山", "微風台北車站", "誠品生活", "誠品線上", "誠品書店", "家樂福", "屈臣氏", "特力屋", "hola", "hoi好好生活", "uniqlo", "net", "大樹藥局", "丁丁藥妝", "uber eats", "ubereats", "foodpanda", "eztable", "王品瘋美食", "摩斯", "路易莎", "饗食天堂", "果然匯", "加集", "開飯", "響泰多", "真珠", "瓦城", "非常泰", "時時香", "1010湘", "大心", "乾杯燒肉居酒屋", "老乾杯", "漢來海港", "島語", "漢來蔬食", "漢來名人坊", "東方樓", "漢來上海湯包", "溜溜酸菜", "魚專賣店", "上菜片皮鴨", "翠園", "漢來軒", "焰", "pavo", "精瀲海鮮火鍋", "日本料理弁慶", "福園台菜海鮮", "日日烘焙坊", "糕餅小舖", "台北漢來大廳酒廊", "hi lai cafe", "台灣中油", "台灣大車隊", "台鐵", "高鐵", "yoxi", "桃園機場捷運", "中華航空", "長榮航空", "日本航空", "台灣虎航", "樂桃航空", "酷航", "立榮航空", "華信航空", "trip.com", "booking.com", "hotels.com", "asiayo", "expedia", "kkday", "klook", "雄獅旅", "可樂旅", "東南旅行社", "apple直營", "小米台灣", "全國電子", "燦坤", "迪卡儂", "寵物公園", "youbike 2.0"
          ]
        }
      ]
    },
    {
      "id": "cathay-cube",
      "name": "國泰CUBE卡",
      "fullName": "國泰世華CUBE信用卡",
      "basicCashback": 0.3,
      "annualFee": "首年免年費，次年起年費NT$1,800",
      "feeWaiver": "申辦電子帳單、前年度消費12次、前一年累積消費達18萬(三擇一)即可減免年費",
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
        "chatgpt", "canva", "claude", "cursor", "duolingo", "gamma", "gemini", "notion", "perplexity", "speak", "apple 媒體服務", "google play", "disney+", "netflix", "spotify", "kkbox", "youtube premium", "max", "蝦皮購物", "momo購物網", "pchome 24h購物", "小樹購", "coupang 酷澎", "淘寶/天貓", "遠東sogo百貨", "遠東garden city", "太平洋百貨", "新光三越", "skm park", "bellavita", "微風廣場", "遠東百貨", "big city遠東巨城購物中心", "誠品生活", "環球購物中心", "citylink", "統一時代台北店", "台北101", "att 4 fun", "明曜百貨", "京站", "美麗華", "大葉高島屋", "比漾廣場", "大江國際購物中心", "中友百貨", "廣三sogo", "tiger city", "勤美誠品綠園道", "大魯閣新時代", "耐斯廣場", "南紡購物中心", "夢時代", "漢神百貨", "漢神巨蛋", "mitsui outlet park", "mitsui shopping park lalaport", "義大世界購物廣場", "華泰名品城", "義享天地", "麗寶outlet mall", "秀泰生活", "台茂購物中心", "新月廣場", "三創生活", "宏匯廣場", "noke忠泰樂生活", "uber eats", "foodpanda", "國內餐飲", "麥當勞", "康是美", "屈臣氏", "大阪萬國博覽會官網", "surutto qrtto官網", "大阪美食expo", "海外實體消費", "東京迪士尼樂園", "東京華納兄弟哈利波特影城", "大阪環球影城", "apple錢包指定交通卡", "uber", "grab", "台灣高鐵", "yoxi", "台灣大車隊", "irent", "和運租車", "格上租車", "中華航空", "長榮航空", "星宇航空", "台灣虎航", "國泰航空", "樂桃航空", "阿聯酋航空", "酷航", "捕星航空", "日本航空", "ana全日空", "亞洲航空", "聯合航空", "新加坡航空", "越捷航空", "大韓航空", "達美航空", "土耳其航空", "卡達航空", "法國航空", "星野集團", "全球迪士尼飯店", "東橫 inn", "國內飯店住宿", "kkday", "agoda", "klook", "airbnb", "booking.com", "trip.com", "eztravel易遊網", "雄獅旅遊", "可樂旅遊", "東南旅遊", "五福旅遊", "燦星旅遊", "山富旅遊", "長汎假期", "鳳凰旅行社", "ezfly易飛網", "理想旅遊", "永利旅行社", "三賀旅行社", "家樂福", "lopia台灣", "全聯福利中心", "台灣中油直營站", "7-11", "全家", "ikea", "linepay"
      ],
      "cashbackRates": [],
      "couponCashbacks": [
        {
          "merchant": "大丸福岡天神店",
          "rate": 4.5,
          "conditions": "需透過CUBE App領取優惠券",
          "period": "2025/07/01-2025/12/31"
        },
        {
          "merchant": "MITSUI木更津港高臺",
          "rate": 6.3,
          "conditions": "需透過CUBE App領取優惠券",
          "period": "2025/07/07-2025/10/31"
        },
        {
          "merchant": "星巴克線上/自動儲值",
          "rate": 8.0,
          "conditions": "需透過CUBE App領取優惠券",
          "period": "2025/07/01-2025/12/31"
        },
        {
          "merchant": "昇恆昌",
          "rate": 3.0,
          "conditions": "需透過CUBE App領取優惠券，單筆消費滿NT$300",
          "period": "2025/09/17-2025/12/31"
        },
        {
          "merchant": "台北和逸飯店",
          "rate": 8.0,
          "conditions": "需透過CUBE App領取優惠券",
          "period": "2025/04/01-2025/09/30"
        },
        {
          "merchant": "大樹藥局",
          "rate": 5.0,
          "conditions": "需透過CUBE App領取優惠券",
          "period": "2025/09/01-2025/09/30"
        },
        {
          "merchant": "蘇軒飯店",
          "rate": 11.0,
          "conditions": "需透過CUBE App領取優惠券",
          "period": "2025/04/01-2025/09/30"
        },
        {
          "merchant": "全球連流車",
          "rate": 3.8,
          "conditions": "需透過CUBE App領取優惠券",
          "period": "2025/01/01-2025/12/31"
        },
        {
          "merchant": "桃園捷運機場",
          "rate": 5.0,
          "conditions": "需透過CUBE App領取優惠券",
          "period": "2025/07/01-2025/09/30"
        },
        {
          "merchant": "Hotels.com",
          "rate": 5.0,
          "conditions": "需透過CUBE App領取優惠券",
          "period": "2025/03/15-2025/12/31"
        },
        {
          "merchant": "Expedia",
          "rate": 5.0,
          "conditions": "需透過CUBE App領取優惠券",
          "period": "2024/08/31-2025/12/31"
        },
        {
          "merchant": "屈臣氏官方網路商店",
          "rate": 2.0,
          "conditions": "需透過CUBE App領取優惠券，需註冊",
          "period": "2025/07/01-2025/12/31"
        },
        {
          "merchant": "韓國實體消費",
          "rate": 5.0,
          "conditions": "需透過CUBE App領取優惠券，實體NT$50,000或網路NT$2,000消費門檻",
          "period": "2025/09/17-2025/12/31"
        },
        {
          "merchant": "CASETIFY台灣官網",
          "rate": 3.5,
          "conditions": "需透過CUBE App領取優惠券",
          "period": "2025/09/11-2025/11/30"
        }
      ]
    },
    {
      "id": "sinopac-sport",
      "name": "永豐Sport卡",
      "fullName": "永豐銀行Sport信用卡",
      "basicCashback": 1.0,
      "basicConditions": "汗水不白流APP有運動數據",
      "annualFee": "首年免年費，次年起年費NT$3,000",
      "feeWaiver": "申請信用卡電子化帳單（電子帳單/行動帳單）且取消實體帳單，或(鑽金卡Visa/Mastercard)前一年刷滿3.6萬元或12筆消費；(御璽卡Titanium/Signature)前一年刷滿12萬元或12筆消費",
      "website": "https://bank.sinopac.com/sinopacBT/personal/credit-card/introduction/bankcard/sportcard.html",
      "cashbackRates": [
        {
          "rate": 1.0,
          "cap": 5000,
          "period": "2025/07/01-2025/12/31",
          "conditions": "當月APP數據達10,000打卡或Apple Watch圓滿劃圈１０次，並設定永豐帳戶自動扣繳信用卡帳款",
          "items": [
            "一般消費"
          ]
        },
        {
          "rate": 4.0,
          "cap": 7500,
          "period": "2025/07/01-2025/12/31",
          "conditions": "當月APP數據達10,000打卡或Apple Watch圓滿劃圈１０次，並設定永豐帳戶自動扣繳信用卡帳款",
          "items": [
            "world gym", "健身工廠", "true yoga", "curves", "運動中心", "anytime fitness", "屈臣氏", "康是美", "寶雅", "好心肝", "杏一", "大樹藥局", "丁丁藥局", "新高橋藥局", "app store", "google play", "nintendo", "playstation", "steam", "apple pay", "google pay", "samsung pay", "garmin pay"
          ]
        }
      ]
    },
    {
      "id": "sinopac-green",
      "name": "永豐Green卡",
      "fullName": "永豐銀行Green信用卡",
      "basicCashback": 1.0,
      "annualFee": "首年免年費，次年起年費NT$3,000",
      "feeWaiver": "申請電子帳單或前一年刷滿15萬元或12筆消費",
      "website": "https://bank.sinopac.com/sinopacBT/personal/credit-card/introduction/bankcard/cashcard.html",
      "cashbackRates": [
        {
          "rate": 5.0,
          "cap": 7500,
          "items": [
            "悠遊卡自動加值", "愛買", "家樂福", "大潤發", "uniqlo", "h&m", "zara", "gu", "gap", "net", "新光影城", "威秀", "喜樂時代", "藏壽司", "mos", "築間", "義美食品", "馬可先生", "寬心園", "miacucina", "小小樹食", "陽明春天", "屋馬", "熱浪島", "草蕲宴", "原素食府", "herbivore", "印度蕲食", "養心茶樓", "山海樓", "qburger", "麥味登", "一之軒", "捷絲旅", "承億", "煙波", "翰品", "希爾頓", "國賓", "福容", "新驛", "圓山", "城市商旅", "凱薩", "老爺", "kktix", "拓元售票", "全國電子", "studioa", "straighta", "o'right", "aesop", "10/10 hope", "主婦聯盟", "里仁", "棉花田", "聖德科斯", "義美生機", "統一生機", "綠藤生機", "茶籽堂", "艾瑪絲", "長康生技", "營養師輕食", "安永鮮物", "野菜村", "無毒的家", "無毒農", "健康食彩", "直接跟農夫買", "irent", "zipcar", "gosmart", "goshare", "gogoro", "wemo", "line go", "tesla 充電", "裕電促電", "evalue", "evoasis", "sharkparking", "zocha", "begin", "星舟快充", "emoving", "emoving 電池"
          ]
        }
      ]
    },
    {
      "id": "sinopac-daway",
      "name": "永豐DAWAY卡",
      "fullName": "永豐銀行DAWAY信用卡",
      "basicCashback": 0.5,
      "annualFee": "首年免年費，次年起年費NT$3,000",
      "feeWaiver": "申請電子帳單且取消實體帳單，或前一年刷滿15萬元或12筆消費",
      "website": "https://bank.sinopac.com/sinopacbt/personal/credit-card/introduction/bankcard/DAWAY.html",
      "cashbackRates": [
        {
          "rate": 4.0,
          "cap": null,
          "items": ["海外"]
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
      "name": "玉山ubear卡",
      "fullName": "玉山銀行ubear信用卡",
      "basicCashback": 1.0,
      "annualFee": "首年免年費，次年起年費NT$3,000",
      "feeWaiver": "前一年度有刷卡消費紀錄或申請電子賬單",
      "website": "https://www.esunbank.com/zh-tw/personal/credit-card/intro/bank-card/u-bear",
      "cashbackRates": [
        {
          "rate": 10.0,
          "cap": 1000,
          "cashbackType": "現金回饋",
          "conditions": "限原平台付款，經Google、PayPal等代扣不適用。不與一般/網路消費回饋併計，達上限即停止回饋。",
          "items": [
            "disney+", "nintendo", "playstation", "netflix"
          ]
        },
        {
          "rate": 3.0,
          "cap": 7500,
          "items": [
            "line pay", "街口支付", "悠遊付", "open錢包", "icash pay", "全盈+pay", "全支付", "橘子支付", "skm pay", "中油pay", "玉山wallet", "pi 拍錢包", "歐付寶行動支付", "paypal", "hami pay掃碼付", "pchome", "momo購物網", "蝦皮", "coupang酷澎", "yahoo購物中心", "yahoo拍賣", "淘寶", "露天", "博客來", "全電商", "生活市集", "松果購物", "誠品網路書店", "friday購物", "udn售票網", "gomaji", "17life", "樂天市場", "citiesocial", "91-app", "媽咪愛", "屈臣氏網路商城", "康是美線上商城", "家樂福線上購物", "神腦商城", "燦坤線上購物", "瘋狂賣客", "myfone購物", "486團購網", "86小舖", "小三美日", "apple官網", "studio a官網", "straight a官網", "台灣小米", "台灣索尼股份有限公司", "良興eclife購物網", "isunfar愛順發3c購物網", "迪卡儂線上購物", "拓元售票系統", "zara", "h&m", "gu網路商店", "uniqlo網路商店", "ob 嚴選", "lativ米格國際", "genquo", "zalora", "mos線上儲值", "星巴克線上儲值", "ibon售票系統", "ibon mart 統一超商線上購物中心", "eztable", "pinkoi", "55688 app", "uber", "呼叫小黃", "台灣高鐵t-ex行動購票", "台鐵線上購票", "eztravel", "agoda", "hotels.com", "expedia", "klook", "kkday", "booking.com", "airbnb", "中華航空", "長榮航空", "台灣虎航", "uber eats", "foodpanda", "foodomo", "lalamove", "你訂", "kkbox", "itunes", "google play", "funnow"
          ]
        }
      ]
    },
    {
      "id": "febank-lejia",
      "name": "遠東樂家+卡",
      "fullName": "遠東商業銀行樂家+信用卡",
      "basicCashback": 0.5,
      "annualFee": "首年免年費，次年起年費NT$2,000",
      "feeWaiver": "前一年刷卡遜6萬元或12筆消費，或設定電子帳單+遠銀帳戶自扣且刷3筆",
      "website": "https://www.feib.com.tw/upload/creditcard/YACard/index.html",
      "overseasCashback": 2.5,
      "exclusions": [
        "遠東百貨", "遠東sogo百貨", "遠東巨城購物中心", "遠企購物中心", "代扣繳遠傳電信帳單", "愛買量販", "遠東香格里拉", "mega50", "city'super", "friday購物"
      ],
      "overseasExclusions": [
        "歐洲實體商店", "海外交易清算手續費", "預借現金", "學雜費", "etoro", "境外投資交易平臺"
      ],
      "cashbackRates": [
        {
          "rate": 10.0,
          "cap": 5263,
          "period": "2025/07/01-2026/03/31",
          "items": [
            "寵物公園", "東森寵物", "魚中魚寵物水族", "大樹寵物", "凱朝寵物", "貓狗隊長", "毛孩市集", "金吉利寵物精品", "好狗命寵物幸福生活城", "好狗運貓狗福利中心", "金王子寵物", "愛貓園", "福壽寵物旗艦館", "動物醫院", "寵物醫院"
          ]
        },
        {
          "rate": 2.5,
          "cap": null,
          "hideInDisplay": true,
          "items": [
            "海外"
          ]
        },
        {
          "rate": 4.0,
          "cap": 5714,
          "period": "2025/07/01-2026/03/31",
          "category": "大小安心刷",
          "conditions": "須本期帳款以遠銀帳戶自動扣款成功,次期帳單中以本卡新增一般消費滿NT$3,000",
          "items": [
            "國內餐廳", "大樹連鎖藥局", "杏一醫療用品", "維康醫療用品", "躍獅連鎖藥局", "媽咪樂居家服務", "潔客幫", "卡多摩嬰童館", "宜兒樂婦嬰用品", "營養銀行", "麗兒采家", "ikea", "環球購物中心", "秀泰生活", "故宮博物院", "統一時代百貨", "大葉高島屋", "美麗華百樂園", "citylink", "宏匯廣場", "ifg遠雄廣場", "新月廣場", "台茂購物中心", "大江國際購物中心", "桃知道geleven plaza", "小人國主題樂園", "六福村主題遊樂園", "大魯閣湳雅廣場", "尚順育樂世界", "台中lalaport", "麗寶樂園渡假區", "岡山樂購廣場", "南紡購物中心", "skmpark", "統一夢時代購物中心"
          ]
        },
        {
          "rate": 4.0,
          "cap": 5714,
          "period": "2025/07/01-2026/03/31",
          "category": "生活禮遇",
          "conditions": "須本期帳款以遠銀帳戶自動扣款成功,次期帳單中以本卡新增一般消費滿NT$3,000",
          "items": [
            "愛買", "家樂福", "美廉社", "小北百貨", "大買家", "喜互惠", "聖德科斯", "棉花田", "永豐餘生技", "green&safe", "里仁", "台灣主婦聯盟", "健康食彩", "安麗", "葡眾", "美樂家", "國內加油", "gogoro", "tesla", "台灣大車隊", "yoxi", "uber", "goshare", "irent", "wemo scooter", "代扣遠傳電信", "代扣台灣大哥大帳單", "台灣虨屋", "tsutaya bookstore", "巨匠電腦", "聯成電腦", "朱宗慶打擊樂教室", "雲門舞蹈教室", "誠品書店", "誠品生活", "博客來網路商店", "金石堂書店", "健身工場", "worldgym", "beingspa", "beingsport", "curves可爾姿", "佐登妮絲"
          ]
        }
      ]
    },
    {
      "id": "tbb-chaotian",
      "name": "企銀朝天宮卡",
      "fullName": "台灣企銀北港朝天宮認同卡",
      "basicCashback": 0.3,
      "annualFee": "首年免年費，次年起年費NT$2,400",
      "feeWaiver": "有消費，或申辦電子帳單並取消實體帳單",
      "website": "https://www.tbb.com.tw/zh-tw/personal/cards/products/overview/chaotiangong-creditcard",
      "overseasCashback": 1.5,
      "cashbackRates": [
        {
          "rate": 6.0,
          "cap": 8772,
          "conditions": "使用電子帳單+登錄一次",
          "period": "2024/10/01-2025/12/31",
          "items": [
            "uber eats", "foodpanda", "屈臣氏", "康是美", "poya寶雅", "j-mart佳瑪", "唐吉訶德", "維康醫療用品", "大樹藥局", "啄木鳥藥師藥局", "杏一醫療用品", "丁丁藥局", "躍獅連鎖藥局", "新高橋藥局", "松本清", "tomod's特美事", "日藥本舖", "小三美日", "札幌藥妝", "高鐵", "台鐵", "uber", "台灣大車隊", "大都會車隊", "line go", "yoxi", "和運租車", "格上租車"
          ]
        },
        {
          "rate": 1.5,
          "cap": 6667,
          "conditions": "綁定台灣Pay行動支付",
          "period": "2025/01/01-2025/12/31",
          "items": [
            "企銀朝天宮+台灣pay"
          ]
        }
      ]
    },
    {
      "id": "hsbc-liveplus",
      "name": "滙豐Live+卡",
      "fullName": "滙豐 Live+ 現金回饋卡",
      "basicCashback": 1.88,
      "annualFee": "首年免年費，次年起年費NT$2,000",
      "feeWaiver": "消費滿NT$80,000或12筆，或申請電子/行動帳單，就可終身免年費",
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
            "餐飲mcc", "購物mcc", "娛樂mcc", "蝦皮購物", "pchome 24h購物", "酷澎", "ebay", "amazon", "friday購物", "gomaji", "麥當勞", "星巴克", "王品集團", "享鴨", "夏慕尼", "王品", "西堤", "石二鍋", "陶板屋", "青花驕", "饗賓餐旅", "享享", "開飯", "瓦城", "鼎泰豐", "富王大飯店文公館", "教父牛排", "山海樓", "鹽之華", "牡丹tempura", "吉兆割烹壽司", "明壽司", "logy", "inita", "海底撈", "金大鋄壽喜燒", "築間幸福鍋物", "壽司郎", "藏壽司", "爭鮮", "金色三麥", "貴族世家", "莫凡彼", "春大直", "貳樓", "涵豆腐", "hooters", "勝田日式豬排", "必勝客", "達美樂", "ikea", "台北101", "三井outlet", "微風南山", "微風南京", "微風信義", "微風松高", "微風廣場", "微風三總", "微風北車", "遠東sogo百貨", "漢神巨蛋", "華泰名品城", "新光三越", "skm park outlet", "att 4 fun", "美麗華百樂園", "南紡購物中心", "統一時代百貨", "ifg遠雄廣場", "京站時尚廣場", "citylink", "夢時代購物中心", "lalaport台中", "大葉高島屋百貨", "中友百貨", "遠企購物中心", "麗寶outlet", "比漾廣場", "大江國際購物中心", "遠東巨城", "遠東百貨", "global mall", "漢神名店百貨", "義大世界購物廣場", "台茂購物中心", "寶雅", "無印良品", "bellavita", "宏匯廣場", "義享時尚廣場", "noke忠泰樂生活", "大魯閣湳雅廣場", "明曜百貨", "新光影城", "威秀影城", "國賓影城", "秀泰影城", "環球影城", "迪士尼樂園", "吉卜力公園", "樂天世界", "legoland", "safari world", "兒童新樂園", "x park", "小人國", "六福村", "大魯閣", "遠雄海洋公園", "麗寶樂園", "劍湖山世界", "九族文化村", "尚順育樂世界", "義大遊樂世界", "巧虎夢想樂園", "台北市立動物園", "國立海洋生物博物館", "奇美博物館", "小叮當科學主題樂園", "野柳海洋世界", "星夢森林劇場", "埔心牧場", "飛牛牧場", "頑皮世界", "自行車文化館", "桃園市立美術館", "烏來台車", "日月潭纜車", "和平島公園", "台南十鼓仁糖文創園區", "太平山遊樂區", "阿里山國家森林遊樂區", "大雪山森林遊樂區", "墓丁國家森林遊樂區", "內洞國家森林遊樂區", "momo", "肯德基", "摩斯漢堡"
          ]
        },
        {
          "rate": 1.0,
          "cap": 20000,
          "period": "2025/07/01-2025/12/31",
          "items": [
            "日本當地實體餐飲mcc", "新加坡當地實體餐飲mcc", "馬來西亞當地實體餐飲mcc", "越南當地實體餐飲mcc", "菲律賓當地實體餐飲mcc", "印度當地實體餐飲mcc", "斯里蘭卡當地實體餐飲mcc"
          ]
        }
      ]
    },
    {
      "id": "sinopac-coin",
      "name": "永豐幣倍卡",
      "fullName": "永豐銀行幣倍卡",
      "basicCashback": 1.0,
      "annualFee": "首年免年費，次年起年費NT$3,000",
      "feeWaiver": "申請電子或行動帳單期間正附卡皆終身免年費，或任一年消費滿36,000元或消費12次",
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
            "amazon", "淘寶", "dokodemo多和夢", "lookfantastic", "selfridges", "farfetch", "casetify", "daikokudrug", "ebay", "shopbop", "zalora", "asos", "iherb", "gmarket", "yoox", "yesstyle", "航空公司", "agoda", "booking.com", "易遊網", "雄獅旅行社", "飯店類", "渡假村", "旅館民宿", "歐特儀松山機場停車", "中華航空", "長榮航空", "星宇航空", "台灣虎航", "國泰航空", "樂桃航空", "日本航空", "全日空", "大韓航空", "新加坡航空", "飯店", "渡假村", "旅館", "民宿"
          ]
        },
        {
          "rate": 3.0,
          "cap": null,
          "items": [
            "海外"
          ]
        }
      ]
    },
    {
      "id": "taishin-jiekou",
      "name": "台新街口卡",
      "fullName": "台新銀行街口聯名卡",
      "basicCashback": 1.0,
      "basicCashbackType": "街口幣",
      "annualFee": "正卡NT$4,500",
      "feeWaiver": "採電子/行動簡訊帳單",
      "website": "https://www.taishinbank.com.tw/TSB/personal/credit/intro/overview/cg038/card001/",
      "cashbackRates": [
        {
          "rate": 2.5,
          "cap": 400000,
          "cashbackType": "街口幣",
          "period": "活動至2025/12/31",
          "items": [
            "日本PayPay(限於街口支付綁定)", "韓國(含實體及網路)", "易遊網", "agoda", "airbnb", "高鐵", "uber", "新光三越", "遠東百貨", "lalaport", "三井(MITSUI OUTLET PARK)", "康是美實體門市", "屈臣氏實體門市", "寶雅實體門市", "uber eats", "foodpanda", "星巴克(限實體)", "路易莎咖啡", "85度C", "cama café", "多那之", "清心福全", "迷客夏", "可不可", "麻古茶坊", "COMEBUY", "大茗", "龜記", "UG", "鮮茶道", "五桐號", "茶湯會", "TEATOP 第一味", "珍煮丹", "老賴茶棧"
          ]
        }
      ]
    }
  ]
};

// Load cards data function - now simplified since data is embedded
async function loadCardsData() {
    console.log('✅ 信用卡資料已內嵌載入');
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
        errorDiv.innerHTML = `⚠️ ${message}`;
        container.insertBefore(errorDiv, container.firstChild);
    }
}

let currentMatchedItem = null;

// DOM elements
const merchantInput = document.getElementById('merchant-input');
const amountInput = document.getElementById('amount-input');
const calculateBtn = document.getElementById('calculate-btn');
const resultsSection = document.getElementById('results-section');
const resultsContainer = document.getElementById('results-container');
const couponResultsSection = document.getElementById('coupon-results-section');
const couponResultsContainer = document.getElementById('coupon-results-container');
const matchedItemDiv = document.getElementById('matched-item');

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    // Load cards data first
    const dataLoaded = await loadCardsData();
    if (!dataLoaded) {
        // If data loading fails, disable the app
        if (calculateBtn) calculateBtn.disabled = true;
        return;
    }
    
    populateCardChips();
    setupEventListeners();
    setupAuthentication();
});

// Populate card chips in header
function populateCardChips() {
    const cardChipsContainer = document.getElementById('card-chips');
    if (!cardChipsContainer) return;
    
    // Clear existing chips
    cardChipsContainer.innerHTML = '';
    
    // Show cards based on user selection or all cards if not logged in
    const cardsToShow = currentUser ? 
        cardsData.cards.filter(card => userSelectedCards.has(card.id)) :
        cardsData.cards;
    
    cardsToShow.forEach(card => {
        const chip = document.createElement('div');
        chip.className = 'card-chip chip-clickable';
        chip.textContent = card.name;
        chip.addEventListener('click', () => showCardDetail(card.id));
        cardChipsContainer.appendChild(chip);
    });
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
    
    // Find matching items (now returns array)
    const matchedItems = findMatchingItem(input);
    
    if (matchedItems && matchedItems.length > 0) {
        showMatchedItem(matchedItems);
        currentMatchedItem = matchedItems; // Now stores array of matches
    } else {
        hideMatchedItem();
        currentMatchedItem = null;
    }
    
    validateInputs();
}

// Fuzzy search mapping for common terms
const fuzzySearchMap = {
    'pchome': 'pchome',
    'pchome商店街': 'pchome',
    'pchome24h': 'pchome 24h購物',
    'shopee': '蝦皮購物',
    '蝦皮': '蝦皮購物',
    'rakuten': '樂天市場',
    '樂天': '樂天市場',
    'momo': 'momo購物網',
    'yahoo': 'yahoo',
    'yahoo購物': 'yahoo',
    'yahoo超級商城': 'yahoo',
    'costco': '好市多',
    '好市多': 'costco',
    '7-11': '7-11',
    '7eleven': '7-11',
    '7 11': '7-11',
    '7-eleven': '7-11',
    '全家': '全家',
    'familymart': '全家',
    '全家便利商店': '全家',
    '萊爾富': 'ok mart',
    '莱尔富': 'ok mart',
    'okmart': 'ok mart',
    'pxmart': '全聯福利中心',
    '全聯': '全聯福利中心',
    'carrefour': '家樂福',
    '家樂福': 'carrefour',
    'rt-mart': '大潤發',
    '大潤發': 'rt-mart',
    'mcd': '麥當勞',
    'mcdonalds': '麥當勞',
    '麥當勞': 'mcdonalds',
    'starbucks': '星巴克',
    '星巴克': 'starbucks',
    'linepay': 'line pay',
    'line pay': 'linepay',
    'applepay': 'apple pay',
    'apple pay': 'applepay',
    'apple wallet': 'apple pay',
    'googlepay': 'google pay',
    'google pay': 'googlepay',
    'samsungpay': 'samsung pay',
    'samsung pay': 'samsungpay',
    '街口': '街口支付',
    '街口支付': '街口',
    'jkopay': '街口',
    'pi錢包': 'pi 拍錢包',
    'pi wallet': 'pi 拍錢包',
    '台灣支付': '台灣pay',
    'taiwan pay': '台灣pay',
    '台灣行動支付': '台灣pay',
    'taiwanpay': '台灣pay',
    '悠遊付': 'easy wallet',
    'easywallet': '悠遊付',
    '長榮': '長榮航空',
    'eva air': '長榮航空',
    'evaair': '長榮航空',
    '華航': '中華航空',
    'china airlines': '中華航空',
    '立榮': 'uni air',
    'uniaire': 'uni air',
    '星宇': '星宇航空',
    'starlux': '星宇航空',
    'starlux airlines': '星宇航空',
    '日本航空': 'japan airlines',
    '日航': 'jal',
    'jal': 'japan airlines',
    '全日空': 'ana',
    'all nippon airways': 'ana',
    '大韓航空': 'korean air',
    '大韓': 'korean air',
    '韓亞航空': 'asiana airlines',
    '韓亞': 'asiana airlines',
    '國泰航空': 'cathay pacific',
    '國泰': 'cathay pacific',
    '新加坡航空': 'singapore airlines',
    '新航': 'singapore airlines',
    'sia': 'singapore airlines',
    '泰國航空': 'thai airways',
    '泰航': 'thai airways',
    '馬來西亞航空': 'malaysia airlines',
    '馬航': 'malaysia airlines',
    '越南航空': 'vietnam airlines',
    '越航': 'vietnam airlines',
    '菲律賓航空': 'philippine airlines',
    '菲航': 'philippine airlines',
    '華信航空': 'mandarin airlines',
    '華信': 'mandarin airlines',
    '台灣高鐵': '高鐵',
    'taiwan high speed rail': '高鐵',
    'high speed rail': '高鐵',
    'thsr': '高鐵',
    'foodpanda': 'foodpanda',
    'food panda': 'foodpanda',
    // Remove uber/uber eats cross-mapping to prevent unwanted matches
    '三井(mitsui outlet park)': '三井',
    '三井outlet': '三井',
    '三井': '三井(mitsui outlet park)',
    'mitsui': '三井',
    'mitsui outlet': '三井',
    'mitsui outlet park': '三井(mitsui outlet park)',
    // 新增海外和國外的對應
    '國外': '海外',
    '海外': '國外',
    // 新增迪卡儂相關詞彙
    'decathlon': '迪卡儂',
    '迪卡儂': 'decathlon',
    // 新增宜家相關詞彙
    'ikea': 'IKEA宜家家居',
    '宜家': 'IKEA宜家家居',
    '宜家家居': 'IKEA宜家家居',
    'IKEA宜家家居': 'ikea'
};

// Find matching item in cards database
function findMatchingItem(searchTerm) {
    if (!cardsData) return null;
    
    let searchLower = searchTerm.toLowerCase().trim();
    let searchTerms = [searchLower]; // Always include original search term
    
    // Add fuzzy search mapping if exists
    if (fuzzySearchMap[searchLower]) {
        const mappedTerm = fuzzySearchMap[searchLower].toLowerCase();
        if (!searchTerms.includes(mappedTerm)) {
            searchTerms.push(mappedTerm);
        }
    }
    
    // Also add reverse mappings (find all terms that map to current search)
    Object.entries(fuzzySearchMap).forEach(([key, value]) => {
        if (value.toLowerCase() === searchLower && !searchTerms.includes(key)) {
            searchTerms.push(key);
        }
    });
    
    let allMatches = [];
    
    // Collect all possible matches using all search terms
    for (const card of cardsData.cards) {
        for (const rateGroup of card.cashbackRates) {
            for (const item of rateGroup.items) {
                const itemLower = item.toLowerCase();
                
                // Check if any search term matches this item
                let matchFound = false;
                let bestMatchTerm = searchLower;
                let isExactMatch = false;
                let isFullContainment = false;
                
                for (const term of searchTerms) {
                    if (itemLower.includes(term) || term.includes(itemLower) || itemLower === term) {
                        matchFound = true;
                        if (itemLower === term) {
                            isExactMatch = true;
                            bestMatchTerm = term;
                            break;
                        }
                        if (itemLower.includes(term)) {
                            isFullContainment = true;
                            bestMatchTerm = term;
                        }
                    }
                }
                
                if (matchFound) {
                    allMatches.push({
                        originalItem: item,
                        searchTerm: searchTerm,
                        itemLower: itemLower,
                        searchLower: bestMatchTerm,
                        // Calculate match quality
                        isExactMatch: isExactMatch,
                        isFullContainment: isFullContainment,
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
    
    // Return all matches for comprehensive results
    return uniqueMatches;
}

// Show matched item(s)
function showMatchedItem(matchedItems) {
    if (Array.isArray(matchedItems)) {
        if (matchedItems.length === 1) {
            matchedItemDiv.innerHTML = `✓ 系統匹配到: <strong>${matchedItems[0].originalItem}</strong>`;
        } else {
            const itemList = matchedItems.map(item => item.originalItem).join('、');
            matchedItemDiv.innerHTML = `✓ 系統匹配到 ${matchedItems.length} 項: <strong>${itemList}</strong>`;
        }
    } else {
        // Backward compatibility for single item
        matchedItemDiv.innerHTML = `✓ 系統匹配到: <strong>${matchedItems.originalItem}</strong>`;
    }
    matchedItemDiv.className = 'matched-item';
    matchedItemDiv.style.display = 'block';
}

// Show no match message with red styling
function showNoMatchMessage() {
    matchedItemDiv.innerHTML = `✓ 系統匹配到: <strong>沒有任何匹配的項目，以下結果顯示基本回饋</strong>`;
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
        // User input matched specific items - show special cashback rates for ALL matched items
        let allResults = [];
        
        if (Array.isArray(currentMatchedItem)) {
            // Multiple matches - calculate for all items and combine results
            const itemResultsMap = new Map();
            
            currentMatchedItem.forEach(matchedItem => {
                const searchTerm = matchedItem.originalItem.toLowerCase();
                const itemResults = cardsToCompare.map(card => {
                    const result = calculateCardCashback(card, searchTerm, amount);
                    return {
                        ...result,
                        card: card,
                        matchedItemName: matchedItem.originalItem
                    };
                }).filter(result => result.cashbackAmount > 0);
                
                // Add to combined results, keeping track of the best rate per card
                itemResults.forEach(result => {
                    const cardId = result.card.id;
                    if (!itemResultsMap.has(cardId) || result.cashbackAmount > itemResultsMap.get(cardId).cashbackAmount) {
                        itemResultsMap.set(cardId, result);
                    }
                });
            });
            
            allResults = Array.from(itemResultsMap.values());
        } else {
            // Single match - backward compatibility
            const searchTerm = currentMatchedItem.originalItem.toLowerCase();
            allResults = cardsToCompare.map(card => {
                const result = calculateCardCashback(card, searchTerm, amount);
                return {
                    ...result,
                    card: card
                };
            }).filter(result => result.cashbackAmount > 0);
        }
        
        results = allResults;
        
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
                    // Handle 永豐幣倍 type cards with domestic bonus
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
                // Handle 永豐幣倍 type cards with domestic bonus
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
    
    // Display results - handle multiple matched items
    let displayedMatchItem;
    if (currentMatchedItem) {
        if (Array.isArray(currentMatchedItem)) {
            displayedMatchItem = currentMatchedItem.map(item => item.originalItem).join('、');
        } else {
            displayedMatchItem = currentMatchedItem.originalItem;
        }
    } else {
        displayedMatchItem = merchantValue;
    }
    
    displayResults(results, amount, displayedMatchItem, isBasicCashback);
    
    // Display coupon cashbacks
    displayCouponCashbacks(amount, merchantValue);
}

// Get all search term variants for comprehensive matching
function getAllSearchVariants(searchTerm) {
    const searchLower = searchTerm.toLowerCase().trim();
    let searchTerms = [searchLower];
    
    // Add fuzzy search mapping if exists
    if (fuzzySearchMap[searchLower]) {
        const mappedTerm = fuzzySearchMap[searchLower].toLowerCase();
        if (!searchTerms.includes(mappedTerm)) {
            searchTerms.push(mappedTerm);
        }
    }
    
    // Also add reverse mappings (find all terms that map to current search)
    Object.entries(fuzzySearchMap).forEach(([key, value]) => {
        if (value.toLowerCase() === searchLower && !searchTerms.includes(key)) {
            searchTerms.push(key);
        }
    });
    
    return searchTerms;
}

// Calculate cashback for a specific card
function calculateCardCashback(card, searchTerm, amount) {
    let bestRate = 0;
    let applicableCap = null;
    let matchedItem = null;
    let matchedCategory = null;
    let matchedRateGroup = null;
    
    // Get all possible search variants
    const searchVariants = getAllSearchVariants(searchTerm);
    
    // Handle CUBE card with levels
    if (card.hasLevels && card.id === 'cathay-cube') {
        const savedLevel = localStorage.getItem(`cubeLevel-${card.id}`) || 'level1';
        const levelSettings = card.levelSettings[savedLevel];
        
        // Check if merchant matches special items using all search variants
        let matchedSpecialItem = null;
        for (const variant of searchVariants) {
            matchedSpecialItem = card.specialItems.find(item => item.toLowerCase() === variant);
            if (matchedSpecialItem) break;
        }
        
        if (matchedSpecialItem) {
            bestRate = levelSettings.specialRate;
            matchedItem = matchedSpecialItem;
            matchedCategory = '玩數位、樂饗購、趣旅行';
        } else {
            // Check if merchant matches general items (2% reward categories)
            let matchedGeneralItem = null;
            let matchedGeneralCategory = null;
            
            if (card.generalItems) {
                for (const [category, items] of Object.entries(card.generalItems)) {
                    for (const variant of searchVariants) {
                        // Try exact match first, then contains match
                        const foundItem = items.find(item => {
                            const itemLower = item.toLowerCase();
                            return itemLower === variant || itemLower.includes(variant) || variant.includes(itemLower);
                        });
                        if (foundItem) {
                            matchedGeneralItem = foundItem;
                            matchedGeneralCategory = category;
                            break;
                        }
                    }
                    if (matchedGeneralItem) break;
                }
            }
            
            if (matchedGeneralItem) {
                bestRate = levelSettings.generalRate;
                matchedItem = matchedGeneralItem;
                matchedCategory = matchedGeneralCategory;
            } else {
                // No match found - CUBE card gives 0.3% basic rate only for unmatched items
                bestRate = 0; // No special rate for unmatched items
                matchedItem = null;
                matchedCategory = null;
            }
        }
        applicableCap = null; // CUBE card has no cap
    } else {
        // Check exact matches for all search variants
        for (const rateGroup of card.cashbackRates) {
            // Check all search variants against all items in the rate group
            for (const variant of searchVariants) {
                let exactMatch = rateGroup.items.find(item => item.toLowerCase() === variant);
                if (exactMatch && rateGroup.rate > bestRate) {
                    bestRate = rateGroup.rate;
                    applicableCap = rateGroup.cap;
                    matchedItem = exactMatch;
                    matchedCategory = rateGroup.category || null;
                    matchedRateGroup = rateGroup;
                }
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
        
        // Handle special cards like 永豐幣倍 with different domestic/overseas rates
        if (matchedItem === '海外' && card.overseasCashback) {
            basicRate = card.overseasCashback;
            if (card.overseasBonusRate && card.overseasBonusCap) {
                bonusRate = card.overseasBonusRate;
            }
        } else if (card.domesticBonusRate && card.domesticBonusCap) {
            bonusRate = card.domesticBonusRate;
        }
        
        // Handle different card types for basic cashback
        let basicCashback = 0;
        if (card.hasLevels && card.id === 'cathay-cube') {
            basicCashback = 0; // CUBE rates already include basic rate
        } else if (card.id === 'sinopac-sport') {
            // Sport card: basic 1% + conditional 1% (from first rate group) + special rate
            const conditionalRate = card.cashbackRates.find(rate => rate.items.includes('一般消費'))?.rate || 0;
            basicCashback = Math.floor(effectiveSpecialAmount * (basicRate + conditionalRate) / 100);
        } else if (card.id === 'taishin-richart' && bestRate === 3.3) {
            // Taishin Richart 3.3% already includes 0.3% basic, don't add basic separately
            basicCashback = 0; // The 3.3% already includes the basic rate
        } else {
            // Add basic cashback for the same amount (layered rewards)
            basicCashback = Math.floor(effectiveSpecialAmount * basicRate / 100);
        }
        
        // Add bonus cashback if applicable
        let bonusCashback = 0;
        if (bonusRate > 0) {
            let bonusAmount = effectiveSpecialAmount;
            if (matchedItem === '海外' && card.overseasBonusCap) {
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
            
            // Handle remaining amount for special cards
            if (card.hasLevels && card.id === 'cathay-cube') {
                remainingCashback = Math.floor(remainingAmount * card.basicCashback / 100);
            } else if (card.id === 'taishin-richart' && bestRate === 3.3) {
                // Remaining amount for Richart 3.3% gets only basic 0.3%
                remainingCashback = Math.floor(remainingAmount * card.basicCashback / 100);
            } else {
                remainingCashback = Math.floor(remainingAmount * basicRate / 100);
            }
            
            // Add bonus for remaining amount if applicable
            if (bonusRate > 0) {
                let remainingBonusAmount = remainingAmount;
                if (matchedItem === '海外' && card.overseasBonusCap) {
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
        
        // Fix floating point precision issues for total rate
        if (card.hasLevels && card.id === 'cathay-cube') {
            totalRate = Math.round(bestRate * 10) / 10; // CUBE rates don't add basic rate
        } else if (card.id === 'sinopac-sport') {
            // Sport card: basic 1% + conditional 1% + special rate
            const conditionalRate = card.cashbackRates.find(rate => rate.items.includes('一般消費'))?.rate || 0;
            totalRate = Math.round((bestRate + basicRate + conditionalRate + bonusRate) * 10) / 10;
        } else if (card.id === 'taishin-richart' && bestRate === 3.3) {
            // Richart 3.3% already includes basic rate
            totalRate = Math.round(bestRate * 10) / 10;
        } else {
            totalRate = Math.round((bestRate + basicRate + bonusRate) * 10) / 10;
        }
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
            <h3>無符合的信用卡</h3>
            <p>沒有任何信用卡對「${searchedItem}」提供現金回饋。</p>
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
                <div class="coupon-detail-label">回饋金額:</div>
                <div class="coupon-detail-value">NT$${coupon.potentialCashback.toLocaleString()}</div>
            </div>
            <div class="coupon-detail-row">
                <div class="coupon-detail-label">回饋消費上限:</div>
                <div class="coupon-detail-value">無上限</div>
            </div>
            <div class="coupon-detail-row">
                <div class="coupon-detail-label">回饋條件:</div>
                <div class="coupon-detail-value">${coupon.conditions}</div>
            </div>
            <div class="coupon-detail-row">
                <div class="coupon-detail-label">活動期間:</div>
                <div class="coupon-detail-value">${coupon.period}</div>
            </div>
        </div>
        <div class="coupon-card-name">匹配項目: ${coupon.merchant}</div>
    `;
    
    return couponDiv;
}

// Create card result element
function createCardResultElement(result, originalAmount, searchedItem, isBest, isBasicCashback = false) {
    const cardDiv = document.createElement('div');
    cardDiv.className = `card-result fade-in ${isBest ? 'best-card' : ''} ${result.cashbackAmount === 0 ? 'no-cashback' : ''}`;
    
    let capText = result.cap ? `NT$${result.cap.toLocaleString()}` : '無上限';
    // Special handling for Taishin Richart card cap display
    if (result.card.id === 'taishin-richart' && result.cap) {
        capText = `NT$${result.cap.toLocaleString()}+`;
    }
    const cashbackText = result.cashbackAmount > 0 ? 
                        `NT$${result.cashbackAmount.toLocaleString()}` : 
                        '無回饋';
    
    // Format rate display for complex cards
    let rateDisplay = result.rate > 0 ? `${result.rate}%` : '0%';
    
    // Only show additive format for cards that truly have layered cashback
    // CUBE cards show clean rates, Taishin Richart shows additive
    if (result.specialRate && result.basicRate && result.specialRate > 0) {
        if (result.card.id === 'cathay-cube') {
            // CUBE cards show clean rates only
            rateDisplay = `${result.specialRate}%`;
        } else if (result.card.id === 'taishin-jiekou') {
            // Taishin Jiekou (street card) shows additive structure
            const totalRate = Math.round((result.specialRate + result.basicRate) * 10) / 10;
            const specialRate = Math.round(result.specialRate * 10) / 10;
            const basicRate = Math.round(result.basicRate * 10) / 10;
            rateDisplay = `${totalRate}% (${specialRate}%+基本${basicRate}%)`;
        } else if (result.card.id === 'sinopac-sport') {
            // Sinopac Sport card shows additive structure: basic 1% + conditional 1% + special rate
            rateDisplay = `${result.rate}%`;
        } else {
            // Other cards show just their total rate without breakdown for now
            rateDisplay = `${result.rate}%`;
        }
    }
    
    cardDiv.innerHTML = `
        <div class="card-header">
            <div class="card-name">${result.card.name}</div>
            ${isBest ? '<div class="best-badge">最優回饋</div>' : ''}
        </div>
        <div class="card-details">
            <div class="detail-item">
                <div class="detail-label">回饋率</div>
                <div class="detail-value">${rateDisplay}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">回饋金額</div>
                <div class="detail-value ${result.cashbackAmount > 0 ? 'cashback-amount' : 'no-cashback-text'}">${cashbackText}</div>
                ${(() => {
                    if (isBasicCashback) {
                        const cashbackType = result.card.basicCashbackType || '現金回饋';
                        return `<div class="cashback-type-label">(${cashbackType})</div>`;
                    } else if (result.matchedRateGroup && result.matchedRateGroup.cashbackType) {
                        const cashbackType = result.matchedRateGroup.cashbackType;
                        return `<div class="cashback-type-label">(${cashbackType})</div>`;
                    }
                    return '';
                })()}
            </div>
            <div class="detail-item">
                <div class="detail-label">回饋消費上限</div>
                <div class="detail-value">${capText}</div>
            </div>
        </div>
        ${(() => {
            if (isBasicCashback) {
                return `
                    <div class="matched-merchant">
                        一般消費回饋率
                    </div>
                `;
            } else if (result.matchedItem) {
                let additionalInfo = '';
                if (result.matchedRateGroup) {
                    const period = result.matchedRateGroup.period;
                    const conditions = result.matchedRateGroup.conditions;
                    
                    if (period) additionalInfo += `<br><small>活動期間: ${period}</small>`;
                    if (conditions) additionalInfo += `<br><small>條件: ${conditions}</small>`;
                }
                
                const categoryInfo = result.matchedCategory && result.card.id !== 'cathay-cube' ? ` (類別: ${result.matchedCategory})` : '';
                
                // Special handling for Yushan Uni card exclusions in search results
                let exclusionNote = '';
                if (result.card.id === 'yushan-unicard' && 
                    (result.matchedItem === '街口' || result.matchedItem === '全支付')) {
                    exclusionNote = ' <small style="color: #f59e0b; font-weight: 500;">(排除超商)</small>';
                }
                
                return `
                    <div class="matched-merchant">
                        匹配項目: <strong>${result.matchedItem}</strong>${exclusionNote}${categoryInfo}${additionalInfo}
                    </div>
                `;
            } else {
                return `
                    <div class="matched-merchant">
                        此卡無此項目回饋
                    </div>
                `;
            }
        })()}
    `;
    
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
    // Wait for Firebase to load
    const checkFirebaseReady = () => {
        if (typeof window.firebaseAuth !== 'undefined' && typeof window.db !== 'undefined') {
            auth = window.firebaseAuth;
            db = window.db;
            initializeAuth();
        } else {
            setTimeout(checkFirebaseReady, 100);
        }
    };
    checkFirebaseReady();
}

function initializeAuth() {
    const signInBtn = document.getElementById('sign-in-btn');
    const signOutBtn = document.getElementById('sign-out-btn');
    const userInfo = document.getElementById('user-info');
    const userPhoto = document.getElementById('user-photo');
    const userName = document.getElementById('user-name');
    
    // Sign in function
    signInBtn.addEventListener('click', async () => {
        try {
            const result = await window.signInWithPopup(auth, window.googleProvider);
            console.log('Sign in successful:', result.user);
        } catch (error) {
            console.error('Sign in failed:', error);
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
    if (!currentUser) {
        console.log('No current user, using all cards');
        userSelectedCards = new Set(cardsData.cards.map(card => card.id));
        return;
    }
    
    try {
        const storageKey = `selectedCards_${currentUser.uid}`;
        const savedCards = localStorage.getItem(storageKey);
        
        if (savedCards) {
            userSelectedCards = new Set(JSON.parse(savedCards));
            console.log('Loaded user cards from localStorage:', Array.from(userSelectedCards));
        } else {
            // First time user - select all cards by default
            console.log('First time user, selecting all cards');
            userSelectedCards = new Set(cardsData.cards.map(card => card.id));
            saveUserCards();
        }
    } catch (error) {
        console.error('Error loading user cards from localStorage:', error);
        // Default to all cards if error
        userSelectedCards = new Set(cardsData.cards.map(card => card.id));
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
            alert('請先登入才能管理信用卡');
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
            alert('請至少選擇一張信用卡');
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
            toggleAllBtn.textContent = '全選';
        } else {
            // Check all
            checkboxes.forEach(checkbox => {
                checkbox.checked = true;
                checkbox.parentElement.classList.add('selected');
            });
            toggleAllBtn.textContent = '全不選';
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
    toggleAllBtn.textContent = allSelected ? '全不選' : '全選';
    
    modal.style.display = 'flex';
}

// Show card detail modal
function showCardDetail(cardId) {
    const card = cardsData.cards.find(c => c.id === cardId);
    if (!card) return;
    
    const modal = document.getElementById('card-detail-modal');
    
    // Update basic information
    document.getElementById('card-detail-title').textContent = card.name + ' 詳情';
    
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
        const annualFee = card.annualFee || '無資料';
        const feeWaiver = card.feeWaiver || '無資料';
        
        // Extract fee amount from annualFee string
        const feeMatch = annualFee.match(/(NT\$[\d,]+)|(免費)|(無年費)/);
        let feeText = '';
        
        if (annualFee.includes('首年免年費') || annualFee.includes('首年免費')) {
            feeText = '年費首年免費';
            const nextYearMatch = annualFee.match(/次年起.*?(NT\$[\d,]+)/);
            if (nextYearMatch) {
                feeText += `，次年起${nextYearMatch[1]}`;
            }
        } else if (feeMatch) {
            if (feeMatch[0].includes('免費') || feeMatch[0].includes('無年費')) {
                feeText = '年費免費';
            } else {
                feeText = `年費${feeMatch[0]}`;
            }
        } else {
            feeText = `年費${annualFee}`;
        }
        
        // Format fee waiver conditions
        let waiverText = '';
        if (feeWaiver && feeWaiver !== '無資料') {
            // Split conditions by common delimiters and wrap each in quotes
            const conditions = feeWaiver.split(/[,，、或]/)
                .map(condition => condition.trim())
                .filter(condition => condition.length > 0)
                .map(condition => `「${condition}」`);
            
            waiverText = `免年費條件為${conditions.join('或')}`;
        }
        
        return waiverText ? `${feeText}。${waiverText}。` : `${feeText}。`;
    };
    
    const combinedFeeInfo = formatFeeInfo(card);
    document.getElementById('card-annual-fee').textContent = combinedFeeInfo;
    document.getElementById('card-fee-waiver').style.display = 'none'; // Hide the separate fee waiver line
    
    // Update basic cashback
    const basicCashbackDiv = document.getElementById('card-basic-cashback');
    let basicContent = `<div class="cashback-detail-item">`;
    basicContent += `<div class="cashback-rate">國內一般回饋: ${card.basicCashback}%</div>`;
    basicContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
    
    if (card.overseasCashback) {
        basicContent += `<div class="cashback-rate">海外一般回饋: ${card.overseasCashback}%</div>`;
        basicContent += `<div class="cashback-condition">海外消費上限: 無上限</div>`;
    }
    
    basicContent += `</div>`;
    
    if (card.domesticBonusRate) {
        basicContent += `<div class="cashback-detail-item">`;
        basicContent += `<div class="cashback-rate">國內加碼回饋: +${card.domesticBonusRate}%</div>`;
        basicContent += `<div class="cashback-condition">消費上限: NT$${card.domesticBonusCap?.toLocaleString()}</div>`;
        basicContent += `</div>`;
    }
    
    if (card.overseasBonusRate) {
        basicContent += `<div class="cashback-detail-item">`;
        basicContent += `<div class="cashback-rate">海外加碼回饋: +${card.overseasBonusRate}%</div>`;
        basicContent += `<div class="cashback-condition">消費上限: NT$${card.overseasBonusCap?.toLocaleString()}</div>`;
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
        
        // Add birthday month note after level selection
        const levelSectionContent = cubeLevelSection.innerHTML;
        const birthdayNote = `
            <div class="cube-birthday-note" style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px; margin-top: 12px;">
                <div style="color: #d97706; font-size: 14px; margin-bottom: 4px; font-weight: 600;">提醒</div>
                <div style="color: #92400e; font-size: 13px; line-height: 1.4;">
                    慶生月方案不納入回饋比較，請於您的生日月份到<a href="https://www.cathay-cube.com.tw/cathaybk/personal/product/credit-card/cards/cube-list" target="_blank" rel="noopener" style="color: #d97706; text-decoration: underline; font-weight: 500;">官網查詢</a>哦！
                </div>
            </div>
        `;
        cubeLevelSection.innerHTML = levelSectionContent + birthdayNote;
    } else {
        cubeLevelSection.style.display = 'none';
    }
    
    // Update special cashback
    const specialCashbackDiv = document.getElementById('card-special-cashback');
    let specialContent = '';
    
    if (card.hasLevels && card.id === 'cathay-cube') {
        specialContent = generateCubeSpecialContent(card);
    } else if (card.cashbackRates && card.cashbackRates.length > 0) {
        // Sort rates by percentage in descending order
        const sortedRates = [...card.cashbackRates]
            .filter(rate => !rate.hideInDisplay)
            .sort((a, b) => b.rate - a.rate);
            
        sortedRates.forEach((rate, index) => {
            specialContent += `<div class="cashback-detail-item">`;
            
            // Special handling for Sport card display text
            if (card.id === 'sinopac-sport') {
                specialContent += `<div class="cashback-rate">${rate.rate}% 回饋</div>`;
            } else {
                // 回饋率和是否含一般回饋的說明
                const includesBasic = rate.rate > card.basicCashback;
                if (includesBasic) {
                    specialContent += `<div class="cashback-rate">${rate.rate}% 回饋 (含一般回饋${card.basicCashback}%)</div>`;
                } else {
                    specialContent += `<div class="cashback-rate">${rate.rate}% 回饋</div>`;
                }
            }
            
            // 消費上限
            if (rate.cap) {
                if (rate.capDescription && card.id === 'taishin-richart') {
                    specialContent += `<div class="cashback-condition">消費上限: ${rate.capDescription}</div>`;
                } else {
                    specialContent += `<div class="cashback-condition">消費上限: NT$${rate.cap.toLocaleString()}</div>`;
                }
            } else {
                specialContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }
            
            if (rate.category) {
                specialContent += `<div class="cashback-condition">類別: ${rate.category}</div>`;
            }
            
            if (rate.conditions) {
                specialContent += `<div class="cashback-condition">條件: ${rate.conditions}</div>`;
            }
            
            if (rate.period) {
                specialContent += `<div class="cashback-condition">活動期間: ${rate.period}</div>`;
            }
            
            if (rate.items && rate.items.length > 0) {
                const merchantsId = `merchants-${card.id}-${index}`;
                const showAllId = `show-all-${card.id}-${index}`;
                
                // Special handling for Yushan Uni card exclusions
                let processedItems = [...rate.items];
                if (card.id === 'yushan-unicard') {
                    processedItems = rate.items.map(item => {
                        if (item === '街口' || item === '全支付') {
                            return item + '(排除超商)';
                        }
                        return item;
                    });
                }
                
                if (rate.items.length <= 20) {
                    // 少於20個直接顯示全部
                    const merchantsList = processedItems.join('、');
                    specialContent += `<div class="cashback-merchants">適用通路: ${merchantsList}</div>`;
                } else {
                    // 超過20個顯示可展開的列表
                    const initialList = processedItems.slice(0, 20).join('、');
                    const fullList = processedItems.join('、');
                    
                    specialContent += `<div class="cashback-merchants">`;
                    specialContent += `適用通路: <span id="${merchantsId}">${initialList}</span>`;
                    specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${initialList}', '${fullList}')">… 顯示全部${rate.items.length}個</button>`;
                    specialContent += `</div>`;
                }
            }
            
            specialContent += `</div>`;
        });
    } else {
        specialContent = '<div class="cashback-detail-item">無指定通路回饋</div>';
    }
    
    specialCashbackDiv.innerHTML = specialContent;
    
    // Update coupon cashback
    const couponSection = document.getElementById('card-coupon-section');
    const couponCashbackDiv = document.getElementById('card-coupon-cashback');
    
    if (card.couponCashbacks && card.couponCashbacks.length > 0) {
        let couponContent = '';
        card.couponCashbacks.forEach(coupon => {
            couponContent += `<div class="cashback-detail-item">`;
            couponContent += `<div class="cashback-rate">${coupon.merchant}: ${coupon.rate}% 回饋</div>`;
            couponContent += `<div class="cashback-condition">條件: ${coupon.conditions}</div>`;
            couponContent += `<div class="cashback-condition">活動期間: ${coupon.period}</div>`;
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
    
    // 讀取當前筆記
    loadUserNotes(card.id).then(notes => {
        notesTextarea.value = notes;
    });
    
    // 設置輸入監聽
    notesTextarea.oninput = (e) => {
        const notes = e.target.value;
        
        // 自動本地備份
        autoBackupNotes(card.id, notes);
        
        // 更新按鈕狀態
        updateSaveButtonState(card.id, notes);
    };
    
    // 設置儲存按鈕監聽
    const saveBtn = document.getElementById('save-notes-btn');
    saveBtn.onclick = () => {
        const currentNotes = notesTextarea.value;
        saveUserNotes(card.id, currentNotes);
    };
    
    // 設置免年費狀態功能
    setupFeeWaiverStatus(card.id);
    
    // 設置結帳日期功能
    setupBillingDates(card.id);
    
    // Show modal
    modal.style.display = 'flex';
    
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
    
    // Special categories (玩數位、樂饗購、趣旅行)
    content += `<div class="cashback-detail-item">`;
    content += `<div class="cashback-rate">${levelSettings.specialRate}% 回饋 (玩數位、樂饗購、趣旅行)</div>`;
    content += `<div class="cashback-condition">消費上限: 無上限</div>`;
    
    const merchantsList = card.specialItems.join('、');
    if (card.specialItems.length <= 30) {
        content += `<div class="cashback-merchants">適用通路: ${merchantsList}</div>`;
    } else {
        const initialList = card.specialItems.slice(0, 30).join('、');
        const fullList = merchantsList;
        const merchantsId = `cube-merchants-${selectedLevel}`;
        const showAllId = `cube-show-all-${selectedLevel}`;
        
        content += `<div class="cashback-merchants">`;
        content += `適用通路: <span id="${merchantsId}">${initialList}</span>`;
        content += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${initialList}', '${fullList}')">... 顯示全部${card.specialItems.length}個</button>`;
        content += `</div>`;
    }
    content += `</div>`;
    
    // Other categories (2%)
    content += `<div class="cashback-detail-item">`;
    content += `<div class="cashback-rate">${levelSettings.generalRate}% 回饋 (其他通路)</div>`;
    content += `<div class="cashback-condition">消費上限: 無上限</div>`;
    content += `<div class="cashback-merchants">適用通路: 除上述特殊通路外的所有消費</div>`;
    content += `</div>`;
    
    return content;
}

// Update CUBE special cashback when level changes
function updateCubeSpecialCashback(card) {
    const specialCashbackDiv = document.getElementById('card-special-cashback');
    const newContent = generateCubeSpecialContent(card);
    specialCashbackDiv.innerHTML = newContent;
}

// 切換通路顯示展開/收起
function toggleMerchants(merchantsId, buttonId, shortList, fullList) {
    const merchantsElement = document.getElementById(merchantsId);
    const buttonElement = document.getElementById(buttonId);
    
    if (!merchantsElement || !buttonElement) return;
    
    const isExpanded = buttonElement.textContent.includes('收起');
    
    if (isExpanded) {
        // 收起
        merchantsElement.textContent = shortList;
        const totalCount = fullList.split('、').length;
        buttonElement.textContent = `... 顯示全部${totalCount}個`;
    } else {
        // 展開
        merchantsElement.textContent = fullList;
        buttonElement.textContent = '收起';
    }
}

// 用戶筆記相關功能
let currentNotesCardId = null;
let lastSavedNotes = new Map(); // 記錄每張卡最後儲存的內容

// 讀取用戶筆記 (註: 筆記僅依賴cardId，與userSelectedCards狀態無關)
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
        
        // 更新本地快取和記錄
        localStorage.setItem(cacheKey, notes);
        lastSavedNotes.set(cardId, notes);
        
        return notes;
    } catch (error) {
        console.log('讀取筆記失敗，使用本地快取:', error);
        const localNotes = localStorage.getItem(cacheKey) || '';
        lastSavedNotes.set(cardId, localNotes);
        return localNotes;
    }
}

// 本地儲存（自動備份）
function autoBackupNotes(cardId, notes) {
    const cacheKey = auth.currentUser ? `notes_${auth.currentUser.uid}_${cardId}` : `notes_${cardId}`;
    localStorage.setItem(cacheKey, notes);
}

// 手動儲存筆記
async function saveUserNotes(cardId, notes) {
    const saveBtn = document.getElementById('save-notes-btn');
    const saveIndicator = document.getElementById('save-indicator');
    const btnText = document.querySelector('.btn-text');
    const btnIcon = document.querySelector('.btn-icon');
    
    if (!auth.currentUser) {
        // 未登入時僅儲存在本地
        autoBackupNotes(cardId, notes);
        lastSavedNotes.set(cardId, notes);
        
        // 更新按鈕狀態
        saveBtn.disabled = true;
        saveIndicator.textContent = '已儲存在本地 (未登入)';
        saveIndicator.style.color = '#6b7280';
        return true;
    }
    
    try {
        // 更新按鈕為儲存中狀態
        saveBtn.className = 'save-notes-btn saving';
        saveBtn.disabled = true;
        btnIcon.textContent = '⏳';
        btnText.textContent = '儲存中...';
        saveIndicator.textContent = '';
        
        const docRef = window.doc ? window.doc(db, 'userNotes', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.setDoc) throw new Error('Firestore not available');
        await window.setDoc(docRef, {
            notes: notes,
            updatedAt: new Date(),
            cardId: cardId
        });
        
        // 也儲存在本地作為快取
        autoBackupNotes(cardId, notes);
        lastSavedNotes.set(cardId, notes);
        
        // 成功狀態
        saveBtn.className = 'save-notes-btn success';
        btnIcon.textContent = '✓';
        btnText.textContent = '已儲存';
        saveIndicator.textContent = '✓ 雲端同步成功';
        saveIndicator.style.color = '#10b981';
        
        // 2秒後恢復正常狀態
        setTimeout(() => {
            saveBtn.className = 'save-notes-btn';
            saveBtn.disabled = true; // 沒有變更時保持禁用
            btnIcon.textContent = '💾';
            btnText.textContent = '儲存筆記';
            saveIndicator.textContent = '';
        }, 2000);
        
        return true;
        
    } catch (error) {
        console.error('雲端儲存失敗:', error);
        
        // 失敗時仍然儲存在本地
        autoBackupNotes(cardId, notes);
        
        // 錯誤狀態
        saveBtn.className = 'save-notes-btn';
        saveBtn.disabled = false; // 可以再次嘗試
        btnIcon.textContent = '⚠️';
        btnText.textContent = '重試儲存';
        saveIndicator.textContent = '雲端儲存失敗，已本地儲存';
        saveIndicator.style.color = '#dc2626';
        
        // 5秒後恢復
        setTimeout(() => {
            btnIcon.textContent = '💾';
            btnText.textContent = '儲存筆記';
            saveIndicator.textContent = '';
        }, 5000);
        
        return false;
    }
}

// 檢查筆記是否有變更
function hasNotesChanged(cardId, currentNotes) {
    const lastSaved = lastSavedNotes.get(cardId) || '';
    return currentNotes !== lastSaved;
}

// 更新儲存按鈕狀態
function updateSaveButtonState(cardId, currentNotes) {
    const saveBtn = document.getElementById('save-notes-btn');
    if (!saveBtn) return;
    
    const hasChanged = hasNotesChanged(cardId, currentNotes);
    saveBtn.disabled = !hasChanged;
    
    if (hasChanged && !saveBtn.className.includes('saving')) {
        saveBtn.className = 'save-notes-btn';
    }
}

// 免年費狀態相關功能

// 讀取免年費狀態
async function loadFeeWaiverStatus(cardId) {
    if (!auth.currentUser) return false;
    
    try {
        const docRef = window.doc ? window.doc(db, 'feeWaiverStatus', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.getDoc) throw new Error('Firestore not available');
        const docSnap = await window.getDoc(docRef);
        return docSnap.exists() ? docSnap.data().isWaived : false;
    } catch (error) {
        console.log('讀取免年費狀態失敗:', error);
        const localKey = `feeWaiver_${auth.currentUser?.uid || 'local'}_${cardId}`;
        return localStorage.getItem(localKey) === 'true';
    }
}

// 儲存免年費狀態
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
        console.log('免年費狀態已同步至雲端');
    } catch (error) {
        console.error('雲端儲存免年費狀態失敗:', error);
    }
}

// 設置免年費狀態功能
async function setupFeeWaiverStatus(cardId) {
    const checkbox = document.getElementById('fee-waiver-checked');
    if (!checkbox) return;
    
    // 讀取當前狀態
    const isWaived = await loadFeeWaiverStatus(cardId);
    checkbox.checked = isWaived;
    
    // 設置變更監聽
    checkbox.onchange = (e) => {
        const newStatus = e.target.checked;
        saveFeeWaiverStatus(cardId, newStatus);
        
        // 更新視覺提示 (可選)
        const checkboxLabel = e.target.parentElement.querySelector('.checkbox-label');
        if (newStatus) {
            checkboxLabel.style.color = '#10b981';
            setTimeout(() => {
                checkboxLabel.style.color = '';
            }, 1000);
        }
    };
}

// 結帳日期相關功能

// 讀取結帳日期
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
        console.log('讀取結帳日期失敗:', error);
        const localKey = `billingDates_${auth.currentUser?.uid || 'local'}_${cardId}`;
        const saved = localStorage.getItem(localKey);
        return saved ? JSON.parse(saved) : defaultDates;
    }
}

// 儲存結帳日期
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
        console.log('結帳日期已同步至雲端');
    } catch (error) {
        console.error('雲端儲存結帳日期失敗:', error);
    }
}

// 設置結帳日期功能
async function setupBillingDates(cardId) {
    const billingInput = document.getElementById('billing-date');
    const statementInput = document.getElementById('statement-date');
    
    if (!billingInput || !statementInput) return;
    
    // 讀取已儲存的日期
    const savedDates = await loadBillingDates(cardId);
    billingInput.value = savedDates.billingDate;
    statementInput.value = savedDates.statementDate;
    
    // 為有值的輸入框加上視覺強調
    const updateInputAppearance = (input) => {
        if (input.value.trim() !== '') {
            input.style.borderColor = '#10b981';
            input.style.background = 'white';
            input.style.fontWeight = '600';
        }
    };
    
    updateInputAppearance(billingInput);
    updateInputAppearance(statementInput);
    
    // 儲存功能
    const saveDates = () => {
        const billing = billingInput.value;
        const statement = statementInput.value;
        saveBillingDates(cardId, billing, statement);
        
        // 更新視覺狀態
        updateInputAppearance(billingInput);
        updateInputAppearance(statementInput);
    };
    
    // 設置變更監聽
    billingInput.onchange = saveDates;
    billingInput.onblur = saveDates;
    statementInput.onchange = saveDates;
    statementInput.onblur = saveDates;
    
    // 輸入驗證
    [billingInput, statementInput].forEach(input => {
        input.oninput = (e) => {
            let value = parseInt(e.target.value);
            if (value > 31) e.target.value = 31;
            if (value < 1 && e.target.value !== '') e.target.value = 1;
        };
    });
}
