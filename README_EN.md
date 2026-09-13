# AI Chat to Notion

[简体中文](README.md)

AI Chat to Notion is a Chrome and Edge extension for selecting useful Q&A from Claude or ChatGPT and placing it exactly where it belongs in an existing Notion note. You choose which Q&A pairs to save, which Notion page to use, and which section the new content should follow.

## A typical use case

Suppose you are asking ChatGPT what recursion is, then follow up with questions about code examples and common mistakes. When you finish, you want to keep only the useful Q&A in your Notion page called “Programming Notes,” directly after its “Recursion” section.

Click the **N** button in the lower-left corner of the conversation page:

1. Select the Q&A pairs you want to save.
2. Choose “Programming Notes” in Notion.
3. Find the “Recursion” section in the preview and choose to insert after it.
4. Save each Q&A pair as a separate Notion subpage, or merge the selected pairs into one page.

The extension converts text, headings, lists, code, tables, quotes, and equations into corresponding Notion content and places the result at the position you selected.

No Claude API key or OpenAI API key is required. You need your own Notion Integration and must grant it access to the pages where you want to write.

> This is an unofficial open-source project. It is not affiliated with, endorsed by, or sponsored by Anthropic, OpenAI, or Notion.

## Problems it solves

| Your situation | How the extension helps |
| --- | --- |
| Only a few Q&A pairs are worth keeping | You select them yourself; nothing is selected by default |
| Your Notion note is already partly organized | Preview the page and insert the new content after a specific section or block |
| Sometimes you want separate notes and sometimes one combined note | Create one subpage per Q&A pair or merge multiple pairs into one page |
| A long ChatGPT conversation may be only partly loaded | Scan the active conversation branch and report an error if completeness cannot be confirmed |
| Answers contain code, tables, quotes, or equations | Convert them into corresponding Notion content to reduce manual reformatting |
| You do not want chats passing through an unknown server | Send selected content directly from the browser to the Notion API, without a server operated by this project |

![Export panel for selecting conversations, a Notion page, and an insertion position](docs/images/export-panel-demo.png)

![Example result in Notion](docs/images/notion-result-demo.png)

> Both images use fictional data. They contain no real conversations, Notion pages, or tokens.

## Features

- Supports `claude.ai`, `chatgpt.com`, and the legacy `chat.openai.com` domain.
- Lets you select the Q&A pairs you want to save; none are selected by default.
- Creates a separate subpage for each Q&A pair or merges multiple pairs into one page.
- Inserts at the beginning or end of a target page, or after a block selected from the page preview.
- Preserves paragraphs, headings, code blocks, lists, quotes, tables, block equations, inline equations, bold, italic, strikethrough, underline, and links.
- Scans the active branch of long ChatGPT conversations and restores the previous scroll position afterward.
- Temporarily remembers the last successful Notion page and insertion position for repeated exports from the same browser tab.
- Shows the detailed Notion error when an export fails.

## Quick start

### 1. Download and load the extension

1. Download and extract this repository, or clone it with Git.
2. Open `chrome://extensions/` in Chrome or `edge://extensions/` in Edge.
3. Enable Developer mode.
4. Click **Load unpacked** and select the project directory that contains `manifest.json`.

After updating the project files, return to the extension management page and click **Reload**.

### 2. Create a Notion Integration

A Notion Integration is a private key that allows the extension to write selected content into pages you authorize.

