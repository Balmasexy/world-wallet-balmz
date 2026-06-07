#!/usr/bin/env bash
set -euo pipefail

# create_pr.sh — Creates PR for feature/htmlproofer-gpt5 in Balmasexy/world-wallet-balmz
# Usage: ./create_pr.sh
# Optional environment variables:
#   GPT5_API_KEY      (will be set as a repo secret if provided)
#   GPT5_ENDPOINT     (will be set as a repo secret if provided)
#
# Run from your local clone of the repository (origin should point to GitHub).

OWNER="Balmasexy"
REPO="world-wallet-balmz"
BRANCH="feature/htmlproofer-gpt5"
BASE="main"
LABEL="World Wallet"
TITLE="Add html-proofer + GPT-5 CI integration"

# Check prerequisites
command -v gh >/dev/null 2>&1 || { echo "gh CLI is required. Install https://cli.github.com/"; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Run this script from inside your local git repo."; exit 1; }

# Ensure branch exists locally
git fetch origin "${BRANCH}"
if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  git checkout "${BRANCH}"
else
  # create local tracking branch if remote exists, otherwise fail
  if git ls-remote --heads origin "${BRANCH}" | grep -q "${BRANCH}"; then
    git checkout -b "${BRANCH}" "origin/${BRANCH}"
  else
    echo "Branch ${BRANCH} not found on origin. Aborting."
    exit 1
  fi
fi

# Check existing PR for this head
existing_pr_url=$(gh pr list --repo "${OWNER}/${REPO}" --head "${OWNER}:${BRANCH}" --json url -q '.[0].url' 2>/dev/null || true)
if [ -n "${existing_pr_url}" ]; then
  echo "A PR already exists for ${BRANCH}:"
  echo "${existing_pr_url}"
  exit 0
fi

# Create label if missing
if ! gh label view "${LABEL}" --repo "${OWNER}/${REPO}" >/dev/null 2>&1; then
  echo "Creating label: ${LABEL}"
  gh label create "${LABEL}" --color F7C6C7 --description "World Wallet related items" --repo "${OWNER}/${REPO}"
else
  echo "Label '${LABEL}' already exists."
fi

# Prepare PR body in a temp file
pr_body_file=$(mktemp)
cat > "${pr_body_file}" <<'EOF'
Adds html-proofer support (Gemfile, Rake task), docs, CI workflows, and a GPT-5 analysis helper that posts suggested fixes as PR comments.

Files added: Gemfile, Rakefile, docs/HTML_PROOFER.md, .github/workflows/htmlproofer.yml, .github/workflows/htmlproofer-gpt5.yml, tools/gpt5-analyze.js, .env.example, .github/CODEOWNERS, .github/PULL_REQUEST_TEMPLATE.md, tools/package.json, README.md

Default GPT endpoint: https://balmasexy.com/v1/chat/completions (override with secret GPT5_ENDPOINT). Add secret GPT5_API_KEY to enable AI analysis.

Preferred merge method: squash and merge.
EOF

echo "Creating Pull Request..."
pr_create_output=$(gh pr create --repo "${OWNER}/${REPO}" --title "${TITLE}" --body-file "${pr_body_file}" --base "${BASE}" --head "${BRANCH}" --reviewer Balmasexy --assignee Balmasexy --label "${LABEL}" 2>&1) || {
  echo "gh pr create failed:"
  echo "${pr_create_output}"
  rm -f "${pr_body_file}"
  exit 1
}

rm -f "${pr_body_file}"

# Extract PR URL from gh output
pr_url=$(printf '%s\n' "${pr_create_output}" | grep -Eo 'https://github\.com/[^ ]+/pull/[0-9]+' | head -n1 || true)
if [ -n "${pr_url}" ]; then
  echo "Pull request created: ${pr_url}"
else
  echo "PR created (could not detect URL); gh output:"
  echo "${pr_create_output}"
fi

# Optionally set secrets if provided in environment
set_secret() {
  local name=$1
  local value=$2
  if [ -z "${value}" ]; then
    return
  fi
  echo "Setting secret ${name} for ${OWNER}/${REPO}..."
  # Use --body to pass the secret value
  gh secret set "${name}" --body "${value}" --repo "${OWNER}/${REPO}"
}

if [ -n "${GPT5_API_KEY:-}" ]; then
  set_secret "GPT5_API_KEY" "${GPT5_API_KEY}"
else
  echo "Environment variable GPT5_API_KEY not set. You can add it later via 'gh secret set GPT5_API_KEY --body <value> --repo ${OWNER}/${REPO}' or the repo UI."
fi

if [ -n "${GPT5_ENDPOINT:-}" ]; then
  set_secret "GPT5_ENDPOINT" "${GPT5_ENDPOINT}"
else
  echo "Environment variable GPT5_ENDPOINT not set. The workflow will default to https://balmasexy.com/v1/chat/completions unless you set this secret."
fi

echo
echo "Next steps:"
echo " - Visit the PR: ${pr_url:-(open repo PR list)}"
echo " - Ensure repo secret GPT5_API_KEY is set (if not already)."
echo " - Wait for CI: html-proofer and html-proofer+GPT-5 jobs to run."
echo " - After approval and CI success, merge with:"
echo "     gh pr merge ${pr_url##*/} --squash --delete-branch"
echo
echo "Done."
