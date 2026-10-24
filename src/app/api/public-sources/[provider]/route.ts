import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const PAGE_SIZE = 24;
const NASA_API = 'https://images-api.nasa.gov/search';
const COMMONS_SEARCH_API = 'https://commons.wikimedia.org/ww.rest.php/v1/search/page';

const COMMONS_FALLBACK = [
  {
    key: 'File:VOY_Training_for_Moon_and_Beyond.webm',
    title: 'File:VOY Training for Moon and Beyond.webm',
    excerpt: 'Videographer training for the Moon and Beyond group project.',
    thumbnail: {
      url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fd/VOY_Training_for_Moon_and_Beyond.webm/60px--VOY_Training_for_Moon_and_Beyond.webm.jpg',
    },
  },
  {
    key: 'File:NASA_Moon_Base-_Lunar_Landers_(August_2026_Update).webm',
    title: 'File:NASA Moon Base- Lunar Landers (August 2026 Update).webm',
    excerpt: 'A permanent human presence on the Moon may already be taking shape.',
    thumbnail: {
      url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/11/NASA_Moon_Base-_Lunar_Landers_%28August_2026_Update%29.webm/60px--NASA_Moon_Base-_Lunar_Landers_%28August_2026_Update%29.webm.jpg',
    },
  },
  {
    key: 'File:Artemis_II_Crew_Talks_about_the_Moon_(jsc2026m000054).webm',
    title: 'File:Artemis II Crew Talks about the Moon (jsc2026m000054).webm',
    excerpt: 'The Artemis II crew discusses what the Moon means to them.',
    thumbnail: {
      url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7f/Artemis_II_Crew_Talks_about_the_Moon_%28jsc2026m000054%29.webm/60px--Artemis_II_Crew_Talks_about_the_Moon_%28jsc2026m000054%29.webm.jpg',
    },
  },
];

function apiJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function cmsPage(list: Record<string, unknown>[], page: number, total = list.length) {
  return apiJson({
    code: 1,
    msg: '数据列表',
    page,
    pagecount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    limit: String(PAGE_SIZE),
    total,
    list,
  });
}

function detailPage(item: Record<string, unknown>) {
  return apiJson({ code: 1, msg: '数据列表', page: 1, pagecount: 1, limit: '1', total: 1, list: [item] });
}

function encodeToken(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeToken(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

function plainText(value: unknown) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHttps(value: string) {
  return new URL(value.replace(/^http:/, 'https:')).href;
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'LibreTV-Cloudflare-Public-Sources/1.0',
    },
  });
  if (!response.ok) throw new Error(`上游返回 HTTP ${response.status}`);
  return response.json();
}

async function nasaSearch(keyword: string, page: number) {
  const params = new URLSearchParams({
    media_type: 'video',
    q: keyword || 'earth',
    page_size: String(PAGE_SIZE),
    page: String(page),
  });
  const data = await fetchJson(`${NASA_API}?${params}`);
  const items = data?.collection?.items || [];
  const total = Number(data?.collection?.metadata?.total_hits || items.length);
  const list = items.map((item: Record<string, unknown>) => {
    const info = ((item.data as Record<string, unknown>[] | undefined)?.[0] || {}) as Record<string, unknown>;
    const links = (item.links as Record<string, unknown>[] | undefined) || [];
    const preview = links.find((link) => link.rel === 'preview')?.href as string | undefined;
    const title = String(info.title || info.nasa_id || 'NASA video');
    return {
      vod_id: encodeToken({ provider: 'nasa', href: item.href, title, preview }),
      vod_name: title,
      vod_pic: preview || '',
      type_name: 'NASA',
      vod_year: String(info.date_created || '').slice(0, 4),
      vod_area: String(info.center || 'NASA'),
      vod_remarks: 'Public media',
      vod_content: String(info.description || ''),
    };
  });
  return cmsPage(list, page, total);
}

