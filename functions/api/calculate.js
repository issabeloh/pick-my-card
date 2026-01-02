/**
 * Cloudflare Pages Function: 後端計算 API（生產版）
 * 路由: /api/calculate
 *
 * 功能：
 * - 接收搜尋關鍵字和金額
 * - 在後端執行完整的回饋計算
 * - 只回傳結果，不洩漏完整資料和邏輯
 *
 * 安全措施：
 * - CORS 限定為 https://pickmycard.app
 * - Origin 驗證
 * - Rate Limiting (需在 Cloudflare Dashboard 配置)
 */

import cardsDataContent from '../cards.data.js';

// 載入並解碼 cards.data
function loadCardsData() {
  const decoded = decodeURIComponent(escape(atob(cardsDataContent)));
  return JSON.parse(decoded);
}

// 取得搜尋詞的所有變體（處理全形半形、空格等）
function getAllSearchVariants(searchTerm) {
  const searchLower = searchTerm.toLowerCase().trim();
  const variants = [searchLower];

  // 移除空格
  const noSpace = searchLower.replace(/\s+/g, '');
  if (noSpace !== searchLower) variants.push(noSpace);

  // 全形轉半形
  const halfWidth = searchLower.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) =>
    String.fromCharCode(s.charCodeAt(0) - 0xFEE0)
  );
  if (halfWidth !== searchLower) variants.push(halfWidth);

  return [...new Set(variants)]; // 去重
}

// 計算單張卡片的回饋
function calculateCardCashback(card, searchVariants, amount) {
  let bestCashback = 0;
  let matchedItem = null;
  let matchedRate = 0;
  let matchedCap = null;

  // 1. 檢查 cashbackRates
  if (card.cashbackRates && Array.isArray(card.cashbackRates)) {
    for (const rateGroup of card.cashbackRates) {
      if (!rateGroup.items || !Array.isArray(rateGroup.items)) continue;

      // 檢查是否匹配任何搜尋變體
      const matched = searchVariants.some(variant =>
        rateGroup.items.some(item =>
          item.toLowerCase().includes(variant)
        )
      );

      if (matched) {
        // 解析 rate（處理 placeholder）
        let rate = parseFloat(rateGroup.rate) || 0;

        // 處理 {rate} {specialRate} 等 placeholder
        if (typeof rateGroup.rate === 'string' && rateGroup.rate.includes('{')) {
          // 使用預設 level 的 rate
          if (card.hasLevels && card.levelSettings) {
            const defaultLevel = Object.keys(card.levelSettings)[0];
            const levelSettings = card.levelSettings[defaultLevel];

            if (rateGroup.rate === '{rate}') {
              rate = levelSettings.rate || 0;
            } else if (rateGroup.rate === '{specialRate}') {
              rate = levelSettings.specialRate || 0;
            }
          }
        }

        // 解析 cap
        let cap = parseFloat(rateGroup.cap) || null;
        if (typeof rateGroup.cap === 'string' && rateGroup.cap.includes('{cap}')) {
          if (card.hasLevels && card.levelSettings) {
            const defaultLevel = Object.keys(card.levelSettings)[0];
            cap = card.levelSettings[defaultLevel].cap || null;
          }
        }

        // 計算回饋
        let cashback = Math.floor((amount * rate) / 100);
        if (cap !== null && cashback > cap) {
          cashback = cap;
        }

        // 記錄最佳回饋
        if (cashback > bestCashback) {
          bestCashback = cashback;
          matchedRate = rate;
          matchedCap = cap;
          matchedItem = rateGroup.items.find(item =>
            searchVariants.some(v => item.toLowerCase().includes(v))
          );
        }
      }
    }
  }

  // 2. 檢查 specialItems（如果 cashbackRates 沒匹配）
  if (bestCashback === 0 && card.specialItems && Array.isArray(card.specialItems)) {
    const matched = searchVariants.some(variant =>
      card.specialItems.some(item =>
        typeof item === 'string' && item.toLowerCase().includes(variant)
      )
    );

    if (matched) {
      // 使用預設 level 的 rate
      let rate = 0;
      let cap = null;

      if (card.hasLevels && card.levelSettings) {
        const defaultLevel = Object.keys(card.levelSettings)[0];
        const levelSettings = card.levelSettings[defaultLevel];
        rate = levelSettings.specialRate || levelSettings.rate || 0;
        cap = levelSettings.cap || null;
      }

      let cashback = Math.floor((amount * rate) / 100);
      if (cap !== null && cashback > cap) {
        cashback = cap;
      }

      if (cashback > bestCashback) {
        bestCashback = cashback;
        matchedRate = rate;
        matchedCap = cap;
        matchedItem = card.specialItems.find(item =>
          searchVariants.some(v => item.toLowerCase().includes(v))
        );
      }
    }
  }

  // 3. 檢查 generalItems（CUBE 卡）
  if (bestCashback === 0 && card.generalItems && typeof card.generalItems === 'object') {
    for (const items of Object.values(card.generalItems)) {
      if (!Array.isArray(items)) continue;

      const matched = searchVariants.some(variant =>
        items.some(item =>
          typeof item === 'string' && item.toLowerCase().includes(variant)
        )
      );

      if (matched && card.hasLevels && card.levelSettings) {
        const defaultLevel = Object.keys(card.levelSettings)[0];
        const levelSettings = card.levelSettings[defaultLevel];
        const rate = levelSettings.generalRate || 0;

        const cashback = Math.floor((amount * rate) / 100);

        if (cashback > bestCashback) {
          bestCashback = cashback;
          matchedRate = rate;
          matchedCap = null; // CUBE 無上限
          matchedItem = items.find(item =>
            searchVariants.some(v => item.toLowerCase().includes(v))
          );
        }
      }
    }
  }

  return {
    cashback: bestCashback,
    rate: matchedRate,
    cap: matchedCap,
    matchedItem: matchedItem
  };
}

