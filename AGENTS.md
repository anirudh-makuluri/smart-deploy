# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

---

## SmartDeploy Overview

SmartDeploy is a preview driven deployment platform that analyzes your GitHub repo, generates build plans, allows the user to inspect and they deploy with confidence.

---

## Repository Structure

```text
src/             The code for the nextjs app and the ws server
infra/           Infrastructure as code (Used to deploy the websocket server to AWS EC2)
scripts/         Scripts to deploy ws server, renew ssl etc
docs/            Documentation
tests/           Automated tests
```

When modifying code:

- Do NOT introduce too many conditional types. Most of the code is present in the same repo. Have a look at what the return type is and adjust the variables accordingly.
- Test cases are necessary. Try to keep the coverage as high as possible.
- Make sure we keep react-doctor atleast 95/100 all the time.
- If you have any doubts or any uncertainty, always ask. DO NOT GUESS.


---

## Engineering Principles

### 1. Small Changes

Prefer incremental changes.

Avoid:

* Large refactors mixed with feature work
* Unrelated formatting changes
* Renaming files without justification

### 2. Test Before Merge

For code changes:

* Run relevant unit tests.
* Run integration tests when deployment logic changes.
* Update tests when behavior changes.

Do not remove failing tests without explanation.

---

## Agent Behavior

Before making changes:

1. Read relevant code.
2. Understand existing patterns.
3. Search for related implementations.
4. Prefer consistency with existing architecture.

When proposing changes:

* Explain reasoning.
* List risks.
* Identify assumptions.

When uncertain:

* Ask for clarification rather than guessing.

---

## Important Code Terminology

- Refer `src/app/types.ts` to know the variables in each type.
- `RepoRecord` : This variable contains basic info of a repo and the services that were detected.
- `repoType` : Contains the data which was retrieved from the GitHub api.
- `DeployConfig` : The entire deployment data including the scan results. This should be the source of truth for a deployment.


## Code Style

### TypeScript

* Enable strict typing.
* Avoid `any`.
* Prefer explicit interfaces.
* All the types must be capitalized.
* Avoid `?`

### General

* Favor readability over cleverness.
* Add comments only when necessary.
* Keep modules cohesive.

---

## Definition of Done

A task is complete when:

* Code builds successfully.
* Relevant tests pass.
* Documentation is updated.
* Deployment safety guarantees remain intact.
* A reviewer can understand the change without additional context.
