// ============================================================
// content/converter.js — HTML DOM → Notion blocks 转换
// ============================================================
// 加载顺序：第 4 个（无依赖）
//
// 入口：htmlToNotionBlocks(element) → 返回 Notion block 数组
// 支持的元素：p / h1-h6 / pre / ul / ol / hr / blockquote / table / equation / div 等
// 富文本：bold / italic / code / link / equation / strikethrough / underline / br

const MAX_NOTION_EQUATION_LENGTH = 1000;

/**
 * 将消息容器的 HTML 内容转换为 Notion API block 数组
 */
function htmlToNotionBlocks(element) {
  if (!element) return [createParagraphBlock('(空内容)')];

  const contentEl = element;
  const blocks = [];

  processChildren(contentEl, blocks);

  // 如果什么都没提取到，至少放一个纯文本段落
  if (blocks.length === 0) {
    const text = contentEl.textContent?.trim();
    if (text) {
      blocks.push(...splitTextToBlocks(text));
    }
  }

  return blocks;
}

/** 递归处理 DOM 子节点 */
function processChildren(parent, blocks) {
  for (const child of parent.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent.trim();
      if (text) {
        blocks.push(createParagraphBlock(text));
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      processElement(child, blocks);
    }
  }
}

/** 将单个 HTML 元素转换为对应的 Notion block */
function processElement(el, blocks) {
  const mathExpression = extractMathExpression(el);
  if (mathExpression) {
    blocks.push(mathExpression.length <= MAX_NOTION_EQUATION_LENGTH
      ? createEquationBlock(mathExpression)
      : createParagraphBlock(`$${mathExpression}$`));
    return;
  }

  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case 'p': {
      const richText = extractRichText(el);
      if (richText.length > 0) {
        blocks.push({ type: 'paragraph', paragraph: { rich_text: richText } });
      }
      break;
    }

    case 'h1': case 'h2': case 'h3':
    case 'h4': case 'h5': case 'h6': {
      const level = Math.min(parseInt(tag[1]), 3); // Notion 只支持 h1-h3
      const types = { 1: 'heading_1', 2: 'heading_2', 3: 'heading_3' };
      const blockType = types[level];
      blocks.push({
        type: blockType,
        [blockType]: {
          rich_text: [{ type: 'text', text: { content: el.textContent.trim() } }]
        }
      });
      break;
    }

    case 'pre': {
      const codeEl = el.querySelector('code');
      const langClass = codeEl?.className || '';
      const langMatch = langClass.match(/language-(\w+)/);
      const language = langMatch ? mapLanguage(langMatch[1]) : 'plain text';
      const code = codeEl?.textContent || el.textContent;
      blocks.push({
        type: 'code',
        code: {
          rich_text: splitLongText(code),
          language: language
        }
      });
      break;
    }

    case 'ul': {
      for (const li of el.querySelectorAll(':scope > li')) {
        blocks.push({
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: extractRichText(li) }
        });
      }
      break;
    }

    case 'ol': {
      for (const li of el.querySelectorAll(':scope > li')) {
        blocks.push({
          type: 'numbered_list_item',
          numbered_list_item: { rich_text: extractRichText(li) }
        });
      }
      break;
    }

    case 'hr': {
      blocks.push({ type: 'divider', divider: {} });
      break;
    }

    case 'blockquote': {
      processBlockquote(el, blocks);
      break;
    }

    case 'table': {
      processTable(el, blocks);
      break;
    }

    case 'div': case 'section': case 'article': case 'span': {
      if (tag === 'div' && isCodeBlockContainer(el)) {
        processCodeBlockContainer(el, blocks);
      } else {
        processChildren(el, blocks);
      }
      break;
    }

    default: {
      const text = el.textContent.trim();
      if (text) {
        blocks.push(createParagraphBlock(text));
      }
    }
  }
}

/**
 * <blockquote> → Notion quote block。
 *
 * 简单引用仍作为一行 rich_text；含段落、独立公式或列表的复杂引用，
 * 则把第一段放在 quote 主行，其余内容保留为 children，避免全部压成一行。
 */
