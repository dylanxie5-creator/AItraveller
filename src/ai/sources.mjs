import {isDateOnly} from '../shared/date.mjs';
import {AiError} from './errors.mjs';

function sourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function publishedDate(value) {
  if (isDateOnly(value)) return value;
  if (typeof value === 'string' && value.length <= 40 && isDateOnly(value.slice(0, 10)) &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
      Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

/** Return only new, deduplicated sources; valid duplicate-only results remain usable. */
export function normalizeSearchResults(raw, {retrievedAt, priorSources = []}) {
  const invalid = () => new AiError('AI_SEARCH_RESPONSE', '检索资料格式异常，请保留输入后重新生成');
  if (!raw || !Array.isArray(raw.search_result) || raw.error ||
      typeof retrievedAt !== 'string' || !retrievedAt.includes('T') || !publishedDate(retrievedAt) ||
      !Array.isArray(priorSources) || priorSources.length > 15) throw invalid();
  const seen = new Set(), ids = new Set();
  for (const source of priorSources) {
    const url = sourceUrl(source?.url);
    if (!url || !/^s[1-9]\d*$/u.test(source?.sourceId) || ids.has(source.sourceId) || seen.has(url)) throw invalid();
    seen.add(url); ids.add(source.sourceId);
  }
  let nextId = priorSources.reduce((n, source) => Math.max(n, Number(source.sourceId.slice(1))), 0) + 1;
  if (!Number.isSafeInteger(nextId)) throw invalid();
  const result = [];
  let effective = false;
  for (const row of raw.search_result) {
    const url = sourceUrl(row?.link);
    if (!url || typeof row?.title !== 'string' || !row.title.trim() ||
        typeof row.content !== 'string' || !row.content.trim()) continue;
    effective = true;
    if (seen.has(url) || priorSources.length + result.length >= 15) continue;
    seen.add(url);
    result.push({sourceId: `s${nextId++}`, title: [...row.title.trim()].slice(0, 200).join(''), url,
      summary: [...row.content.trim()].slice(0, 1200).join(''),
      publishedAt: publishedDate(row.publish_date), retrievedAt});
  }
  if (!effective) throw new AiError('AI_SEARCH_EMPTY', '未检索到有效资料，本次没有调用规划模型');
  return result;
}
