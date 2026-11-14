// 解析核心的回歸測試：node tools/activity-writer/parser-test.js（任何一條不符 → exit 1）
const fs = require('fs'), path = require('path');
const P = require('./parser.js'), S = require('./samples.js');
const data = JSON.parse(Buffer.from(fs.readFileSync(path.join(__dirname, '../regression/fixture.data'), 'utf8'), 'base64').toString('utf8'));
const idx = P.buildIndex(data);
let fail = 0;
const eq = (label, got, want) => { if (String(got) !== String(want)) { fail++; console.error('❌ ' + label + '\n   得到：' + got + '\n   應為：' + want); } };
const has = (label, got, part) => { if (String(got).indexOf(part) < 0) { fail++; console.error('❌ ' + label + '\n   得到：' + got + '\n   應包含：' + part); } };
const run = (s) => (s.kind === 'promo' ? P.parsePromo : s.kind === 'coupon' ? P.parseCoupon : P.parseActivity)(idx, s.card, s.text);

let r = run(S.artfunComposition), f = r.fields;
eq('組成句 rate', f.rate, '2.5'); eq('組成句 model', f.cashbackModel, 'rate+basic');
eq('組成句 cap＝500÷2.5%', f.cap, '20000'); eq('組成句 起', f.periodStart, '2027/1/1'); eq('組成句 迄', f.periodEnd, '2027/6/30');
has('既有寫法', f.items, '威秀影城'); has('新通路', f.items, '好樂迪KTV'); has('條件', f.conditions, '需登錄'); has('排除', f.conditions, '排除分期付款');
eq('登錄連結', f.registerLink, 'https://ebank.tbb.com.tw/nb3/CREDIT/REGISTRATION/registration_init');
eq('組成句有把握', r.notes.rate.level, 'ok');

r = run(S.ubearBonusOnly); f = r.fields;
eq('只講加碼 rate', f.rate, '2'); eq('只講加碼 model', f.cashbackModel, 'rate+basic'); eq('只講加碼 cap', f.cap, '5000');
eq('單筆門檻', f.minSpend, '300'); eq('民國年', f.periodStart + '~' + f.periodEnd, '2026/1/1~2026/3/31');
eq('分類取【】', f.category, '超商加碼'); eq('只講加碼要確認', r.notes.rate.level, 'check');
has('統一寫法 7-11', f.items, idx.vocab[P.termKey('7-ELEVEN')] || '7-ELEVEN');

r = run(S.excludedType); f = r.fields;
eq('排除型 rate', f.rate, '10'); eq('排除型 model', f.cashbackModel, 'rate'); eq('排除型 cap', f.cap, '2000');
eq('省略年份的結束日', f.periodEnd, '2026/12/31'); has('每月登錄限量', f.conditions, '需每月登錄，限量5,000名');
eq('限量名額不當成上限', r.capInfo.reward, 200);

r = run(S.noRate); eq('沒有率 → 空', r.fields.rate, ''); eq('沒有率 → 標記', r.notes.rate.level, 'empty');

r = run(S.promoGift); f = r.fields;
eq('新戶 id', f.id, 'fubon-jcard'); has('首刷禮類型', f.promo_types, '首刷禮'); has('品名', f.gift_content, 'TRAVEL FOX 25吋上掀式行李箱');
eq('吋', f.luggage_inch, '25'); eq('市價', f.luggage_value, '5980'); eq('期間', f.period_start + '~' + f.period_end, '2027/1/1~2027/3/31');
has('任務編號', f.promo_condition, '①新增3筆一般消費且每筆滿NT$1,000\n②'); has('核卡期限', f.notes, '限於2027/4/15前核卡');
eq('active', f.active, 'TRUE'); eq('申辦連結沿用', f.apply_cta_link, (data.cardApplyCtas['fubon-jcard'] || {}).link || '');
has('活動連結', f.link, 'https://www.fubon.com/');

r = run(S.promoVoucher); f = r.fields;
eq('定額類型', f.promo_types, '定額回饋'); eq('金額', f.voucher_amount, '300'); eq('形式', f.voucher_usage, '刷卡金'); eq('門檻', f.min_spend, '2000');
has('摘要草稿', f.new_customer_summary, '核卡後30日內');

r = run(S.promoBonus); f = r.fields;
eq('加碼率小數', f.bonus_rate, '0.1'); eq('加碼消費上限', f.bonus_cap, '12000'); has('加碼通路', f.bonus_merchants.toLowerCase(), 'momo');

