/**
 * Cloudflare Pages Function: 後端計算測試版
 * 路由: /api/calculate
 *
 * 目的：
 * 1. 測試後端計算的實際 CPU 時間
 * 2. 確認是否超過免費額度（10ms）
 * 3. 評估速度影響
 */

import cardsDataContent from '../cards.data.js';

// 解析 cards.data
function loadCardsData() {
  const decoded = decodeURIComponent(escape(atob(cardsDataContent)));
  return JSON.parse(decoded);
}

// 簡化的搜尋邏輯（從 script.js 移植核心部分）
function searchCards(cardsData, keyword, amount) {
  const results = [];
  const searchTerm = keyword.toLowerCase().trim();

  if (!searchTerm || !amount || amount <= 0) {
    return results;
  }

  // 遍歷所有卡片
  for (const card of cardsData.cards) {
    const cashback = calculateCardCashback(card, searchTerm, amount);

    if (cashback > 0) {
      results.push({
        cardId: card.id,
        cardName: card.name,
        fullName: card.fullName,
        cashback: cashback,
        rate: ((cashback / amount) * 100).toFixed(2),
        website: card.website
      });
    }
  }

  // 按回饋金額排序
  results.sort((a, b) => b.cashback - a.cashback);

  return results;
}

// 簡化的回饋計算邏輯
function calculateCardCashback(card, searchTerm, amount) {
  let bestCashback = 0;

  // 檢查 cashbackRates
  if (card.cashbackRates && Array.isArray(card.cashbackRates)) {
    for (const rateGroup of card.cashbackRates) {
      if (!rateGroup.items) continue;

      // 檢查是否匹配搜尋關鍵字
      const matched = rateGroup.items.some(item =>
        item.toLowerCase().includes(searchTerm)
      );

      if (matched) {
        const rate = parseFloat(rateGroup.rate) || 0;
        const cap = parseFloat(rateGroup.cap) || Infinity;

        // 計算回饋
        let cashback = (amount * rate) / 100;
        if (cashback > cap) {
          cashback = cap;
        }

        bestCashback = Math.max(bestCashback, cashback);
      }
    }
  }

  // 檢查 specialItems
  if (card.specialItems && Array.isArray(card.specialItems)) {
    for (const item of card.specialItems) {
      if (typeof item === 'string' && item.toLowerCase().includes(searchTerm)) {
        // 使用 specialRate 或 levelSettings
        const rate = card.levelSettings?.specialRate || 0;
        const cashback = (amount * rate) / 100;
        bestCashback = Math.max(bestCashback, cashback);
      }
    }
  }

  // 檢查 generalItems
  if (card.generalItems && typeof card.generalItems === 'object') {
    for (const items of Object.values(card.generalItems)) {
      if (Array.isArray(items)) {
        const matched = items.some(item =>
          typeof item === 'string' && item.toLowerCase().includes(searchTerm)
        );
        if (matched) {
          const rate = card.levelSettings?.generalRate || card.basicCashback || 0;
          const cashback = (amount * rate) / 100;
          bestCashback = Math.max(bestCashback, cashback);
        }
      }
    }
  }

  return Math.round(bestCashback);
}

// 主要 API 處理函數
export async function onRequest(context) {
  // 記錄開始時間（高精度）
  const startTime = Date.now();
  const startCpuTime = performance.now();

  try {
    // CORS headers
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 處理 OPTIONS 預檢請求
    if (context.request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    // 只允許 POST 請求
    if (context.request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: '只支援 POST 請求'
      }), { status: 405, headers });
    }

    // 解析請求參數
    const body = await context.request.json();
    const { keyword, amount } = body;

    if (!keyword || !amount) {
      return new Response(JSON.stringify({
        error: '缺少必要參數：keyword 和 amount'
      }), { status: 400, headers });
    }

    // 載入資料
    const loadStartTime = performance.now();
    const cardsData = loadCardsData();
    const loadTime = performance.now() - loadStartTime;

    // 執行搜尋和計算
    const searchStartTime = performance.now();
    const results = searchCards(cardsData, keyword, amount);
    const searchTime = performance.now() - searchStartTime;

    // 計算總時間
    const totalCpuTime = performance.now() - startCpuTime;
    const totalWallTime = Date.now() - startTime;

    // 回傳結果和效能數據
    return new Response(JSON.stringify({
      success: true,
      keyword: keyword,
      amount: amount,
      results: results.slice(0, 20), // 只回傳前 20 張卡
      resultCount: results.length,

      // 🔍 效能數據（關鍵！）
      performance: {
        totalCpuTime: `${totalCpuTime.toFixed(2)}ms`,
        totalWallTime: `${totalWallTime}ms`,
        loadDataTime: `${loadTime.toFixed(2)}ms`,
        searchTime: `${searchTime.toFixed(2)}ms`,
        cardsProcessed: cardsData.cards.length,

        // ⚠️ 是否超過免費額度
        exceedsFreeLimit: totalCpuTime > 10,
        freeLimitStatus: totalCpuTime > 10
          ? `❌ 超過免費額度 (${(totalCpuTime - 10).toFixed(2)}ms over)`
          : `✅ 在免費額度內 (剩餘 ${(10 - totalCpuTime).toFixed(2)}ms)`
      }
    }), {
      headers,
      status: 200
    });

  } catch (error) {
    const totalTime = Date.now() - startTime;

    return new Response(JSON.stringify({
      error: '伺服器錯誤',
      message: error.message,
      totalTime: `${totalTime}ms`
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      status: 500
    });
  }
}
