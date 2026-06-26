# Geonections Local Setup

This downloads the private `Andrew454545/Geonections-` repository to a collaborator's computer and includes the checked-in JSON files, including the puzzle JSONs under `ui/public/puzzles/`.

## Before Running

1. Andrew must invite the collaborator's GitHub username to `Andrew454545/Geonections-`.
2. The collaborator needs Git and GitHub CLI installed.
   - macOS: `brew install gh`
   - Windows: `winget install --id GitHub.cli`
   - Linux: install from `https://cli.github.com/`

## One-Line Setup

Run this in Terminal:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Andrew454545/mma-public-fork/master/scripts/setup-geonections-local.sh)"
```

The command will:

1. Ask them to sign in to GitHub if they are not already signed in.
2. Check that their GitHub account can access the private Geonections repo.
3. Clone the repo into `~/Documents/Geonections`.
4. Print how many JSON files were downloaded.

## Updating Later

They can run the same command again. If `~/Documents/Geonections` already exists, it will pull the latest version instead of cloning a second copy.

## Custom Folder

To download somewhere else:

```bash
GEONECTIONS_DIR="$HOME/Desktop/Geonections" bash -c "$(curl -fsSL https://raw.githubusercontent.com/Andrew454545/mma-public-fork/master/scripts/setup-geonections-local.sh)"
```

## Common Problems

If they see `This GitHub account cannot access Andrew454545/Geonections-`, the GitHub account they signed into has not been invited to the private repo yet.

If they see `GitHub CLI is required`, install `gh` using the instructions above and run the setup command again.

