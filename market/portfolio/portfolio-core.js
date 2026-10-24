"use strict";

const PORTFOLIO_CORE = (() => {
  const num = (value) => {
    if (value === null || value === undefined || value === "" || typeof value === "boolean" || typeof value === "object") return null;
    const parsed = typeof value === "number" ? value : Number(String(value).replace(/[٬,،]/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  };
  const cleanSymbol = (value) => String(value || "").replace(/[\u200c\u200d]/g, "").trim();
  const equityRow = (row) => row && !/^اوراق(?:\s|‌)/.test(String(row.industry || "").trim());
  const tradedRow = (row) => equityRow(row) && num(row.score) !== null && ((num(row.trade_volume) !== null && num(row.trade_volume) > 0) || (row.instrument_type === "leveraged" && num(row.trade_value_toman) !== null && num(row.trade_value_toman) > 0));

  function buildUniverse(stocks) {
    return (Array.isArray(stocks) ? stocks : []).filter(tradedRow);
  }

  function industryRanking(stocks) {
    const universe = (Array.isArray(stocks) ? stocks : []).filter((row) => equityRow(row) && num(row.score) !== null);
    const byIndustry = new Map();
    universe.forEach((row) => {
      const industry = String(row.industry || "بدون صنعت").trim();
      if (!byIndustry.has(industry)) byIndustry.set(industry, []);
      byIndustry.get(industry).push({...row, rankingScore: num(row.trade_volume) > 0 ? num(row.score) : 0});
    });
    const result = new Map();
    byIndustry.forEach((members, industry) => {
      members.sort((a, b) => b.rankingScore - a.rankingScore || String(a.symbol || "").localeCompare(String(b.symbol || ""), "fa"));
      const total = members.length;
      members.forEach((row, index) => result.set(cleanSymbol(row.symbol), {rank: index + 1, total, industry}));
    });
    return result;
  }

  function findStock(stocks, symbol) {
    const wanted = cleanSymbol(symbol);
    return (Array.isArray(stocks) ? stocks : []).find((row) => cleanSymbol(row.symbol) === wanted) || null;
  }

  function catalogHas(catalog, symbol) {
    const wanted = cleanSymbol(symbol);
    return (Array.isArray(catalog) ? catalog : []).some((item) => cleanSymbol(item.symbol || item) === wanted);
  }

  function fallbackFor(fallbackRows, symbol) {
    if (!fallbackRows) return null;
    const wanted = cleanSymbol(symbol);
    if (fallbackRows instanceof Map) return fallbackRows.get(wanted) || null;
    return fallbackRows[wanted] || null;
  }

  function resolveHolding(holding, stocks, ranking, catalog, fallbackRows) {
    const clean = cleanSymbol(holding.symbol);
    const row = findStock(stocks, clean);
    const value = Math.max(0, num(holding.value) || 0);
    if (!row) {
      const fallback = fallbackFor(fallbackRows, clean);
      if (fallback && num(fallback.score) !== null) {
        const fallbackRow = {...fallback, symbol: clean, score: num(fallback.score), historical_fallback: true};
        return {...holding, symbol: clean, value, row: fallbackRow, score: num(fallback.score), status: fallback.source === "fund_report" ? "fund_report_score" : "historical_score", contribution: null, rank: null};
      }
      return {...holding, symbol: clean, value, row: null, score: null, status: catalogHas(catalog, clean) ? "snapshot_missing" : "not_found", contribution: null, rank: null};
    }
    const tradeVolume = num(row.trade_volume);
    const rawScore = num(row.score);
    const isUntraded = tradeVolume === null || tradeVolume <= 0;
    const score = isUntraded ? 0 : rawScore;
    let group = ranking.get(cleanSymbol(row.symbol)) || null;
    if (!group && isUntraded && num(row.score) !== null) {
      const peers = (Array.isArray(stocks) ? stocks : []).filter((peer) => equityRow(peer) && String(peer.industry || "").trim() === String(row.industry || "").trim() && num(peer.score) !== null && num(peer.trade_volume) !== null && num(peer.trade_volume) > 0).map((peer) => ({symbol: cleanSymbol(peer.symbol), score: num(peer.score)}));
      peers.push({symbol: cleanSymbol(row.symbol), score: 0});
      peers.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol, "fa"));
      const position = peers.findIndex((peer) => peer.symbol === cleanSymbol(row.symbol));
      if (position >= 0) group = {rank: position + 1, total: peers.length, industry: String(row.industry || "بدون صنعت")};
    }
    return {...holding, symbol: String(row.symbol), value, row, score, status: isUntraded ? "untraded_zero" : rawScore === null ? "missing_score" : "ready", contribution: null, rank: group};
  }

  function calculatePortfolio({holdings, cash = 0, marketMedian, stocks, catalog, fallbackRows}) {
    const safeHoldings = (Array.isArray(holdings) ? holdings : []).filter((holding) => cleanSymbol(holding.symbol));
    const ranking = industryRanking(stocks);
    const resolved = safeHoldings.map((holding) => resolveHolding(holding, stocks, ranking, catalog, fallbackRows));
    const validRows = resolved.filter((item) => item.value > 0 && item.score !== null);
    const missingRows = resolved.filter((item) => item.value > 0 && item.score === null);
    const numericCash = Math.max(0, num(cash) || 0);
    const enteredValue = resolved.reduce((sum, item) => sum + item.value, 0);
    const investedValue = enteredValue;
    const totalValue = enteredValue + numericCash;
    const weightedScoreSum = validRows.reduce((sum, item) => sum + item.value * item.score, 0);
    const totalScore = missingRows.length || totalValue <= 0 ? null : weightedScoreSum / totalValue;
    const investedScore = missingRows.length || investedValue <= 0 ? null : weightedScoreSum / investedValue;
    const market = num(marketMedian);
    resolved.forEach((item) => {
      item.weight = totalValue > 0 ? item.value / totalValue : null;
      item.contribution = item.weight === null || item.score === null || missingRows.length ? null : item.weight * item.score;
    });
    return {
      holdings: resolved, cash: numericCash, investedValue, totalValue, totalScore, investedScore, marketMedian: market,
      gap: totalScore === null || market === null ? null : totalScore - market,
      coverage: validRows.length, entered: resolved.length, missing: missingRows.length,
      historical: resolved.filter((item) => item.status === "historical_score" || item.status === "fund_report_score").length,
      cashWeight: totalValue > 0 ? numericCash / totalValue : null,
    };
  }

  return {num, cleanSymbol, buildUniverse, industryRanking, calculatePortfolio};
})();
if (typeof module !== "undefined") module.exports = PORTFOLIO_CORE;
if (typeof window !== "undefined") window.PortfolioCore = PORTFOLIO_CORE;
