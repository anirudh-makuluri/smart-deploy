# Smart Deploy CLI

> Beta release: login and local project selection are available today. Smart Analysis and deployment commands are still in development.

Smart Deploy is a preview-first application deployment platform. This CLI connects a local Git checkout to your Smart Deploy account.

## Install or run

Use Node.js 20 or later.

~~~bash
npx @arm8tron/smart-deploy@beta login
~~~

## Commands

~~~text
smart-deploy login
smart-deploy logout
smart-deploy init [--repo URL] [--branch NAME] [--service NAME]
smart-deploy repo show
smart-deploy repo use URL [--branch NAME]
smart-deploy service select NAME
smart-deploy config show
~~~

Login opens a browser authorization flow and uses your existing Smart Deploy GitHub connection. The CLI never receives your GitHub OAuth token.

Init stores the selected repository, branch, and service in .smartdeploy/state.json, which is ignored by Git. It does not store secrets or deployment credentials in the repository.

Install beta releases explicitly:

~~~bash
npx @arm8tron/smart-deploy@beta
~~~

See the [Smart Deploy repository](https://github.com/anirudh-makuluri/smart-deploy) for source, issues, and release status.
