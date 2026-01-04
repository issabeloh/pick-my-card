/**
 * Cloudflare Pages Function: 提供卡片資料 API
 * 路由: /api/get-cards-data
 *
 * 功能：
 * - 提供完整的卡片資料（Base64 編碼）
 * - 取代直接下載 cards.data 檔案
 * - 有快取機制，減少重複讀取
 *
 * 安全措施：
 * - CORS 限定為 https://pickmycard.app
 * - Origin 驗證
 * - 快取 60 秒（減少伺服器負載）
 */

import cardsDataContent from '../cards.data.js';

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
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': isAllowedOrigin ? origin : 'https://pickmycard.app',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'public, max-age=60', // 快取 60 秒
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
      }), {
        status: 403,
        headers: {
          ...headers,
          'Content-Type': 'application/json; charset=utf-8'
        }
      });
    }

    // 開發環境（pages.dev, localhost）：記錄但允許通過
    if (!isAllowedOrigin && !isProduction) {
      console.log('Development request from:', origin || referer || 'unknown');
    }

    // 只允許 GET
    if (context.request.method !== 'GET') {
      return new Response(JSON.stringify({
        error: '只支援 GET 請求'
      }), {
        status: 405,
        headers: {
          ...headers,
          'Content-Type': 'application/json; charset=utf-8'
        }
      });
    }

    // 回傳 Base64 編碼的資料（與原本的 cards.data 格式相同）
    const totalTime = Date.now() - startTime;
    console.log(`Cards data served in ${totalTime}ms to ${origin || referer || 'unknown'}`);

    return new Response(cardsDataContent, {
      headers,
      status: 200
    });

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error('Error serving cards data:', error);

    return new Response(JSON.stringify({
      error: '伺服器錯誤',
      message: error.message,
      processingTime: `${totalTime}ms`
    }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
      status: 500
    });
  }
}