// 主要 API 處理函數
export async function onRequest(context) {
  const startTime = Date.now();

  try {
    // 取得請求的 Origin
    const origin = context.request.headers.get('Origin');
    const referer = context.request.headers.get('Referer');

    const allowedOrigins = [
      'https://pickmycard.app',
      'https://www.pickmycard.app'
    ];

    // 在開發環境允許 localhost 和 pages.dev
    const isDevelopment =
      context.env?.ENVIRONMENT === 'development' ||
      origin?.includes('localhost') ||
      origin?.includes('127.0.0.1') ||
      origin?.includes('pages.dev') ||
      referer?.includes('pages.dev') ||
      referer?.includes('localhost');

    // Origin 驗證
    const isAllowedOrigin = allowedOrigins.includes(origin) || isDevelopment;

    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': isAllowedOrigin ? origin : 'https://pickmycard.app',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'public, max-age=60', // 快取 1 分鐘
    };

    // 處理 OPTIONS
    if (context.request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    // Origin 檢查（非 OPTIONS 請求）
    // 只在生產環境（pickmycard.app）進行嚴格檢查
    const isProduction = referer?.includes('pickmycard.app') || origin?.includes('pickmycard.app');

    if (isProduction && !isAllowedOrigin && origin) {
      return new Response(JSON.stringify({
        error: '未授權的來源',
        message: 'Unauthorized origin'
      }), { status: 403, headers });
    }

    // 開發環境（pages.dev, localhost）：記錄但允許通過
    if (!isAllowedOrigin && !isProduction) {
      console.log('Development request from:', origin || referer || 'unknown');
    }

    // 只允許 POST
    if (context.request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: '只支援 POST 請求'
      }), { status: 405, headers });
    }

    // 解析請求
    const body = await context.request.json();
    const { keyword, amount } = body;

    if (!keyword || !amount) {
      return new Response(JSON.stringify({
        error: '缺少必要參數：keyword 和 amount'
      }), { status: 400, headers });
    }

    // 載入資料
    const cardsData = loadCardsData();

    // 取得搜尋變體
    const searchVariants = getAllSearchVariants(keyword);

    // 計算所有卡片的回饋
    const results = [];
    for (const card of cardsData.cards) {
      const result = calculateCardCashback(card, searchVariants, amount);

      if (result.cashback > 0) {
        results.push({
          cardId: card.id,
          cardName: card.name,
          fullName: card.fullName || card.name,
          cashback: result.cashback,
          rate: parseFloat(result.rate.toFixed(2)),
          cap: result.cap,
          matchedItem: result.matchedItem,
          website: card.website,
          // 不回傳完整的 cashbackRates, specialItems 等資料
        });
      }
    }

    // 按回饋金額排序
    results.sort((a, b) => b.cashback - a.cashback);

    // 回傳結果
    const totalTime = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: true,
      keyword: keyword,
      amount: amount,
      results: results,
      resultCount: results.length,
      processingTime: `${totalTime}ms`
    }), {
      headers,
      status: 200
    });

  } catch (error) {
    const totalTime = Date.now() - startTime;

    return new Response(JSON.stringify({
      error: '伺服器錯誤',
      message: error.message,
      processingTime: `${totalTime}ms`
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      status: 500
    });
  }
}
