import {
  COMMIT_HASH_PATTERN,
  createAvailableBackendResult,
  createUnavailableBackendResult,
  filterHistoryChangedFiles,
  filterHistoryFileEntries,
  getHistoryChangedFilePaths,
  isHistoryIgnoredPath,
  isSshLikeRemoteUrl,
  normalizeHistoryIgnoredPaths,
  normalizeBranchName,
  resolveGitAuth,
  sanitizeRemoteUrl,
  shortenOid
} from "./shared.js";
import fs from "node:fs";
import path from "node:path";

function readNodeGitText(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value.ptr === "string") {
    return value.ptr;
  }

  if (typeof value.tostrS === "function") {
    return value.tostrS();
  }

  return String(value);
}

function readReferenceName(reference) {
  if (!reference) {
    return null;
  }

  if (typeof reference.shorthand === "function") {
    return reference.shorthand();
  }

  if (typeof reference.name === "function") {
    const fullName = reference.name();
    if (fullName.startsWith("refs/heads/")) {
      return fullName.slice("refs/heads/".length);
    }
    return fullName;
  }

  return null;
}

function oidToString(oid) {
  if (!oid) {
    return null;
  }

  if (typeof oid === "string") {
    return oid;
  }

  if (typeof oid.tostrS === "function") {
    return oid.tostrS();
  }

  return String(oid);
}

function isInternalGitPath(filePath) {
  return String(filePath || "").split(/[\\/]+/u).includes(".git");
}

function readStatusPath(entry) {
  if (typeof entry?.path === "function") {
    return entry.path();
  }

  return String(entry?.path || "");
}

async function openOrInitNodeGitRepository(NodeGit, repoRoot) {
  fs.mkdirSync(repoRoot, { recursive: true });

  try {
    return await NodeGit.Repository.open(repoRoot);
  } catch {
    return NodeGit.Repository.init(repoRoot, 0);
  }
}

function checkoutOptions(NodeGit) {
  return {
    checkoutStrategy: NodeGit.Checkout?.STRATEGY?.FORCE
  };
}

function readStatusValue(entry) {
  if (typeof entry?.status === "function") {
    return entry.status();
  }

  return entry?.status || 0;
}

async function stageNodeGitStatusEntries(repo, NodeGit, ignoredPaths = []) {
  const index = await repo.refreshIndex();
  const statusEntries = await repo.getStatus();
  const statusFlags = NodeGit.Status?.STATUS || {};
  const ignoredPathSet = normalizeHistoryIgnoredPaths(ignoredPaths);
  const changedFiles = [];

  for (const ignoredPath of ignoredPathSet) {
    try {
      await index.removeByPath(ignoredPath);
      changedFiles.push(ignoredPath);
    } catch {
      // Already untracked or absent. Future status handling skips ignored paths.
    }
  }

  for (const entry of statusEntries) {
    const filePath = readStatusPath(entry);
    if (!filePath || isInternalGitPath(filePath) || isHistoryIgnoredPath(filePath, ignoredPathSet)) {
      continue;
    }

    changedFiles.push(filePath);
    const value = readStatusValue(entry);
    const deleted =
      (value & (statusFlags.WT_DELETED || 0)) !== 0 ||
      (value & (statusFlags.INDEX_DELETED || 0)) !== 0;

    if (deleted) {
      await index.removeByPath(filePath);
    } else {
      await index.addByPath(filePath);
    }
  }

  await index.write();

  return {
    changedFiles: [...new Set(changedFiles)].sort((left, right) => left.localeCompare(right)),
    treeOid: await index.writeTree()
  };
}

async function tryReadNodeGitHeadCommit(repo) {
  try {
    return await repo.getHeadCommit();
  } catch {
    return null;
  }
}

function readNodeGitCommitTimestamp(commit) {
  if (typeof commit?.date === "function") {
    return commit.date().toISOString();
  }

  return "";
}

function readNodeGitCommitMessage(commit) {
  if (typeof commit?.summary === "function") {
    return commit.summary();
  }

  if (typeof commit?.message === "function") {
    return String(commit.message() || "").split("\n")[0];
  }

  return "";
}

async function readNodeGitCommitChangedFiles(commit) {
  const files = new Set();
  const diffs = typeof commit?.getDiff === "function" ? await commit.getDiff() : [];

  for (const diff of diffs) {
    const patches = typeof diff?.patches === "function" ? await diff.patches() : [];

    for (const patch of patches) {
      const newFile = typeof patch?.newFile === "function" ? patch.newFile() : null;
      const oldFile = typeof patch?.oldFile === "function" ? patch.oldFile() : null;
      const newPath = typeof newFile?.path === "function" ? newFile.path() : "";
      const oldPath = typeof oldFile?.path === "function" ? oldFile.path() : "";
      const filePath = newPath && newPath !== "/dev/null" ? newPath : oldPath;

      if (filePath && filePath !== "/dev/null" && !isInternalGitPath(filePath)) {
        files.add(filePath);
      }
    }
  }

  return [...files].sort((left, right) => left.localeCompare(right));
}

