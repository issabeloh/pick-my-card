// 測試用的活動原文（仿官網寫法，數字為虛構）。parser-test.js 與 ui-test.js 共用。
module.exports = {
  artfunComposition: {
    card: 'tbb-artfun', kind: 'rate',
    text: '藝FUN卡 指定藝文通路加碼\n活動期間：2027/1/1～2027/6/30\n於指定通路消費最高享3%現金回饋（即原卡片國內一般消費回饋0.5%，國內一般消費加碼2.5%，加碼回饋每戶每月上限500元，需登錄）。\n指定通路：威秀影城、秀泰影城、誠品書店、KKTIX、好樂迪KTV\n注意事項：排除分期付款及預借現金。\n登錄網址 https://ebank.tbb.com.tw/nb3/CREDIT/REGISTRATION/registration_init'
  },
  ubearBonusOnly: {
    card: 'yushan-ubear', kind: 'rate',
    text: '【超商加碼】\n活動期間：115年1月1日至115年3月31日\n玉山U Bear信用卡於 7-ELEVEN、全家便利商店 單筆消費滿NT$300，加碼2%玉山e point，每月回饋上限100點。\n不含代收代付、儲值。'
  },
  excludedType: {
    card: 'fubon-jcard', kind: 'rate',
    text: '富邦J卡 日本交通卡儲值\n2026/10/1-12/31 Apple Pay 綁定富邦J卡儲值 Suica、PASMO、ICOCA 享10%回饋，活動期間回饋上限NT$200，本活動回饋不併計一般消費回饋。須每月登錄，每月限量5,000名。'
  },
  noRate: { card: 'yushan-ubear', kind: 'rate', text: '持卡至指定餐廳消費享9折優惠，詳見官網。' },
  promoGift: {
    card: 'fubon-jcard', kind: 'promo',
    text: '富邦J卡 新戶首刷禮\n活動期間：2027/1/1~2027/3/31\n新戶核卡後30天內完成以下任務，即贈 TRAVEL FOX 25吋上掀式行李箱（市價NT$5,980）：\n1. 新增3筆一般消費且每筆滿NT$1,000。\n2. 設定本行帳戶自動扣繳或申請電子帳單。\n3. 完成活動登錄。\n限2027/4/15前核卡。新戶定義：申辦日前6個月未持有任何富邦信用卡正卡。不得與本行其他新戶刷卡禮活動並行。\nhttps://www.fubon.com/banking/personal/credit_card/all_card/omiyage/omiyage.htm'
  },
  promoVoucher: {
    card: 'sinopac-green', kind: 'promo',
    text: '永豐Green卡新戶禮：核卡後30日內一般消費累積滿2,000元，贈300元刷卡金。活動期間 2027/1/1~2027/6/30，需登錄。'
  },
  promoBonus: {
    card: 'yushan-ubear', kind: 'promo',
    text: '玉山U Bear卡新卡友加碼\n2027/1/1~2027/2/28 核卡後60天內於蝦皮購物、momo、PChome消費享加碼10%回饋，回饋上限1,200點玉山e point。'
  }
};