// 特定族群新戶（保險新戶）＋領券型＋「最高 8% ＝ 加碼 6% ＋ 原權益 2%」——站長 2026-11-13 實測回報
r = run(S.promoInsurance); f = r.fields;
eq('保險新戶：卡片偵測', P.detectCard(idx, S.promoInsurance.text), 'taishin-richart');
eq('保險新戶：定義用原文的、不沿用全行新戶', f.new_customer_definition, '2025/11/1~2026/10/31期間未以任一台新卡刷保費或累積金額1,000元(含)以下');
eq('保險新戶：摘要', f.new_customer_summary, '保險新戶刷首筆保費，符合條件享最高8%');
eq('保險新戶：bonus_rate 只填加碼的 6%', f.bonus_rate, '0.06');
eq('保險新戶：通路只留類別詞', f.bonus_merchants, '保險,保費');
eq('保險新戶：cap 用加碼率換算', f.bonus_cap, '8333.33');
eq('保險新戶：條件草稿', f.promo_condition, '①保險新戶刷首筆保費一次付清，享6%台新Point\n②節假日搭配切換「假日刷」+2%；免切換+1.3%\n③需領券，限量200,000張\n④完成設定「台新銀行帳戶扣繳台新銀行信用卡帳款」，且於回饋當時須持續使用未取消');
eq('保險新戶：notes 只抄原文寫的', f.notes, '與保費分期0利率僅可擇一適用');
eq('priority 欄已刪', P.PROMO_COLS.indexOf('priority'), -1);
eq('排除字在清單後面', r.chips.items.filter(x => /line ?pay/i.test(x.name))[0].excluded, true);
eq('提到別的活動的登錄不算條件', P.findConditions('若同時領券及登錄分期活動，優先適用分期').some(c => /登錄/.test(c.text)), false);

// 領券活動（CUBE App 領券加碼 7%）——站長 2026-11-13 第二個實測原文
eq('領券：卡片偵測（不被清單裡的 LINE Pay 帶走）', P.detectCard(idx, S.cubeCoupon.text), 'cathay-cube');
eq('領券：類型偵測', P.detectKind(P.normalizeText(S.cubeCoupon.text)), 'coupon');
eq('新戶＋領券仍是新戶', P.detectKind(P.normalizeText(S.promoInsurance.text)), 'promo');
r = run(S.cubeCoupon); f = r.fields;
eq('領券：通路只有小樹購（不含 Apple Pay、假日）', f.couponMerchant, '小樹購');
eq('領券：率', f.couponRate, '7'); eq('領券：cap＝700÷7%', f.couponCap, '10000');
eq('領券：條件', f.couponConditions, '排除含有「小樹購電子票券商品」之整筆訂單消費；限直接使用CUBE信用卡刷卡或使用該卡加入 Apple Pay / Samsung Pay / Google Pay等消費；可與「玩數位」權益疊加；需至 CUBE App 領券');
eq('領券：期間', f.couponPeriodStart + '~' + f.couponPeriodEnd, '2026/11/1~2026/11/30');
eq('領券：輸出 6 欄', P.buildCouponRow(f).length, 6); eq('領券：格式檢查通過', P.validate('coupon', f).length, 0);
r = P.parseActivity(idx, 'cathay-cube', S.cubeCoupon.text); f = r.fields;
eq('同一段當一般活動：category 留空（不取第一行、不猜）', f.category, '');
eq('同一段當一般活動：items', f.items, '小樹購');
eq('同一段當一般活動：排除條款不重複、不收雜句', f.conditions, '排除含有「小樹購電子票券商品」之整筆訂單消費；限直接使用CUBE信用卡刷卡或使用該卡加入 Apple Pay / Samsung Pay / Google Pay等消費；可與「玩數位」權益疊加');
eq('「遇假日順延」不是限假日', /限假日/.test(f.conditions), false);

// 多個活動：有【活動1】【活動2】才拆；只在內文提到活動2 → 只提示
let sp = P.splitActivities(S.cubeCoupon.text);
eq('單一標題不拆', [sp.explicit, sp.parts.length].join(), 'false,0'); eq('內文提到活動2 → 有提示', /活動1、活動2/.test(sp.hint), true);
eq('一般單一活動沒有提示', P.splitActivities(S.artfunComposition.text).hint, '');
eq('同一活動講兩次的【】段落不算多個', P.splitActivities(S.promoInsurance.text).hint, '');
eq('回饋率不同的【】段落 → 只提示不拆', (sp = P.splitActivities('【超商加碼】\n7-ELEVEN 享3%回饋\n【網購加碼】\nmomo 享5%回饋'), [sp.explicit, /可能有 2 個活動/.test(sp.hint)].join()), 'false,true');
sp = P.splitActivities(S.cubeTwoActivities.text);
eq('兩個編號標題 → 拆成兩份', [sp.explicit, sp.parts.map(x => x.title).join('|')].join(), 'true,活動1：CUBE信用卡領券加碼最高享7%回饋|活動2：蝦皮購物加碼3%');
eq('每份都帶共用的活動期間', sp.parts.every(x => x.text.includes('2026/11/01 ~ 2026/11/30')), true);
eq('每份都帶最後的共用注意事項', sp.parts.every(x => x.text.includes('不可歸責於本行及小樹購之事由')), true);
eq('點名活動1 的句子不進活動2', [sp.parts[1].text.includes('雙11限定加碼7%'), sp.parts[0].text.includes('雙11限定加碼7%')].join(), 'false,true');
eq('點名活動2 的句子不進活動1', [sp.parts[0].text.includes('店到店運費'), sp.parts[1].text.includes('店到店運費')].join(), 'false,true');
eq('別的活動的標題與內文不混進來', [sp.parts[0].text.includes('蝦皮購物消費'), sp.parts[1].text.includes('雙11限時加碼')].join(), 'false,false');
r = P.parseCoupon(idx, 'cathay-cube', sp.parts[0].text); eq('拆開後活動1：率／cap 同單獨貼', r.fields.couponRate + '|' + r.fields.couponCap, '7|10000');
r = P.parseActivity(idx, 'cathay-cube', sp.parts[1].text); eq('拆開後活動2：通路與期間', [r.fields.items.split(',')[0], r.fields.rate, r.fields.periodStart, r.fields.periodEnd].join('|'), '蝦皮購物|3|2026/11/1|2026/11/30');
eq('拆開後各自的類型（只看自己那一段）', sp.parts.map(x => P.detectKind(P.normalizeText(x.own))).join(), 'coupon,rate');