function createFetchOptions(NodeGit, remoteUrl, authOptions = {}) {
  const auth = resolveGitAuth(remoteUrl, authOptions);
  const callbacks = {
    certificateCheck() {
      return 1;
    }
  };

  if (auth.token) {
    callbacks.credentials = () => NodeGit.Cred.userpassPlaintextNew(auth.username || "git", auth.token);
  } else if (isSshLikeRemoteUrl(remoteUrl) && typeof NodeGit.Cred?.sshKeyFromAgent === "function") {
    callbacks.credentials = (_url, userName) => NodeGit.Cred.sshKeyFromAgent(userName || "git");
  }

  const fetchOptions = {
    callbacks
  };

  if (NodeGit.Remote?.AUTOTAG_OPTION?.ALL !== undefined) {
    fetchOptions.downloadTags = NodeGit.Remote.AUTOTAG_OPTION.ALL;
  }

  return fetchOptions;
}

async function resolveCommitObject(repo, NodeGit, revision) {
  if (revision === "HEAD") {
    return repo.getHeadCommit();
  }

  if (revision.startsWith("refs/")) {
    return repo.getReferenceCommit(revision);
  }

  if (COMMIT_HASH_PATTERN.test(revision)) {
    if (revision.length >= 40) {
      return repo.getCommit(revision);
    }

    return NodeGit.Commit.lookupPrefix(repo, revision, revision.length);
  }

  return NodeGit.Revparse.single(repo, `${revision}^{commit}`);
}