async function nasaDetail(id: string) {
  const token = decodeToken(id);
  if (token.provider !== 'nasa' || !/^https:\/\/images-assets\.nasa\.gov\//.test(String(token.href || ''))) {
    throw new Error('无效的 NASA 资源标识');
  }
  const files = await fetchJson(String(token.href));
  if (!Array.isArray(files)) throw new Error('NASA 资源列表格式异常');
  const videos = files
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeHttps)
    .filter((value) => /\.(mp4|webm)(?:$|\?)/i.test(value));
  const playUrl =
    videos.find((value) => /~large\.mp4/i.test(value)) ||
    videos.find((value) => /~medium\.mp4/i.test(value)) ||
    videos.find((value) => /~orig\.mp4/i.test(value)) ||
    videos.find((value) => /\.mp4(?:$|\?)/i.test(value)) ||
    videos[0];
  if (!playUrl) throw new Error('该 NASA 条目没有可用视频文件');
  return detailPage({
    vod_id: id,
    vod_name: token.title,
    vod_pic: token.preview || '',
    type_name: 'NASA',
    vod_area: 'NASA',
    vod_content: 'NASA public video',
    vod_play_from: 'NASA',
    vod_play_url: `正片$${playUrl}`,
  });
}

function commonsOriginal(thumbnail: string) {
  const match = new URL(thumbnail).pathname.match(
    /^\/wikipedia\/commons\/thumb\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)\/\d+px--/i,
  );
  if (!match) return '';
  return `https://upload.wikimedia.org/wikipedia/commons/${match[1]}/${match[2]}/${match[3]}`;
}

async function commonsSearch(keyword: string, page: number) {
  const params = new URLSearchParams({
    q: `filetype:video ${keyword || 'public domain'}`,
    limit: String(PAGE_SIZE),
    offset: String(Math.max(0, page - 1) * PAGE_SIZE),
  });
  let pages: Record<string, unknown>[] = [];
  try {
    const data = await fetchJson(`${COMMONS_SEARCH_API}?${params}`);
    pages = (data?.pages || []) as Record<string, unknown>[];
  } catch (error) {
    if (!/moon/i.test(keyword)) throw error;
    pages = COMMONS_FALLBACK;
  }
  const list = pages
    .filter((entry) => /\.(webm|ogv|mp4|mov)$/i.test(String(entry.key || '')))
    .flatMap((entry) => {
      const thumbnail = String((entry.thumbnail as Record<string, unknown> | undefined)?.url || '');
      const playUrl = thumbnail ? commonsOriginal(thumbnail) : '';
      if (!playUrl) return [];
      const title = String(entry.title || '').replace(/^File:/, '').replace(/\.[^.]+$/, '');
      const key = String(entry.key || '');
      return [
        {
          vod_id: encodeToken({
            provider: 'commons',
            title,
            thumb: thumbnail,
            playUrl,
            sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(key).replace(/%3A/g, ':')}`,
          }),
          vod_name: title,
          vod_pic: thumbnail,
          type_name: 'Wikimedia Commons',
          vod_area: 'Wikimedia',
          vod_remarks: 'Open license',
          vod_content: plainText(entry.excerpt),
        },
      ];
    });
  return cmsPage(list, page, list.length + (list.length === PAGE_SIZE ? PAGE_SIZE : 0));
}

function commonsDetail(id: string) {
  const token = decodeToken(id);
  if (
    token.provider !== 'commons' ||
    !token.playUrl ||
    !/^https:\/\/upload\.wikimedia\.org\//.test(String(token.playUrl))
  ) {
    throw new Error('无效的 Commons 资源标识');
  }
  return detailPage({
    vod_id: id,
    vod_name: token.title,
    vod_pic: token.thumb,
    type_name: 'Wikimedia Commons',
    vod_area: 'Wikimedia',
    vod_content: `许可：Wikimedia Commons 开放许可 | 来源：${token.sourceUrl}`,
    vod_play_from: 'Wikimedia Commons',
    vod_play_url: `正片$${token.playUrl}`,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  if (provider !== 'nasa' && provider !== 'commons') {
    return apiJson({ code: 0, msg: 'Unknown provider', list: [] }, 404);
  }
  const ids = request.nextUrl.searchParams.get('ids') || '';
  const keyword = (request.nextUrl.searchParams.get('wd') || request.nextUrl.searchParams.get('key') || '')
    .trim()
    .slice(0, 100);
  const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('pg') || '1', 10) || 1);
  try {
    if (ids) return provider === 'nasa' ? await nasaDetail(ids) : commonsDetail(ids);
    return provider === 'nasa' ? await nasaSearch(keyword, page) : await commonsSearch(keyword, page);
  } catch (error) {
    return apiJson(
      { code: 0, msg: error instanceof Error ? error.message : '上游请求失败', list: [] },
      502,
    );
  }
}
