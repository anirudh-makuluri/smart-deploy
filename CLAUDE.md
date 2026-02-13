# SmartDeploy CLAUDE.md
COMMANDS:
- npm install
- npm run lint
- npm test
- npm run build
- git add .; git commit -m "[feat/fix]: [desc]"; git push
- gh pr create --title "[title]" --body "[plan]"

ARCHITECTURE: AI DevOps platform (Next.js frontend, Node.js/Socket.IO backend, AWS/GCP deploy).

WORKFLOW: TDD (tests first), fix until pass, semantic commits, PRs.

SCAN ON START: ls -la; tree -L 2; cat package.json README.md
