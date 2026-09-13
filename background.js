// ============================================================
// background.js — Notion API 代理
// ============================================================
// 内容脚本(content.js)无法直接调用 Notion API（跨域限制），
// 所以所有 API 请求都通过这个 background service worker 中转。
// 内容脚本通过 chrome.runtime.sendMessage 发送请求，
// 这里接收、调用 Notion API、返回结果。
// ============================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'NOTION_API') {
    handleNotionRequest(request)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // 告诉 Chrome 我们会异步调用 sendResponse
  }
});

/**
 * 统一处理所有 Notion API 请求
 * @param {Object} request - { type, action, token, ...params }
 */
async function handleNotionRequest(request) {
  const { action, token } = request;

  if (!token) {
    return { error: '请先在扩展设置中填写 Notion API Token' };
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28'
  };

  try {
    switch (action) {
      case 'search_pages':
        return await searchPages(headers, request.query);

      case 'get_page_blocks':
        return await getPageBlocks(headers, request.pageId);

      case 'create_page':
        return await createPage(headers, request.parentId, request.title, request.blocks, request.position);

      case 'append_blocks':
        return await appendBlocks(headers, request.pageId, request.blocks);

      default:
        return { error: `未知操作: ${action}` };
    }
  } catch (err) {
    console.error('[AI Chat to Notion] API Error:', err);
    return { error: err.message };
  }
}

/**
 * 搜索 Notion 页面
 * 用于让用户选择要导出到哪个页面（作为父页面）
 */