export async function createNodeGitClient({ projectRoot }) {
  let NodeGit;
  try {
    const nodeGitModule = await import("nodegit");
    NodeGit = nodeGitModule.default || nodeGitModule;
  } catch (error) {
    return createUnavailableBackendResult("nodegit", "the optional nodegit package is not installed or not loadable");
  }

  let repo;
  try {
    repo = await NodeGit.Repository.open(projectRoot);
  } catch (error) {
    return createUnavailableBackendResult("nodegit", error.message);
  }

  const client = {
    name: "nodegit",
    label: "NodeGit backend",

    async ensureCleanTrackedFiles() {
      const statusEntries = await repo.getStatusExt();
      const statusFlags = NodeGit.Status?.STATUS || {};
      const unstagedMask =
        (statusFlags.WT_MODIFIED || 0) |
        (statusFlags.WT_DELETED || 0) |
        (statusFlags.WT_TYPECHANGE || 0) |
        (statusFlags.WT_RENAMED || 0) |
        (statusFlags.CONFLICTED || 0);
      const stagedMask =
        (statusFlags.INDEX_NEW || 0) |
        (statusFlags.INDEX_MODIFIED || 0) |
        (statusFlags.INDEX_DELETED || 0) |
        (statusFlags.INDEX_TYPECHANGE || 0) |
        (statusFlags.INDEX_RENAMED || 0) |
        (statusFlags.CONFLICTED || 0);

      let hasUnstagedChanges = false;
      let hasStagedChanges = false;

      for (const entry of statusEntries) {
        const value = readStatusValue(entry);
        if ((value & unstagedMask) !== 0) {
          hasUnstagedChanges = true;
        }
        if ((value & stagedMask) !== 0) {
          hasStagedChanges = true;
        }
      }

      if (hasUnstagedChanges) {
        throw new Error("Update refused because tracked files have unstaged changes. Commit or stash them first.");
      }

      if (hasStagedChanges) {
        throw new Error("Update refused because tracked files have staged changes. Commit, unstage, or stash them first.");
      }
    },

    async fetchRemote(remoteName, authOptions = {}) {
      const remote = await repo.getRemote(remoteName);
      const remoteUrl = readNodeGitText(remote.url?.() || remote.url);
      await repo.fetch(remoteName, createFetchOptions(NodeGit, remoteUrl, authOptions));

      let defaultBranch = null;
      if (typeof remote.defaultBranch === "function") {
        try {
          defaultBranch = normalizeBranchName(readNodeGitText(await remote.defaultBranch()));
        } catch {
          defaultBranch = null;
        }
      }

      return { defaultBranch };
    },

    async readCurrentBranch() {
      if (repo.headDetached()) {
        return null;
      }

      const reference = await repo.getCurrentBranch();
      return readReferenceName(reference);
    },

    async hasLocalBranch(branchName) {
      try {
        await repo.getReference(`refs/heads/${branchName}`);
        return true;
      } catch {
        return false;
      }
    },

    async hasRemoteBranch(remoteName, branchName) {
      try {
        await repo.getReference(`refs/remotes/${remoteName}/${branchName}`);
        return true;
      } catch {
        return false;
      }
    },

    async readConfig(path) {
      const config = await repo.config();
      try {
        const value = await config.getStringBuf(path);
        return readNodeGitText(value)?.trim() || null;
      } catch {
        return null;
      }
    },

    async writeConfig(path, value) {
      const config = await repo.config();
      if (value === undefined) {
        config.deleteEntry(path);
        return;
      }

      await config.setString(path, String(value));
    },

    async readHeadCommit() {
      const commit = await repo.getHeadCommit();
      return oidToString(commit.id());
    },

    async readShortCommit(revision = "HEAD") {
      const commit = await resolveCommitObject(repo, NodeGit, revision);
      return shortenOid(oidToString(commit.id()));
    },

    async resolveTagRevision(tagName) {
      try {
        const object = await NodeGit.Revparse.single(repo, `refs/tags/${tagName}^{commit}`);
        return oidToString(object.id());
      } catch {
        return null;
      }
    },

    async resolveCommitRevision(target) {
      if (!COMMIT_HASH_PATTERN.test(target)) {
        return null;
      }

      try {
        const commit = await resolveCommitObject(repo, NodeGit, target);
        return oidToString(commit.id());
      } catch {
        return null;
      }
    },

    async checkoutBranch(remoteName, branchName) {
      try {
        await repo.checkoutBranch(branchName, checkoutOptions(NodeGit));
        return;
      } catch {
        const remoteRefName = `refs/remotes/${remoteName}/${branchName}`;
        const remoteCommit = await repo.getReferenceCommit(remoteRefName);
        await NodeGit.Branch.create(repo, branchName, remoteCommit, 0);

        const localReference = await repo.getBranch(branchName);
        if (typeof NodeGit.Branch?.setUpstream === "function") {
          await NodeGit.Branch.setUpstream(localReference, `${remoteName}/${branchName}`);
        }

        await repo.checkoutBranch(localReference, checkoutOptions(NodeGit));
      }
    },

    async fastForward(remoteName, branchName) {
      const localCommit = await repo.getReferenceCommit(`refs/heads/${branchName}`);
      const remoteCommit = await repo.getReferenceCommit(`refs/remotes/${remoteName}/${branchName}`);
      const canFastForward = await NodeGit.Graph.descendantOf(repo, remoteCommit.id(), localCommit.id());

      if (!canFastForward) {
        throw new Error(`Could not fast-forward ${branchName} to ${remoteName}/${branchName}.`);
      }

      await NodeGit.Reference.create(
        repo,
        `refs/heads/${branchName}`,
        remoteCommit.id(),
        1,
        `space update fast-forward ${branchName}`
      );

      await repo.checkoutBranch(branchName, checkoutOptions(NodeGit));
    },

    async hardReset(revision) {
      const commit = await resolveCommitObject(repo, NodeGit, revision);
      await NodeGit.Reset.reset(repo, commit, NodeGit.Reset.TYPE.HARD);
    },

    async checkoutDetached(revision) {
      const commit = await resolveCommitObject(repo, NodeGit, revision);
      repo.setHeadDetached(commit.id());
      await NodeGit.Checkout.tree(repo, commit, checkoutOptions(NodeGit));
    }
  };

  return createAvailableBackendResult("nodegit", client);
}

export async function createNodeGitCloneClient() {
  let NodeGit;
  try {
    const nodeGitModule = await import("nodegit");
    NodeGit = nodeGitModule.default || nodeGitModule;
  } catch {
    return createUnavailableBackendResult("nodegit", "the optional nodegit package is not installed or not loadable");
  }

  const client = {
    name: "nodegit",
    label: "NodeGit backend",

    async cloneRepository({ authOptions = {}, remoteUrl, targetDir }) {
      await NodeGit.Clone.clone(sanitizeRemoteUrl(remoteUrl), targetDir, {
        fetchOpts: createFetchOptions(NodeGit, remoteUrl, authOptions)
      });
    }
  };

  return createAvailableBackendResult("nodegit", client);
}

