# Contributing to LearnHub

First off, thank you for taking the time to contribute to LearnHub. Contributions help make this project a better open-source learning space for everyone.

To keep the community healthy and productive, please follow the guidelines below before opening an issue or pull request.

## Table of Contents

- [How to Participate](#how-to-participate)
- [Branch Naming Convention](#branch-naming-convention)
- [Local Development Setup](#local-development-setup)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Issue Assignment Policy](#issue-assignment-policy)
- [Code Style and Quality](#code-style-and-quality)
- [ECSoC Contribution Rules](#ecsoc-contribution-rules)

---

## How to Participate

1. **Star the repository** to support the project.
2. **Fork the repository** to your GitHub account.
3. **Clone your fork** locally and start working.

```bash
git clone https://github.com/YOUR_USERNAME/learnhub.git
cd learnhub
```

4. **Set up the upstream remote** so your fork stays synced with the main repository.

```bash
git remote add upstream https://github.com/udaycodespace/learnhub.git
```

5. **Read the Code of Conduct and this guide** before contributing.
6. **Comment on the issue** to express interest and wait for assignment before starting work.

---

## Branch Naming Convention

Create a descriptive branch using one of the following prefixes:

- `feat/` for new features, for example `feat/interactive-quizzes`.
- `fix/` for bug fixes, for example `fix/jwt-auth-expiration`.
- `docs/` for documentation updates, for example `docs/add-contributing-guide`.
- `refactor/` for code restructuring, for example `refactor/user-controller-optimization`.
- `test/` for adding or correcting tests, for example `test/admin-auth`.
- `chore/` for build tasks, package updates, and maintenance, for example `chore/dependency-updates`.

---

## Local Development Setup

Please refer to the local setup steps in the main README to run the frontend and backend of LearnHub locally.

If the project setup is unclear or blocked, ask in the issue or community channel before opening a PR.

---

## Commit Message Guidelines

We follow the Conventional Commits specification. Commit messages should follow this format:

```bash
<type>(<scope>): <short description>
```

### Allowed Types

- `feat`: A new feature.
- `fix`: A bug fix.
- `docs`: Documentation changes.
- `style`: Changes that do not affect code meaning, such as whitespace or formatting.
- `refactor`: A code change that neither fixes a bug nor adds a feature.
- `perf`: A code change that improves performance.
- `test`: Adding missing tests or correcting existing tests.
- `chore`: Changes to the build process or auxiliary tools.

*Example:* `feat(auth): add google oauth registration`

---

## Pull Request Process

1. **Link an issue** in every PR using `Closes #123`, `Fixes #456`, or a similar reference.
2. **Keep PRs focused** on one issue or one clear change set.
3. **Do not open a PR without assignment** unless a maintainer has explicitly allowed it.
4. **Self-review your changes** before submitting.
5. **Run checks locally** and make sure there are no lint, build, or console errors.
6. **Describe what changed** and mention any important notes in the PR body.

---

## Issue Assignment Policy

To work on an issue, express your interest in the issue comment section using the automated command:

- Comment `/assign` to self-assign only if the issue has no assignees yet.
- If the issue is already assigned, do not use `/assign`. Instead, explain your approach and wait for maintainer guidance.
- Contributors are limited to **2 concurrent open issues**.
- Active assignments are valid for **3 days from assignment to pull request**.
- If you cannot submit a PR within 3 days, post an update before the deadline explaining the delay.
- A warning comment may be posted if the issue is close to the deadline with no PR activity.
- Issues with no meaningful progress after the deadline may be unassigned to keep work moving.

---

## Code Style and Quality

- Follow the ESLint rules defined in the frontend package.
- Fix all lint warnings before opening a PR.
- Do not leave console errors, debug logs, or commented-out draft code in the final submission.
- Remove unused imports, dead code, and temporary test code before submitting.
- Keep changes clean, minimal, and easy to review.

---

## ECSoC Contribution Rules

These rules help prevent farming and keep contributions meaningful:

- Empty or trivial PRs are not accepted.
- Pull requests with less than 20 lines of meaningful code or documentation changes are not accepted unless a maintainer has explicitly approved the scope in advance.
- Every PR must solve a real issue, add real value, or meaningfully improve the project.
- Trivial changes made only to gain XP will be rejected.
- PRs must be submitted within **3 days of issue assignment**.
- If you are blocked or need more time, comment on the issue before the 3-day deadline.
- Only one contributor should work on a claimed issue at a time unless a maintainer says otherwise.

---

## Helpful Notes

- Keep your branch focused on one issue.
- Make commits small and clear.
- Test your changes before opening the pull request.
- Link the related issue in the PR description.
- Follow the project’s label and review rules carefully.