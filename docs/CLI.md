# Smart Deploy CLI

The Smart Deploy CLI lets you discover services, inspect the generated build plan, configure runtime settings, and manage deployments without leaving a Git checkout.

Install or run the beta package with Node.js 20 or later:

~~~bash
npx @arm8tron/smart-deploy@beta login
~~~

## Start a project

Run these commands from a Git checkout with a GitHub `origin` remote:

~~~bash
smart-deploy init
smart-deploy login
smart-deploy service discover
smart-deploy service list
smart-deploy service select web
~~~

`init` records only the selected repository, branch, and service in `.smartdeploy/state.json`. The directory is ignored by Git. CLI credentials are stored separately in the user configuration directory; no credentials or environment-secret values are written into the repository.

## Analyze and deploy

~~~bash
smart-deploy analyze
smart-deploy domain check storefront
smart-deploy domain set https://storefront.smart-deploy.xyz
smart-deploy env set API_URL https://api.example.com
smart-deploy deploy
smart-deploy status
smart-deploy logs --run RUN_ID --follow
~~~

`analyze` resolves the selected branch's latest GitHub commit, requests the same Smart Analysis used by the web application, and persists its deploy plan. `deploy` queues that persisted plan and returns a deployment run ID. Follow a specific run with `logs --run RUN_ID --follow`; without `--run`, `logs` shows recent runtime logs for the selected service.

## Repositories, domains, secrets, and rollback

~~~bash
smart-deploy repo list
smart-deploy repo use https://github.com/acme/storefront --branch main
smart-deploy env list
smart-deploy env unset API_URL
smart-deploy domain clear
smart-deploy rollback SUCCESSFUL_RUN_ID
~~~

`rollback` queues a redeploy of the commit recorded by a successful deployment run while retaining the selected service's current environment variables.

## Command reference

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

The CLI does not accept GitHub OAuth credentials. Its browser-based login exchanges a short-lived device authorization for a scoped Smart Deploy token, while GitHub access stays on the Smart Deploy server.