1. Open [Notion Integrations](https://www.notion.so/profile/integrations).
2. Create an Internal Integration, for example `AI Chat Exporter`.
3. Select the workspace you want to use.
4. Enable the permissions required to read and insert content.
5. Copy the Internal Integration Secret beginning with `ntn_`.

Do not place this token in source code, screenshots, GitHub Issues, or public conversations.

### 3. Grant access to the target page

1. Open the Notion page that should receive the exported content.
2. Click the `•••` menu in the upper-right corner.
3. Choose **Add connections**, then find and add your Integration.

The Integration can access only pages you explicitly authorize and their accessible child content. If the extension cannot find a page, this connection is usually missing.

### 4. Configure and export

1. Click the extension icon in the browser toolbar.
2. Enter your Notion Integration Token.
3. Optionally enter a default parent page ID.
4. Save the settings and click **Test connection**.
5. Open a Claude or ChatGPT conversation.
6. Click the draggable **N** button in the lower-left corner.
7. Choose a Notion page and export mode, then select the Q&A pairs you want.
8. Choose an insertion position in the right-hand preview and click **Export to Notion**.

## Resulting Notion structure

With the separate-page mode, every Q&A pair becomes a Notion subpage:

```text
Page title: the user's question

You Asked
The user's message

────────────

Claude Response / ChatGPT Response
The assistant's response
```

With the merged-page mode, selected Q&A pairs are written to one subpage in their original order, separated by dividers.

## Data and privacy

The extension reads the conversation already displayed in the current Claude or ChatGPT page. It does not call the Claude API or OpenAI API. Selected content is sent only to the Notion API to read authorized pages and complete the export. This project has no developer-operated server, account system, analytics, or advertising service.

The Notion Token, default page information, and floating-button position are stored in the browser extension's local storage. Conversation snapshots, the source-page address, and the last export position remain only in the current tab's memory and disappear when the tab is refreshed or closed.

Read [PRIVACY.md](PRIVACY.md) for the complete data-handling and deletion details.

## Current limitations

- ChatGPT exports only the currently active answer branch.
- Claude can export only content already loaded in the current page.
- A response still being generated is exported only up to the content visible when scanning finishes.
- Uploaded attachments, generated images, Canvas content, and hidden reasoning are not exported.
- Image-only or attachment-only messages keep a placeholder, but the files themselves are not saved.
- Changes to Claude, ChatGPT, or Notion may require updates to the extension.
- Users currently need to create their own Notion Internal Integration. The extension does not provide a consumer OAuth sign-in flow.

## Frequently asked questions

### How do I save a ChatGPT conversation to a specific position in Notion?

Open the ChatGPT conversation, click the **N** button in the lower-left corner, and select the Q&A pairs you want. After choosing a Notion page, insert the content at the beginning, at the end, or after a specific section shown in the preview.

### Can I export only selected parts of a ChatGPT or Claude conversation?

Yes. Nothing is selected when the export panel opens, so you can choose only the Q&A pairs you want to keep.

### Can I merge multiple Q&A pairs into one Notion page?

Yes. You can create one Notion subpage per Q&A pair or merge all selected pairs into a single page.

### Will long ChatGPT conversations be exported completely?

The extension scrolls through the active conversation branch and restores your previous scroll position afterward. If it cannot confirm that it reached the end, it reports an error instead of treating an incomplete export as successful.

### Why can the extension not find my Notion page?

Confirm that the target page has been shared with your Integration through `•••` → **Add connections**, then test the connection again.

### Why do I see a token or permission error?

Confirm that the token is complete, the Integration still exists, and it has permission to read and insert content. Never paste a token into a public Issue.

### Why is the N button missing?

Confirm that the current URL belongs to a supported site. Reload the extension from the browser's extension management page, then refresh the conversation page.

## Development

The project uses Manifest V3 and native JavaScript. It has no npm dependencies and requires no build step.

```text
ai-chat-to-notion/
├── manifest.json
├── background.js               # Notion API request proxy
├── popup.html / popup.js       # Token and default-page settings
├── content/
│   ├── extractor.js            # Claude / ChatGPT page adapters
│   ├── chatgpt-cache.js         # Tab-memory cache and long-chat scanning
│   ├── converter.js             # Page content to Notion blocks
│   ├── builder.js               # Q&A page construction
│   ├── api.js                   # Content-script messaging
│   ├── ui-*.js                  # Floating button, export panel, and position picker
│   └── *.css
├── tests/                       # Dependency-free browser regression fixtures
├── docs/                        # README images and reproducible demo pages
└── INDEX.md                     # Source and architecture index
```

Basic syntax and manifest checks:

```powershell
$files = @('background.js', 'popup.js') + (Get-ChildItem content -Filter *.js).FullName
foreach ($file in $files) { node --check $file }
Get-Content -Raw -Encoding UTF8 manifest.json | ConvertFrom-Json | Out-Null
```

The HTML files under `tests/` cover conversation extraction, long-chat caching, the export panel, precise position selection, equation and quote previews, the last export position, and error messages. Open a fixture directly in a browser; `PASS` at the top means that focused regression check succeeded.

See [CHANGELOG.md](CHANGELOG.md) for version history. Before opening a public Issue, remove private conversations, Notion page names, page IDs, and tokens.

## License

This project is available under the [MIT License](LICENSE). You may use, modify, and distribute the code as long as the copyright and license notice are preserved.