function processBlockquote(el, blocks) {
  const blockTags = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'pre', 'ul', 'ol', 'hr', 'blockquote', 'table',
    'div', 'section', 'article', 'figure'
  ]);
  const hasBlockStructure = [...el.children].some(child => {
    const tag = child.tagName.toLowerCase();
    if (blockTags.has(tag)) return true;

    const display = child.style?.display;
    return Boolean(extractMathExpression(child))
      && (display === 'block'
        || child.matches('.katex-display, [data-math-display="true"]')
        || Boolean(child.querySelector(':scope > .katex-display')));
  });

  if (!hasBlockStructure) {
    blocks.push({
      type: 'quote',
      quote: { rich_text: extractRichText(el) }
    });
    return;
  }

  const childBlocks = [];
  processChildren(el, childBlocks);

  if (childBlocks.length === 0) {
    blocks.push({
      type: 'quote',
      quote: { rich_text: extractRichText(el) }
    });
    return;
  }

  const firstBlock = childBlocks[0];
  const firstParagraphRichText = firstBlock.type === 'paragraph'
    ? firstBlock.paragraph.rich_text
    : [];
  const children = firstBlock.type === 'paragraph'
    ? childBlocks.slice(1)
    : childBlocks;
  const quote = { rich_text: firstParagraphRichText };

  if (children.length > 0) {
    quote.children = children;
  }

  blocks.push({ type: 'quote', quote });
}

/**
 * 检测一个 div 是否是代码块容器
 * Claude UI 的代码块结构：外层 div 包含 [复制按钮 div, 语言标签 div, 代码包装 div > pre > code]
 * 如果不做特殊处理，语言标签的文本（如 "sql"）会被当成独立段落提取
 */
function isCodeBlockContainer(el) {
  const pre = el.querySelector('pre');
  if (!pre || !pre.querySelector('code')) return false;
  const extraTextLen = (el.textContent || '').length - (pre.textContent || '').length;
  return extraTextLen >= 0 && extraTextLen < 50;
}

/** 从代码块容器中提取代码，跳过语言标签和复制按钮 */
function processCodeBlockContainer(container, blocks) {
  const preEl = container.querySelector('pre');
  const codeEl = preEl?.querySelector('code');

  if (!preEl) {
    processChildren(container, blocks);
    return;
  }

  let language = '';
  const langMatch = (codeEl?.className || '').match(/language-(\w+)/);
  if (langMatch) {
    language = mapLanguage(langMatch[1]);
  }

  if (!language) language = 'plain text';

  const code = codeEl?.textContent || preEl.textContent || '';
  blocks.push({
    type: 'code',
    code: {
      rich_text: splitLongText(code),
      language: language
    }
  });
}

/** <table> → Notion table block（含列数补齐） */
function processTable(tableEl, blocks) {
  const rows = tableEl.querySelectorAll('tr');
  if (rows.length === 0) return;

  const tableRows = [];
  let colCount = 0;

  for (const row of rows) {
    const cells = row.querySelectorAll('th, td');
    colCount = Math.max(colCount, cells.length);
    const rowCells = Array.from(cells).map(cell => {
      return [{ type: 'text', text: { content: cell.textContent.trim() } }];
    });
    tableRows.push(rowCells);
  }

  for (const row of tableRows) {
    while (row.length < colCount) {
      row.push([{ type: 'text', text: { content: '' } }]);
    }
  }

  blocks.push({
    type: 'table',
    table: {
      table_width: colCount,
      has_column_header: true,
      has_row_header: false,
      children: tableRows.map(cells => ({
        type: 'table_row',
        table_row: { cells }
      }))
    }
  });
}

/**
 * 提取元素中的富文本（保留 bold/italic/code/link 等格式）
 * @returns {Array} Notion rich_text 数组
 */
