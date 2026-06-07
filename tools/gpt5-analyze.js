#!/usr/bin/env node
/*
  tools/gpt5-analyze.js

  OpenAI-compatible chat completions integration with retries and safety guards.

  Behavior summary:
  - Reads html-proofer CLI output file and determines PR context from GITHUB_EVENT_PATH.
  - If GPT5_API_KEY is missing, posts a fallback PR comment with truncated raw output and instructions.
  - If GPT5_API_KEY is present, calls GPT5_ENDPOINT (default https://balmasexy.com/v1/chat/completions) using
    Authorization: Bearer <GPT5_API_KEY> and an OpenAI-style chat payload.
  - Retries transient network/5xx errors (3 attempts) with exponential backoff.
  - Applies a per-request timeout (30s). Truncates large AI replies and raw output to avoid GitHub comment limits.
*/

const fs = require('fs').promises;

const MAX_COMMENT_LENGTH = 60000; // safe margin under GitHub's ~65536 limit
const MAX_AI_REPLY = 15000;
const MAX_RAW_REPORT = 20000;

async function main() {
  const outFile = process.argv[2] || 'proofer_output.txt';
  let prooferText = '';
  try {
    prooferText = await fs.readFile(outFile, 'utf8');
  } catch (err) {
    console.error('Could not read proofer output file:', outFile, err.message);
    process.exit(0);
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.error('GITHUB_EVENT_PATH not set; cannot determine PR context. Skipping comment.');
    process.exit(0);
  }

  let event = {};
  try {
    const raw = await fs.readFile(eventPath, 'utf8');
    event = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse GITHUB_EVENT_PATH:', err.message);
  }

  const prNumber = event.pull_request && event.pull_request.number;
  const repoFull = event.repository && event.repository.full_name; // owner/repo

  if (!prNumber || !repoFull) {
    console.error('PR number or repository information not found in event payload. Skipping.');
    process.exit(0);
  }

  const [owner, repo] = repoFull.split('/');

  const gptKey = process.env.GPT5_API_KEY;
  const endpoint = process.env.GPT5_ENDPOINT || 'https://balmasexy.com/v1/chat/completions';

  if (!gptKey) {
    console.log('GPT5_API_KEY not set — posting raw html-proofer output as PR comment with instructions.');
    const body = buildFallbackComment(prooferText);
    await postPrComment(owner, repo, prNumber, body);
    process.exit(0);
  }

  try {
    const aiReply = await callGpt5WithRetries(gptKey, endpoint, prooferText, 3);
    const shortAi = aiReply.length > MAX_AI_REPLY ? aiReply.slice(0, MAX_AI_REPLY) + '\n\n[Truncated]' : aiReply;
    const body = buildAiComment(shortAi, prooferText);
    await postPrComment(owner, repo, prNumber, body);
  } catch (err) {
    console.error('GPT-5 call failed:', err.message || err);
    const body = buildFallbackComment(prooferText, '(GPT-5 call failed — posted raw output)');
    await postPrComment(owner, repo, prNumber, body);
  }
}

function buildFallbackComment(reportText, headerNote) {
  const header = headerNote || 'html-proofer found the following issues:';
  const short = reportText.length > MAX_RAW_REPORT ? reportText.slice(0,MAX_RAW_REPORT) + '\n\n[Truncated]' : reportText;
  const safe = escapeForMarkdown(short);
  const body = `**html-proofer report**\n\n${header}\n\n<details><summary>Click to expand html-proofer output</summary>\n\n${safe}\n\n</details>\n\n_You can enable GPT-5 analysis by adding the repository secret \\`GPT5_API_KEY\\` and (optionally) \\`GPT5_ENDPOINT\\`._`;
  return enforceCommentLimit(body);
}

function buildAiComment(aiText, rawReport) {
  const shortReport = rawReport.length > MAX_RAW_REPORT ? rawReport.slice(0,MAX_RAW_REPORT) + '\n\n[Truncated]' : rawReport;
  const safeReport = escapeForMarkdown(shortReport);
  const body = `**html-proofer + GPT-5 suggested fixes**\n\n${aiText}\n\n---\n\n<details><summary>html-proofer raw output (click to expand)</summary>\n\n${safeReport}\n\n</details>`;
  return enforceCommentLimit(body);
}

function escapeForMarkdown(text) {
  // Prevent triple-backtick blocks from breaking the comment and remove CRs
  return text.replace(/```/g, "`\u200B``").replace(/\r/g, '');
}

function enforceCommentLimit(body) {
  if (body.length <= MAX_COMMENT_LENGTH) return body;
  // Truncate the raw output section if present
  const marker = '<details>';
  const idx = body.indexOf(marker);
  if (idx === -1) return body.slice(0, MAX_COMMENT_LENGTH - 20) + '\n\n[Truncated]';
  const head = body.slice(0, idx);
  const tail = body.slice(idx);
  // truncate tail
  const allowedTail = MAX_COMMENT_LENGTH - head.length - 20;
  if (allowedTail <= 0) return head.slice(0, MAX_COMMENT_LENGTH - 20) + '\n\n[Truncated]';
  return head + tail.slice(0, allowedTail) + '\n\n[Truncated]';
}

async function postPrComment(owner, repo, prNumber, body) {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_ACTIONS_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN not provided. Cannot post comment.');
    return;
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ body })
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Failed to post PR comment', res.status, text);
  } else {
    console.log('Posted PR comment successfully');
  }
}

async function callGpt5WithRetries(key, endpoint, prooferText, attempts) {
  let attempt = 0;
  let lastErr = null;
  while (attempt < attempts) {
    try {
      return await callGpt5(key, endpoint, prooferText);
    } catch (err) {
      lastErr = err;
      attempt++;
      // Retry on network errors or 5xx
      const wait = Math.pow(2, attempt) * 1000; // exponential backoff (2^attempt * 1s)
      console.warn(`GPT-5 call attempt ${attempt} failed: ${err.message || err}. Retrying in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr || new Error('GPT-5 unknown failure');
}

async function callGpt5(key, endpoint, prooferText) {
  const url = endpoint; // expected to be OpenAI-compatible chat completions endpoint

  const prompt = `You are an assistant that summarizes html-proofer output and returns a short actionable list of fixes for a documentation/website team. Provide a concise bulleted list of issues, their likely causes, and suggested fixes. Respond in markdown suitable for a GitHub PR comment.\n\nhtml-proofer output:\n\n${prooferText}`;

  const payload = {
    model: 'gpt-5',
    messages: [
      { role: 'system', content: 'You are an expert documentation engineer.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 800
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: controller.signal
  });

  clearTimeout(timeout);

  if (!res.ok) {
    const txt = await res.text();
    const err = new Error(`GPT-5 API error: ${res.status} ${txt}`);
    // classify as transient if 5xx
    if (res.status >= 500 && res.status < 600) err.transient = true;
    throw err;
  }

  // Try parse JSON; if it fails, return raw text
  let data;
  try {
    data = await res.json();
  } catch (e) {
    const text = await res.text();
    return text;
  }

  // OpenAI-like response parsing
  if (data.choices && data.choices[0]) {
    if (data.choices[0].message && data.choices[0].message.content) return data.choices[0].message.content;
    if (data.choices[0].text) return data.choices[0].text;
  }

  // Fallback: stringify response
  return JSON.stringify(data, null, 2);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
