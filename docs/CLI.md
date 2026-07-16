# Smart Deploy CLI

The CLI foundation keeps the deployment project selection local to a Git checkout. It does not store credentials or environment-secret values in the repository.

## Local project selection

Run this from a Git checkout with a GitHub origin remote:

~~~bash
npx smart-deploy init
~~~

The command records the repository URL, branch, and optional service name in .smartdeploy/state.json. The directory is ignored by Git.

You can update a selection without rerunning the wizard:

~~~bash
npx smart-deploy repo use https://github.com/acme/storefront --branch main
npx smart-deploy service select web
npx smart-deploy config show
~~~

## Safety model

- Local state contains no access token, secret, or deployment configuration.
- The CLI requires a GitHub origin and records selection only for the current checkout.
- Future analysis and deployment commands will use the exact pushed commit, preventing uncommitted local files from being deployed accidentally.

## Planned commands

The next implementation slices add device login, repository/service discovery, platform-domain setup, AWS Secrets Manager-backed environment variables, Smart Analysis previews, deployment queueing, status, and streamed logs.