function extractRichText(element) {
  const richText = [];

  function walk(node, inheritedAnnotations = {}) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text && text.trim()) {
        for (const chunk of splitLongText(text)) {
          richText.push({
            ...chunk,
            annotations: { ...inheritedAnnotations, ...chunk.annotations }
          });
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const mathExpression = extractMathExpression(node);
      if (mathExpression) {
        if (mathExpression.length <= MAX_NOTION_EQUATION_LENGTH) {
          richText.push({
            type: 'equation',
            equation: { expression: mathExpression },
            annotations: { ...inheritedAnnotations }
          });
        } else {
          for (const chunk of splitLongText(`$${mathExpression}$`)) {
            richText.push({
              ...chunk,
              annotations: { ...inheritedAnnotations, ...chunk.annotations }
            });
          }
        }
        return;
      }

      const inlineCodeMath = extractInlineCodeMathExpression(node);
      if (inlineCodeMath && inlineCodeMath.length <= MAX_NOTION_EQUATION_LENGTH) {
        richText.push({
          type: 'equation',
          equation: { expression: inlineCodeMath },
          annotations: { ...inheritedAnnotations }
        });
        return;
      }

      const tag = node.tagName.toLowerCase();
      const annotations = { ...inheritedAnnotations };

      if (tag === 'strong' || tag === 'b') annotations.bold = true;
      if (tag === 'em' || tag === 'i') annotations.italic = true;
      if (tag === 'code' && !node.closest('pre')) annotations.code = true;
      if (tag === 's' || tag === 'del') annotations.strikethrough = true;
      if (tag === 'u') annotations.underline = true;

      if (tag === 'a' && node.href) {
        const text = node.textContent;
        for (const chunk of splitLongText(text)) {
          chunk.text.link = { url: node.href };
          chunk.annotations = annotations;
          richText.push(chunk);
        }
      } else if (tag === 'br') {
        richText.push({ type: 'text', text: { content: '\n' } });
      } else {
        for (const child of node.childNodes) {
          walk(child, annotations);
        }
      }
    }
  }

  walk(element);
  return richText.length > 0 ? richText : [{ type: 'text', text: { content: element.textContent.trim() || ' ' } }];
}

/**
 * 提取 ChatGPT / KaTeX 保存的原始 LaTeX。
 * ChatGPT 的 .katex-html 是用于视觉排版的字形树，不能按普通 span 逐层导出。
 */
function extractMathExpression(element) {
  if (!element?.matches?.('[role="math"], .katex')) return '';

  const mathRoot = element.matches('[role="math"]')
    ? element
    : element.closest('[role="math"]');
  const source = mathRoot?.getAttribute('data-math-source')
    || mathRoot?.getAttribute('aria-label')
    || element.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    || '';

  return source.replace(/\r\n/g, '\n').trim();
}

/**
 * ChatGPT 会把用户用反引号包住的 LaTeX 渲染成行内 <code>。
 * 只识别明确的数学定界符或常见 LaTeX 数学命令，避免误伤 Windows 路径等普通代码。
 */
function extractInlineCodeMathExpression(element) {
  if (element?.tagName?.toLowerCase() !== 'code' || element.closest('pre')) return '';

  const source = (element.textContent || '').trim();
  if (!source) return '';

  const delimited = source.match(/^\$([^$]+)\$$/)
    || source.match(/^\\\(([\s\S]+)\\\)$/)
    || source.match(/^\\\[([\s\S]+)\\\]$/);
  if (delimited) return delimited[1].trim();

  const mathCommand = /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|lim|times|cdot|pm|mp|approx|neq|leq|geq|boxed|text|mathrm|mathbf|mathit|left|right|begin|end|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega)\b/;
  return mathCommand.test(source) ? source : '';
}

function createEquationBlock(expression) {
  return {
    type: 'equation',
    equation: { expression }
  };
}

/** Notion 单个 rich_text 限 2000 字符，超过需要拆分 */
function splitLongText(text) {
  const MAX = 2000;
  const chunks = [];
  for (let i = 0; i < text.length; i += MAX) {
    chunks.push({
      type: 'text',
      text: { content: text.slice(i, i + MAX) }
    });
  }
  return chunks.length > 0 ? chunks : [{ type: 'text', text: { content: '' } }];
}

/** 纯文本太长时拆成多个 paragraph block */
function splitTextToBlocks(text) {
  const MAX = 2000;
  const blocks = [];
  for (let i = 0; i < text.length; i += MAX) {
    blocks.push(createParagraphBlock(text.slice(i, i + MAX)));
  }
  return blocks;
}

function createParagraphBlock(text) {
  return {
    type: 'paragraph',
    paragraph: {
      rich_text: splitLongText(text)
    }
  };
}

/** 代码语言名 → Notion 支持的语言标识符 */
function mapLanguage(lang) {
  const map = {
    'js': 'javascript', 'ts': 'typescript', 'py': 'python',
    'rb': 'ruby', 'sh': 'bash', 'shell': 'bash', 'zsh': 'bash',
    'yml': 'yaml', 'md': 'markdown', 'json5': 'json',
    'dockerfile': 'docker', 'make': 'makefile',
  };
  return map[lang.toLowerCase()] || lang.toLowerCase();
}
