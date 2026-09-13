// ============================================================
// content/builder.js — Q&A pair → 单个 Notion 页面的 block 数组
// ============================================================
// 加载顺序：第 5 个（依赖 converter.js 的 htmlToNotionBlocks / createParagraphBlock）

/**
 * 将一个 Q&A 对转换为 Notion page 的 block 数组
 *
 * 格式：
 *   H1: You Asked
 *   （用户提问内容）
 *   ───────────
 *   （空行）
 *   H1: Claude Response / ChatGPT Response（按来源自动选择）
 *   （回答内容，已去重）
 */
function buildPageBlocks(pair) {
  const blocks = [];
  const assistantHeading = pair.assistantHeading || 'Claude Response';

  blocks.push({
    type: 'heading_1',
    heading_1: {
      rich_text: [{ type: 'text', text: { content: 'You Asked' } }]
    }
  });

  if (pair.questionHtml) {
    blocks.push(...htmlToNotionBlocks(pair.questionHtml));
  } else {
    blocks.push(createParagraphBlock(pair.question));
  }

  blocks.push({ type: 'divider', divider: {} });
  blocks.push(createParagraphBlock(' '));

  blocks.push({
    type: 'heading_1',
    heading_1: {
      rich_text: [{ type: 'text', text: { content: assistantHeading } }]
    }
  });

  let answerBlocks = [];
  if (pair.answerHtml) {
    answerBlocks = htmlToNotionBlocks(pair.answerHtml);
  } else {
    answerBlocks = [createParagraphBlock(pair.answer || '(无回答)')];
  }
  blocks.push(...deduplicateBlocks(answerBlocks));

  return blocks;
}

/**
 * 去除连续重复的 paragraph block
 * AI 聊天网页的 DOM 中，回复首段文字有时会出现在多个嵌套层
 */
function deduplicateBlocks(blocks) {
  if (blocks.length <= 1) return blocks;

  const result = [blocks[0]];
  for (let i = 1; i < blocks.length; i++) {
    const prev = result[result.length - 1];
    const curr = blocks[i];

    if (prev.type === 'paragraph' && curr.type === 'paragraph') {
      const prevText = extractBlockText(prev);
      const currText = extractBlockText(curr);
      if (prevText && currText && prevText === currText) {
        continue;
      }
    }
    result.push(curr);
  }
  return result;
}

function extractBlockText(block) {
  if (block.type === 'equation') return block.equation?.expression || '';
  const richText = block[block.type]?.rich_text;
  if (!richText) return '';
  return richText
    .map(rt => rt.text?.content || rt.equation?.expression || '')
    .join('')
    .trim();
}
