# Contributing to World Wallet Balmz

Thanks for considering contributing! This document explains how to run tests, the proofer, and the PR process.

Getting started

1. Fork the repository and create a topic branch for your changes.
2. Ensure you have Ruby (>= 2.7) and Node (>= 18) installed.

Running html-proofer locally

1. Install Ruby dependencies:

   bundle install

2. Build or ensure your static site is in ./public

3. Run the proofer rake task:

   bundle exec rake proofer:run

This runs html-proofer against ./public with external checks disabled by default.

Testing the GPT helper locally (dry-run)

1. Produce proofer output:

   mkdir -p proofer-output
   bundle exec htmlproofer ./public --disable-external --allow-hash-href 2>&1 | tee proofer-output/proofer_output.txt

2. Run the helper in dry mode (does not post to GitHub):

   node tools/gpt5-analyze.js proofer-output/proofer_output.txt --dry

PR process

- Create a topic branch for your change.
- Ensure html-proofer passes locally and include test updates if applicable.
- Follow the PR template when opening a pull request.
- Add reviewers and labels as appropriate. CODEOWNERS will request a review from @Balmasexy.

Security and secrets

- Do not commit API keys or secrets. Use GitHub repository secrets (Settings → Secrets and variables → Actions) for GPT5_API_KEY and GPT5_ENDPOINT.

Thank you for contributing!
