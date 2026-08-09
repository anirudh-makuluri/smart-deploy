# Smart Deploy CLI

> Beta release: repository discovery, Smart Analysis, deployment controls, and runtime configuration are available today.

Smart Deploy is a preview-first application deployment platform. This CLI connects a local Git checkout to your Smart Deploy account.

## Install or run

Use Node.js 20 or later.

~~~bash
npx @arm8tron/smart-deploy@beta login
~~~

## Commands

~~~text
smart-deploy login | logout
smart-deploy init [--repo URL] [--branch NAME] [--service NAME]
smart-deploy repo list | show | use URL [--branch NAME]
smart-deploy service discover | list | select NAME
smart-deploy analyze
smart-deploy env list | set NAME VALUE | unset NAME
smart-deploy domain check SUBDOMAIN | set URL | clear
smart-deploy deploy [--commit SHA]
smart-deploy deployment delete
smart-deploy status
smart-deploy logs [--run ID] [--follow]
smart-deploy rollback RUN_ID
smart-deploy config show
~~~

Login opens a browser authorization flow and uses your existing Smart Deploy GitHub connection. The CLI never receives your GitHub OAuth token.

Init stores the selected repository, branch, and service in .smartdeploy/state.json, which is ignored by Git. It does not store secrets or deployment credentials in the repository. See the full [CLI guide](https://github.com/anirudh-makuluri/smart-deploy/blob/main/docs/CLI.md) for the analyze, environment-variable, domain, deploy, log, and rollback workflow.

Install beta releases explicitly:

~~~bash
npx @arm8tron/smart-deploy@beta
~~~

See the [Smart Deploy repository](https://github.com/anirudh-makuluri/smart-deploy) for source, issues, and release status.