export async function createNodeGitHistoryClient({ repoRoot }) {
  let NodeGit;
  try {
    const nodeGitModule = await import("nodegit");
    NodeGit = nodeGitModule.default || nodeGitModule;
  } catch {
    return createUnavailableBackendResult("nodegit", "the optional nodegit package is not installed or not loadable");
  }

  const resolvedRepoRoot = path.resolve(String(repoRoot || ""));
  let repo;

  try {
    repo = await openOrInitNodeGitRepository(NodeGit, resolvedRepoRoot);
  } catch (error) {
    return createUnavailableBackendResult("nodegit", error.message);
  }

  const client = {
    name: "nodegit",
    label: "NodeGit backend",

    async ensureRepository() {
      repo = await openOrInitNodeGitRepository(NodeGit, resolvedRepoRoot);
    },

    async commitAll(options = {}) {
      await this.ensureRepository();

      const ignoredPaths = [...normalizeHistoryIgnoredPaths(options.ignoredPaths)];
      const { changedFiles: stagedFiles, treeOid } = await stageNodeGitStatusEntries(repo, NodeGit, ignoredPaths);
      const changedFiles = filterHistoryChangedFiles(stagedFiles, ignoredPaths);
      const parentCommit = await tryReadNodeGitHeadCommit(repo);
      const parentTreeId = parentCommit && typeof parentCommit.treeId === "function"
        ? oidToString(parentCommit.treeId())
        : "";

      if (stagedFiles.length === 0 || (parentTreeId && parentTreeId === oidToString(treeOid))) {
        return {
          backend: this.name,
          changedFiles: [],
          committed: false,
          hash: "",
          shortHash: ""
        };
      }

      const author = NodeGit.Signature.now(
        String(options.authorName || "Space Agent"),
        String(options.authorEmail || "space-agent@local")
      );
      const hash = oidToString(
        await repo.createCommit(
          "HEAD",
          author,
          author,
          String(options.message || "Update customware history"),
          treeOid,
          parentCommit ? [parentCommit] : []
        )
      );

      return {
        backend: this.name,
        changedFiles,
        committed: true,
        hash,
        shortHash: shortenOid(hash)
      };
    },

    async listCommits(options = {}) {
      await this.ensureRepository();

      const headCommit = await tryReadNodeGitHeadCommit(repo);
      if (!headCommit) {
        return {
          commits: [],
          currentHash: "",
          hasMore: false,
          limit: Math.max(1, Math.min(500, Number(options.limit) || 50)),
          offset: Math.max(0, Number(options.offset) || 0),
          total: 0
        };
      }

      const limit = Math.max(1, Math.min(500, Number(options.limit) || 50));
      const offset = Math.max(0, Number(options.offset) || 0);
      const revWalk = repo.createRevWalk();
      revWalk.pushHead();
      if (NodeGit.Revwalk?.SORT?.TIME !== undefined) {
        revWalk.sorting(NodeGit.Revwalk.SORT.TIME);
      }

      const commits = await revWalk.getCommits(limit + offset + 1);
      const pageCommits = commits.slice(offset, offset + limit + 1);
      const fileFilter = String(options.fileFilter || "").trim().toLowerCase();

      const entries = await Promise.all(
        pageCommits.map(async (commit) => {
          const hash = oidToString(commit.id());
          const files = filterHistoryFileEntries(
            await readNodeGitCommitChangedFiles(commit),
            options.ignoredPaths
          );

          return {
            changedFiles: getHistoryChangedFilePaths(files),
            files,
            hash,
            message: readNodeGitCommitMessage(commit),
            shortHash: shortenOid(hash),
            timestamp: readNodeGitCommitTimestamp(commit)
          };
        })
      );
      const filteredEntries = fileFilter
        ? entries.filter((entry) => entry.changedFiles.some((filePath) => filePath.toLowerCase().includes(fileFilter)))
        : entries;

      return {
        commits: filteredEntries.slice(0, limit),
        currentHash: oidToString(headCommit.id()),
        hasMore: filteredEntries.length > limit || commits.length > offset + limit,
        limit,
        offset,
        total: null
      };
    },

    async getCommitDiff() {
      throw new Error("Commit file diffs require the native Git history backend.");
    },

    async previewOperation() {
      throw new Error("Operation previews require the native Git history backend.");
    },

    async rollbackToCommit(options = {}) {
      await this.ensureRepository();
      const commit = await resolveCommitObject(repo, NodeGit, String(options.commitHash || ""));
      await NodeGit.Reset.reset(repo, commit, NodeGit.Reset.TYPE.HARD);
      const hash = oidToString(commit.id());

      return {
        backend: this.name,
        hash,
        shortHash: shortenOid(hash)
      };
    },

    async revertCommit() {
      throw new Error("Commit revert requires the native Git history backend.");
    }
  };

  return createAvailableBackendResult("nodegit", client);
}
