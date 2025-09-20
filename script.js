// Global variables
let currentUser = null;
let userSelectedCards = new Set(); // Store user's selected card IDs
let cardsData = {
  "cards": [
    {
      "id": "taishin-richart",
      "name": "台新Richart卡",
      "basicCashback": 0.3,
      "cashbackRates": [
        {
          "rate": 3.8,
          "cap": 480000,
          "items": ["台灣Pay場域", "超商（單筆限額最高 NT3,000元，且不含代收水電稅費/禮物卡/儲值"]
        },
        {
          "rate": 3.3,
          "cap": 480000,
          "items": [
            "華航", "長榮", "星宇", "虎航", "國泰航空", "華信", "立榮", "klook", "kkday", "airsim", "agoda", "booking.com", "trip.com", "airbnb", "hotels.com", "expedia", "雄獅旅遊", "易遊網", "東南旅遊", "海外實體", "海外線上", "蝦皮", "momo", "酷澎", "coupang", "pchome", "yahoo", "amazon", "東森", "博客來", "richart mart", "hahow", "pressplay", "amazing talker", "udemy", "kobo", "readmoo", "uniqlo", "gu", "zara", "net", "lativ", "gap", "uber eats", "foodpanda", "中油直營", "台亞直營", "全國加油", "源點evoasis", "華城電能evalue", "拓元售票", "kktix", "年代售票", "寬宏售票", "opentix兩廳院文化生活", "晶華國際酒店集團", "台灣萬豪國際集團旗下飯店", "煙波飯店", "老爺酒店集團", "福華集團", "漢來飯店事業群", "台北君悅酒店", "高雄洲際酒店", "礁溪寒沐", "義大遊樂世界", "麗寶樂園", "六福村主題遊樂園", "九族文化村", "劍湖山世界主題遊樂園", "x-park", "國立海洋生物博物館", "遠雄海洋公園", "大魯閣", "小人國主題樂園", "全台餐飲新光三越", "遠東sogo", "廣三sogo", "遠東百貨", "微風", "台北101", "遠東巨城", "南紡購物中心", "漢神百貨", "漢神巨蛋", "誠品生活", "mitsui shopping park", "lalaport", "mitsui outlet park", "華泰名品城", "skm park outlets", "ikea", "特力屋", "hola", "宜得利", "瑪黑家居", "7-11", "全家", "家樂福", "大買家", "臺鐵", "高鐵", "台灣大車隊", "linego", "yoxi", "uber", "嘟嘟房", "autopass", "城市車旅", "vivipark", "uspace", "udrive", "irent", "和運租車", "格上租車"
          ]
        }
      ]
    },
    {
      "id": "yushan-unicard",
      "name": "玉山Uni卡",
      "basicCashback": 1.0,
      "cashbackRates": [
        {
          "rate": 3.5,
          "cap": 20000,
          "items": [
            "linepay", "街口", "悠遊付", "全盈支付", "全支付", "橘子支付", "momo購物網", "蝦皮購物", "淘寶", "coupang", "東森購物", "博客來", "新光三越", "台北101", "華泰名品城", "三井outlet", "京站", "美麗華", "秀泰生活", "lalaport", "統領廣場", "采盟", "昇恆昌", "太平洋百貨", "統一時代百貨", "遠東百貨", "遠東sogo", "遠東巨城", "大遠百", "漢神百貨", "微風廣場", "微風信義", "微風南京", "微風南山", "微風台北車站", "誠品生活", "誠品線上", "誠品書店", "家樂福", "屈臣氏", "特力屋", "hola", "hoi好好生活", "uniqlo", "net", "大樹藥局", "丁丁藥妝", "uber eats", "ubereats", "foodpanda", "eztable", "王品瘋美食", "摩斯", "路易莎", "饗食天堂", "果然匯", "加集", "開飯", "響泰多", "真珠", "瓦城", "非常泰", "時時香", "1010湘", "大心", "乾杯燒肉居酒屋", "老乾杯", "漢來海港", "島語", "漢來蔬食", "漢來名人坊", "東方樓", "漢來上海湯包", "溜溜酸菜", "魚專賣店", "上菜片皮鴨", "翠園", "漢來軒", "焰", "pavo", "精瀲海鮮火鍋", "日本料理弁慶", "福園台菜海鮮", "日日烘焙坊", "糕餅小舖", "台北漢來大廳酒廊", "hi lai cafe", "台灣中油", "台灣大車隊", "台鐵", "高鐵", "yoxi", "桃園機場捷運", "中華航空", "長榮航空", "日本航空", "台灣虎航", "樂桃航空", "酷航", "立榮航空", "華信航空", "trip.com", "booking.com", "hotels.com", "asiayo", "expedia", "kkday", "klook", "雄獅旅", "可樂旅", "東南旅行社", "apple直營", "小米台灣", "全國電子", "燦坤", "迪卡儂", "寵物公園", "youbike2.0", "youbike 2.0"
          ]
        }
      ]
    },
    {
      "id": "cathay-cube",
      "name": "國泰CUBE卡",
      "basicCashback": 0.3,
      "cashbackRates": [
        {
          "rate": 2.0,
          "cap": null,
          "items": [
            "chatgpt", "canva", "claude", "cursor", "duolingo", "gamma", "gemini", "notion", "perplexity", "speak", "apple 媒體服務", "google play", "disney+", "netflix", "spotify", "kkbox", "youtube premium", "max", "蝦皮", "momo", "pchome", "小樹購", "淘寶/天貓", "遠東sogo百貨", "遠東garden city", "太平洋百貨", "新光三越", "skm park", "bellavita", "微風廣場", "遠東百貨", "big city遠東巨城購物中心", "誠品生活", "環球購物中心", "citylink", "統一時代台北店", "台北101", "att 4 fun", "明曜百貨", "京站", "美麗華", "大葉高島屋", "比漾廣場", "大江國際購物中心", "中友百貨", "廣三sogo", "tiger city", "勤美誠品綠園道", "大魯閣新時代", "耐斯廣場", "南紡購物中心", "夢時代", "漢神百貨", "漢神巨蛋", "mitsui outlet park", "mitsui shopping park lalaport", "義大世界購物廣場", "華泰名品城", "義享天地", "麗寶outlet mall", "秀泰生活", "台茂購物中心", "新月廣場", "三創生活", "宏匯廣場", "noke忠泰樂生活", "uber eats", "foodpanda", "國內餐飲", "麥當勞", "康是美", "屈臣氏", "海外實體消費", "東京迪士尼樂園", "東京華納兄弟哈利波特影城", "大阪環球影城", "apple錢包指定交通卡", "uber", "grab", "台灣高鐵", "yoxi", "台灣大車隊", "irent", "和運租車", "格上租車", "中華航空", "長榮航空", "星宇航空", "台灣虎航", "國泰航空", "樂桃航空", "阿聯酋航空", "酷航", "捷星航空", "日本航空", "ana全日空", "亞洲航空", "聯合航空", "新加坡航空", "越捷航空", "大韓航空", "達美航空", "土耳其航空", "卡達航空", "法國航空", "星野集團", "全球迪士尼飯店", "東橫inn", "國內飯店住宿", "kkday", "agoda", "klook", "airbnb", "booking.com", "trip.com", "eztravel易遊網", "雄獅旅遊", "可樂旅遊", "東南旅遊", "五福旅遊", "燦星旅遊", "山富旅遊", "長汎假期", "鳳凰旅行社", "ezfly易飛網", "理想旅遊", "永利旅行社", "三賀旅行社", "家樂福", "lopia台灣", "全聯福利中心", "台灣中油-直營站", "7-11", "全家", "ikea", "linepay"
          ]
        }
      ],
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
          "conditions": "需透過CUBE App領取優惠券，實體NT$50,000或網路NT$2,000消費門檧",
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
      "basicCashback": 1.0,
      "cashbackRates": [
        {
          "rate": 7.0,
          "cap": 7500,
          "items": [
            "world gym", "健身工廠", "true yoga", "curves", "運動中心", "anytime fitness", "屈臣氏", "康是美", "寶雅", "好心肝", "杏一", "大樹藥局", "丁丁藥局", "新高橋藥局", "app store", "google play", "nintendo", "playstation", "steam", "apple pay", "google pay", "samsung pay", "garmin pay"
          ]
        }
      ]
    },
    {
      "id": "sinopac-green",
      "name": "永豐Green卡",
      "basicCashback": 1.0,
      "cashbackRates": [
        {
          "rate": 5.0,
          "cap": 7500,
          "items": [
            "藏壽司", "mos", "築間", "義美食品", "馬可先生", "寬心園", "miacucina", "小小樹食", "陽明春天", "屋馬", "熱浪島", "草蔬宴", "原素食府", "herbivore", "印度蔬食", "養心茶樓", "山海樓", "qburger", "麥味登", "一之軒", "捷絲旅", "承億", "煙波", "翰品", "希爾頓", "國賓", "福容", "新驛", "圓山", "城市商旅", "凱薩", "老爺", "新光影城", "威秀", "喜樂時代", "kktix", "拓元售票", "全國電子", "studioa", "straighta", "大潤發", "家樂福", "愛買", "uniqlo", "h&m", "zara", "gu", "gap", "net", "o'right", "aesop", "10/10 hope", "主婦聯盟", "里仁", "棉花田", "聖德科斯", "義美生機", "統一生機", "綠藤生機", "茶籽堂", "艾瑪絲", "長庚生技", "營養師輕食", "安永鮮物", "野菜村", "無毒的家", "無毒農", "健康食彩", "直接跟農夫買", "irent", "zipcar", "gosmart", "goshare", "gogoro", "wemo", "line go", "tesla 充電", "裕電俥電", "evalue", "evoasis", "sharkparking", "zocha", "begin", "星舟快充", "emoving", "emoving 電池", "悠遊卡自動加值", "悠遊卡加值", "悠遊卡 自動加值"
          ]
        }
      ]
    },
    {
      "id": "sinopac-daway",
      "name": "永豐DAWAY卡",
      "basicCashback": 0.5,
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
      "basicCashback": 1.0,
      "cashbackRates": [
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
      "basicCashback": 0.5,
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
      "basicCashback": 0.3,
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
      "basicCashback": 1.88,
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
    }
  ]
};
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
document.addEventListener('DOMContentLoaded', () => {
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
        chip.className = 'card-chip';
        chip.textContent = card.name;
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
    
    for (const card of cardsData.cards) {
        for (const rateGroup of card.cashbackRates) {
            for (const item of rateGroup.items) {
                if (item.toLowerCase().includes(searchTerm) || 
                    searchTerm.includes(item.toLowerCase())) {
                    return {
                        originalItem: item,
                        searchTerm: searchTerm
                    };
                }
            }
        }
    }
    return null;
}

// Show matched item
function showMatchedItem(matchedItem) {
    matchedItemDiv.innerHTML = `✓ 系統匹配到: <strong>${matchedItem.originalItem}</strong>`;
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
                } else {
                    basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
                }
                
                return {
                    rate: effectiveRate,
                    cashbackAmount: basicCashbackAmount,
                    cap: null,
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
            } else {
                basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
            }
            
            return {
                rate: effectiveRate,
                cashbackAmount: basicCashbackAmount,
                cap: null,
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
    
    for (const rateGroup of card.cashbackRates) {
        for (const item of rateGroup.items) {
            if (item.toLowerCase().includes(searchTerm) || 
                searchTerm.includes(item.toLowerCase())) {
                if (rateGroup.rate > bestRate) {
                    bestRate = rateGroup.rate;
                    applicableCap = rateGroup.cap;
                    matchedItem = item;
                    matchedCategory = rateGroup.category || null;
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
        
        // Add basic cashback for the same amount (layered rewards)
        let basicCashback = Math.floor(effectiveSpecialAmount * card.basicCashback / 100);
        
        // Handle remaining amount if capped
        let remainingCashback = 0;
        if (applicableCap && amount > applicableCap) {
            const remainingAmount = amount - applicableCap;
            remainingCashback = Math.floor(remainingAmount * card.basicCashback / 100);
        }
        
        cashbackAmount = specialCashback + basicCashback + remainingCashback;
        totalRate = bestRate + card.basicCashback;
        effectiveAmount = applicableCap; // Keep this for display purposes
    }
    
    return {
        rate: totalRate,
        specialRate: bestRate,
        basicRate: card.basicCashback,
        cashbackAmount: cashbackAmount,
        cap: applicableCap,
        matchedItem: matchedItem,
        matchedCategory: matchedCategory,
        effectiveAmount: effectiveAmount
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
    
    const capText = result.cap ? `NT$${result.cap.toLocaleString()}` : '無上限';
    const cashbackText = result.cashbackAmount > 0 ? 
                        `NT$${result.cashbackAmount.toLocaleString()}` : 
                        '無回饋';
    
    // Format rate display for complex cards
    let rateDisplay = result.rate > 0 ? `${result.rate}%` : '0%';
    if (result.specialRate && result.basicRate && result.specialRate > 0) {
        rateDisplay = `${result.specialRate}%+${result.basicRate}%`;
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
            </div>
            <div class="detail-item">
                <div class="detail-label">消費限制</div>
                <div class="detail-value">${capText}</div>
            </div>
        </div>
        ${isBasicCashback ? `
            <div class="matched-merchant">
                一般消費回饋率
            </div>
        ` : (result.matchedItem ? `
            <div class="matched-merchant">
                匹配項目: <strong>${result.matchedItem}</strong>${result.matchedCategory ? ` (類別: ${result.matchedCategory})` : ''}
            </div>
        ` : `
            <div class="matched-merchant">
                此卡無此項目回饋
            </div>
        `)}
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
        if (typeof window.firebaseAuth !== 'undefined') {
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
            const result = await window.signInWithPopup(window.firebaseAuth, window.googleProvider);
            console.log('Sign in successful:', result.user);
        } catch (error) {
            console.error('Sign in failed:', error);
            alert('登入失敗：' + error.message);
        }
    });
    
    // Sign out function
    signOutBtn.addEventListener('click', async () => {
        try {
            await window.signOut(window.firebaseAuth);
            console.log('Sign out successful');
        } catch (error) {
            console.error('Sign out failed:', error);
        }
    });
    
    // Listen for authentication state changes
    window.onAuthStateChanged(window.firebaseAuth, async (user) => {
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
    
    modal.style.display = 'flex';
}
