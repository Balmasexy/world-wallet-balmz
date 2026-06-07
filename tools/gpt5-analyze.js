#!/usr/bin/env node
/*
  tools/gpt5-analyze.js

  Updated to use an OpenAI-compatible chat completions API by default.

  Request/Response spec (OpenAI-compatible, B1):
  - Endpoint (default): https://balmasexy.com/v1/chat/completions
    (You can override with environment variable GPT5_ENDPOINT)
  - HTTP method: POST
  - Auth: Authorization: Bearer <GPT5_API_KEY>
    (GPT5_API_KEY must be provided in env)
  - Headers: Content-Type: application/json
  - Request body example:
    {
      "model": "gpt-5",
      "messages": [ { "role": "system", "content": "..." }, { "role": "user", "content": "..." } ],
      "max_tokens": 800
    }
  - Response example (OpenAI-style):
    {
      "choices": [ { "message": { "role": "assistant", "content": "..." } } ],
      ...
    }

  Behavior:
  - If GPT5_API_KEY is not set, posts a fallback PR comment containing the raw html-proofer output and instructions.
  - If GPT5_API_KEY is set, POSTs the prompt to the GPT5_ENDPOINT and parses the response for choices[0].message.content.
  - Posts the AI reply as a PR comment on the pull request that triggered the workflow.

  Note: If your provider is OpenAI, you can set GPT5_ENDPOINT to https://api.openai.com/v1/chat/completions and use the same API key.
*/

const fs = require('fs').promises;

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
    const aiReply = await callGpt5(gptKey, endpoint, prooferText);
    const body = buildAiComment(aiReply, prooferText);
    await postPrComment(owner, repo, prNumber, body);
  } catch (err) {
    console.error('GPT-5 call failed:', err.message || err);
    const body = buildFallbackComment(prooferText, '(GPT-5 call failed — posted raw output)');
    await postPrComment(owner, repo, prNumber, body);
  }
}

function buildFallbackComment(reportText, headerNote) {
  const header = headerNote || 'html-proofer found the following issues:';
  const short = reportText.length > 15000 ? reportText.slice(0,15000) + '\n\n[Truncated]' : reportText;
  return `**html-proofer report**\n\n${header}\n\n<details><summary>Click to expand html-proofer output</summary>\n\n${escapeForMarkdown(short)}\n\n</details>\n\n_You can enable GPT-5 analysis by adding the repository secret ` + "`GPT5_API_KEY`" + ` and (optionally) ` + "`GPT5_ENDPOINT`" + `._`;
}

function buildAiComment(aiText, rawReport) {
  const shortReport = rawReport.length > 8000 ? rawReport.slice(0,8000) + '\n\n[Truncated]' : rawReport;
  return `**html-proofer + GPT-5 suggested fixes**\n\n${aiText}\n\n---\n\n<details><summary>html-proofer raw output (click to expand)</summary>\n\n${escapeForMarkdown(shortReport)}\n\n</details>`;
}

function escapeForMarkdown(text) {
  // Basic escaping to avoid breaking the markdown in PR comments
  return text.replace(/```/g, "`\u200B``").replace(/\r/g, '');
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
    throw new Error(`GPT-5 API error: ${res.status} ${txt}`);
  }

  const data = await res.json();

  // OpenAI-like response parsing
  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content;
  }
  // Some providers return a slightly different shape
  if (data.choices && data.choices[0] && data.choices[0].text) {
    return data.choices[0].text;
  }
  // Fallback: stringify response
  return JSON.stringify(data, null, 2);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