// 輸出
const row = P.buildRateRow(run(S.ubearBonusOnly).fields, 'value', new Date(2026, 0, 1));
eq('一般活動 13 欄', row.length, 13); eq('period 純值', row[12], '2026/1/1~2026/3/31'); eq('daysRemaining 純值', row[11], '89');
const tsv = P.toTsv([P.buildRateRow(run(S.ubearBonusOnly).fields, 'formula')]);
eq('TSV 欄數', tsv.split('\t').length, 13); eq('公式不含引號', /"/.test(tsv), false);
const own = P.buildRateRow(run(S.ubearBonusOnly).fields, 'formula', null, 'cb15');
eq('站長公式 daysRemaining', own[11].formula, '=IF(ISBLANK(CL15),"",CL15-TODAY())');
eq('站長公式 period', own[12].formula, '=IF(OR(ISBLANK(CK15),ISBLANK(CL15)),"",TEXT(CK15,"yyyy/m/d")&"~"&TEXT(CL15,"yyyy/m/d"))');
eq('站長公式貼上不加引號', P.toTsv([own]).split('\t')[11], '=IF(ISBLANK(CL15),"",CL15-TODAY())');
eq('跨 Z 欄', P.sheetFormulas('Q3').days, '=IF(ISBLANK(AA3),"",AA3-TODAY())');
const ptsv = P.toTsv([P.buildPromoRow(run(S.promoGift).fields)]);
eq('新戶 26 欄（正式表表頭）', P.PROMO_COLS.join(','), 'id,promo_types,new_customer_definition,new_customer_summary,promo_condition,period_start,period_end,min_spend,gift_content,gift_image_url,luggage_inch,luggage_value,bonus_rate,bonus_merchants,bonus_cap,voucher_amount,voucher_usage,notes,link,active,apply_cta_text,apply_cta_link,apply_cta_expiry,pick_rank,pick_question,pick_reason'); has('多行格子加引號', ptsv, '"①');
eq('文字以 = 開頭要跳脫', P.toTsv([['=abc', '+1%']]), "'=abc\t'+1%");
eq('卡片偵測', P.detectCard(idx, S.promoBonus.text), 'yushan-ubear'); eq('類型偵測', P.detectKind(S.promoBonus.text), 'promo');
eq('驗證：bonus_rate 填成百分比', P.validate('promo', Object.assign({}, f, { bonus_rate: '10' })).some(x => /小數/.test(x)), true);
eq('驗證：好的一列沒問題', P.validate('rate', run(S.artfunComposition).fields).length, 0);

// AI 結果套用（不打 API）
const ai = P.applyAiActivity(idx, 'tbb-artfun', { headline_rate: 3, bonus_rate: 2.5, includes_basic: '是', group_kind: '指定通路加碼',
  items: ['威秀影城', 'kktix'], cap_reward: 500, conditions: '需登錄; 排除分期。', period_start: '2027/01/01', period_end: '2027/06/30', evidence: 'x', needs_review: false });
eq('AI rate', ai.fields.rate, '2.5'); eq('AI cap', ai.fields.cap, '20000'); eq('AI 條件正規化', ai.fields.conditions, '需登錄；排除分期'); eq('AI 日期', ai.fields.periodStart, '2027/1/1');
const req = P.buildAiRequest(idx, 'promo', 'fubon-jcard', S.promoGift.text);
has('AI prompt 帶卡片', req.system, 'fubon-jcard');

console.log(fail ? `\n${fail} 項不符` : '✅ parser-test 全部通過');
process.exit(fail ? 1 : 0);
