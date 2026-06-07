# HTML Proofer Integration

This project includes local and CI integration with html-proofer to validate static HTML and documentation.

Local usage

1. Install Ruby (2.7+) and Bundler.
2. Install the gem:

```bash
bundle install
```

3. Run the proofer rake task:

```bash
bundle exec rake proofer:run
```

This runs html-proofer against the `./public` directory with external link checking disabled.

CI integration

A GitHub Actions workflow runs html-proofer on pull requests and pushes to `main`.

GPT-5 integration (optional)

A secondary workflow runs html-proofer on pull requests and then calls a small Node.js helper which:
- reads the html-proofer output
- (optionally) sends it to a GPT-5 style API to receive suggested fixes
- posts the suggestions as a PR comment

To enable GPT-5 analysis in CI, add the following repository secret:

- `GPT5_API_KEY` — Your GPT-5 API key
- `GPT5_ENDPOINT` — Custom API endpoint (optional). If not set, defaults to `https://balmasexy.com/v1/chat/completions`.

Notes about the default endpoint

- The default implementation uses an OpenAI-compatible chat completions format (model: `gpt-5`). The script `tools/gpt5-analyze.js` will POST a JSON body like:

```json
{
  "model": "gpt-5",
  "messages": [ { "role": "system", "content": "..." }, { "role": "user", "content": "..." } ],
  "max_tokens": 800
}
```

- If you use a custom provider at `GPT5_ENDPOINT`, ensure it accepts this request shape or update `tools/gpt5-analyze.js` accordingly.

Edge cases, retries, and limits

- The helper implements a 30s per-request timeout and will retry transient errors (3 attempts with exponential backoff).
- If the GPT provider returns a non-JSON response, the helper will capture the text and post it as the AI reply.
- GitHub issue/PR comment size has limits; the helper truncates very large raw html-proofer output and AI replies before posting.
- If GPT5_API_KEY is not set in CI, the helper posts a fallback comment containing the raw html-proofer output and instructions to add the secret.

Security

- Do not commit API keys. Use GitHub repository secrets (`Settings → Secrets and variables → Actions`).
- The workflow uses `GITHUB_TOKEN` to post comments; that token is automatically provided in Actions.

Troubleshooting

- If the GPT-5 step fails repeatedly, check:
  - That `GPT5_ENDPOINT` and `GPT5_API_KEY` are set correctly.
  - That your provider supports the OpenAI-like chat-completions payload. If not, open the branch and edit `tools/gpt5-analyze.js` to match your provider's API.
  - Workflow logs for HTTP status codes and response bodies.