async function searchPages(headers, query) {
  const body = {
    filter: { property: 'object', value: 'page' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
    page_size: 20
  };
  if (query && query.trim()) {
    body.query = query.trim();
  }

  const res = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Notion API 错误 (${res.status})`);
  }

  // 提取页面列表：id + 标题
  const pages = (data.results || []).map(page => {
    let title = '(无标题)';
    // 页面标题可能在 properties.title 或 properties.Name 中
    const props = page.properties || {};
    for (const key of Object.keys(props)) {
      const prop = props[key];
      if (prop.type === 'title' && prop.title && prop.title.length > 0) {
        title = prop.title.map(t => t.plain_text).join('');
        break;
      }
    }
    return { id: page.id, title, icon: page.icon };
  });

  return { pages };
}

/**
 * 在指定父页面下创建子页面
 * @param {string} parentId - 父页面 ID
 * @param {string} title - 新页面标题（用户的提问）
 * @param {Array} blocks - Notion block 数组（页面内容）
 * @param {Object|undefined} position - 在父页面中的位置
 *   { type: 'page_start' } | { type: 'page_end' } | { type: 'after_block', after_block: { id } }
 *   不传 = Notion 默认行为（父页面末尾）
 */
async function createPage(headers, parentId, title, blocks, position) {
  // Notion API 限制：每次最多 100 个 children block
  const firstBatch = blocks.slice(0, 100);
  const remaining = blocks.slice(100);

  const body = {
    parent: { page_id: parentId },
    properties: {
      title: {
        title: [{ type: 'text', text: { content: title } }]
      }
    },
    children: firstBatch
  };

  if (position) {
    body.position = position;
  }

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `创建页面失败 (${res.status})`);
  }

  // 如果还有剩余的 block，分批追加到新创建的子页面里（不需要 position）
  if (remaining.length > 0) {
    await appendBlocksInBatches(headers, data.id, remaining);
  }

  return { pageId: data.id, url: data.url };
}

/**
 * 拉取目标页面的顶层 block 列表（用于选择"插入位置"）
 * 只返回每个 block 的 id / type / 一段预览文本
 */
async function getPageBlocks(headers, pageId) {
  const allResults = await retrieveBlockChildren(headers, pageId);
  const blocks = [];

  for (const block of allResults) {
    const item = serializePreviewBlock(block);
    if (block.type === 'quote' && block.has_children) {
      const children = await retrieveBlockChildren(headers, block.id);
      item.children = children.map(serializePreviewBlock);
    }
    blocks.push(item);
  }

  return { blocks, hasMore: false };
}

/** 拉取某个 page / block 的全部直接子 block，并处理分页。 */
async function retrieveBlockChildren(headers, blockId) {
  let allResults = [];
  let cursor = undefined;

  do {
    let url = `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`;
    if (cursor) url += `&start_cursor=${cursor}`;

    const res = await fetch(url, { method: 'GET', headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `获取页面内容失败 (${res.status})`);
    }

    allResults = allResults.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return allResults;
}

/** 将 Notion block 缩减为精准选择面板所需的安全预览数据。 */
function serializePreviewBlock(block) {
  const type = block.type;
  const richText = block[type]?.rich_text;
  let text = '';
  if (Array.isArray(richText)) {
    text = richText.map(item => item.plain_text || item.text?.content || '').join('').trim();
  }

  const item = { id: block.id, type, text, preview: makeBlockPreview(block) };
  if (type === 'child_page') item.title = block.child_page?.title || '';
  if (type === 'child_database') item.title = block.child_database?.title || '';
  if (type === 'code') item.language = block.code?.language || '';
  if (type === 'callout') item.icon = block.callout?.icon?.emoji || '💡';
  if (type === 'to_do') item.checked = block.to_do?.checked || false;
  if (type === 'image') {
    item.caption = (block.image?.caption || []).map(rich => rich.plain_text).join('');
  }
  if (type === 'equation') item.expression = block.equation?.expression || '';
  return item;
}

/**
 * 把一个 block 对象映射为人类可读的预览串
 * 用于"选择插入位置"列表里每行显示
 */
function makeBlockPreview(block) {
  const type = block.type;
  const rt = block[type]?.rich_text;
  let text = '';
  if (Array.isArray(rt)) {
    text = rt.map(r => r.plain_text || r.text?.content || '').join('').trim();
  }
  const trim = (s, max = 40) => (s.length > max ? s.slice(0, max) + '…' : s);

  switch (type) {
    case 'heading_1': return `H1: ${trim(text)}`;
    case 'heading_2': return `H2: ${trim(text)}`;
    case 'heading_3': return `H3: ${trim(text)}`;
    case 'paragraph': return trim(text || '(空段落)');
    case 'bulleted_list_item': return `• ${trim(text)}`;
    case 'numbered_list_item': return `1. ${trim(text)}`;
    case 'to_do': return `☐ ${trim(text)}`;
    case 'quote': return `❝ ${trim(text)}`;
    case 'callout': return `💡 ${trim(text)}`;
    case 'toggle': return `▶ ${trim(text)}`;
    case 'code': return `{ } 代码块`;
    case 'divider': return '——————————';
    case 'child_page': return `📄 ${trim(block.child_page?.title || '子页面')}`;
    case 'child_database': return `🗄 ${trim(block.child_database?.title || '数据库')}`;
    case 'image': return '🖼 图片';
    case 'video': return '🎥 视频';
    case 'file': return '📎 文件';
    case 'pdf': return '📕 PDF';
    case 'bookmark': return '🔖 书签';
    case 'embed': return '🔗 嵌入';
    case 'equation': return `∑ ${trim(block.equation?.expression || '')}`;
    case 'table': return '⊞ 表格';
    case 'column_list': return '⊟ 列布局';
    case 'synced_block': return '↻ 同步块';
    case 'table_of_contents': return '📑 目录';
    case 'breadcrumb': return '➤ 面包屑';
    case 'link_to_page': return '🔗 页面链接';
    default: return `[${type}]`;
  }
}

/**
 * 向现有页面追加 block（用于超过 100 个 block 的情况）
 */
async function appendBlocks(headers, pageId, blocks) {
  return await appendBlocksInBatches(headers, pageId, blocks);
}

/**
 * 分批追加 blocks（每批最多 100 个）
 */
async function appendBlocksInBatches(headers, blockId, blocks) {
  const BATCH_SIZE = 100;
  for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    const batch = blocks.slice(i, i + BATCH_SIZE);
    const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ children: batch })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || `追加内容失败 (${res.status})`);
    }
  }
  return { success: true };
}
