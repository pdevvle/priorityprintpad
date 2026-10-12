#!/usr/bin/env bash
# Merges storytold/designcraft's main into the current branch (a fresh upstream-sync branch) and
# resolves the conflicts this repo always answers the same way. Anything else stops the merge,
# names the files, and exits 2: a person (or Claude) resolves those by hand on the branch.
#
# Standing answers (CLAUDE.md):
#   - Upstream files this repo deleted stay deleted: the FreeBSD and Windows ARM64 workflows, and
#     the ArtCraft brand files (docs/brand/), even if upstream changes or re-adds them.
#   - Cargo.lock: upstream's, then cargo adds our crates (pps-*) without upgrading anything.
#   - README.md and CLAUDE.md are this repo's own: ours.
# After the merge, the ArtCraft mark must not have come back into the code (brand licence).
#
# Usage: upstream-merge.sh [upstream-ref]     (default upstream/main)
# Writes `new=<commits>` and `upstream=<sha>` to $GITHUB_OUTPUT when set. Exit 0 = merged and
# committed, or nothing new; 2 = conflicts need a person; 3 = the brand guard failed.
set -euo pipefail

ref=${1:-upstream/main}
out=${GITHUB_OUTPUT:-/dev/null}
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/storytold/designcraft.git
git fetch -q upstream main

new=$(git rev-list --count "HEAD..$ref")
sha=$(git rev-parse "$ref")
echo "new=$new" >> "$out"
echo "upstream=$sha" >> "$out"
if [ "$new" -eq 0 ]; then echo "Up to date with $ref ($sha)."; exit 0; fi
echo "$new new upstream commit(s), up to ${sha:0:7}:"
git log --oneline "HEAD..$ref" | head -50

git merge --no-ff --no-commit "$ref" >/dev/null 2>&1 || true

DELETED=(.github/workflows/freebsd.yml .github/workflows/windows-arm64.yml)
unresolved=()
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    .github/workflows/freebsd.yml|.github/workflows/windows-arm64.yml|docs/brand/*)
      git rm -q --ignore-unmatch -- "$f" ;;
    Cargo.lock)
      git checkout -q --theirs -- Cargo.lock
      cargo metadata --format-version 1 >/dev/null
      git add Cargo.lock ;;
    README.md|CLAUDE.md)
      git checkout -q --ours -- "$f"
      git add -- "$f" ;;
    *) unresolved+=("$f") ;;
  esac
done < <(git diff --name-only --diff-filter=U)

# Deleted files upstream changed without a conflict, or re-added, stay deleted too.
for f in "${DELETED[@]}"; do git rm -q --ignore-unmatch -- "$f"; done
git rm -rq --ignore-unmatch -- docs/brand

if [ "${#unresolved[@]}" -gt 0 ]; then
  echo "Conflicts that need a person:"
  printf '  %s\n' "${unresolved[@]}"
  git merge --abort
  exit 2
fi

# The brand licence: the ArtCraft mark and its painter must not come back with a merge.
if git grep -nE 'MARK_PATH|paint_mark|artcraft-(mark|logo)' -- crates apps; then
  echo "The ArtCraft mark is back in the code after the merge (see above). Remove it as before."
  git merge --abort
  exit 3
fi

git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -q -m "Merge upstream DesignCraft ${sha:0:7} ($new commits)" \
  -m "storytold/designcraft main at $sha. Merged by .github/scripts/upstream-merge.sh: deleted workflows and brand files stay deleted, Cargo.lock is upstream's plus our crates, README.md and CLAUDE.md are ours."
echo "Merged ${sha:0:7}."
