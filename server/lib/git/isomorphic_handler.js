import path from "node:path";

import {
  COMMIT_HASH_PATTERN,
  buildHttpAuthOptions,
  createAvailableBackendResult,
  createUnavailableBackendResult,
  filterHistoryChangedFiles,
  filterHistoryFileEntries,
  fs,
  getHistoryChangedFilePaths,
  isHistoryIgnoredPath,
  normalizeBranchName,
  normalizeHistoryIgnoredPaths,
  normalizeRemoteUrl,
  sanitizeRemoteUrl,
  shortenOid
} from "./shared.js";

async function resolveIsomorphicModules() {
  try {
    const gitModule = await import("isomorphic-git");
    const httpModule = await import("isomorphic-git/http/node");

    return {
      git: gitModule.default || gitModule,
      http: httpModule.default || httpModule
    };
  } catch (error) {
    throw new Error(error.message);
  }
}

function createRepoOptions(gitContext) {
  return {
    fs,
    dir: gitContext.dir,
    gitdir: gitContext.gitdir
  };
}

function createTargetRepoOptions(targetDir) {
  return {
    fs,
    dir: targetDir,
    gitdir: path.join(targetDir, ".git")
  };
}

function createHistoryRepoOptions(repoRoot) {
  return {
    fs,
    dir: repoRoot,
    gitdir: path.join(repoRoot, ".git")
  };
}

function isInternalGitPath(filePath) {
  return String(filePath || "").split(/[\\/]+/u).includes(".git");
}

function normalizeFetchedDefaultBranch(defaultBranch) {
  return normalizeBranchName(defaultBranch);
}

function isUnstagedMatrixRow([, head, workdir, stage]) {
  if (head === 0 && stage === 0) {
    return false;
  }

  return workdir !== stage;
}

function isStagedMatrixRow([, head, , stage]) {
  return !(head === stage || (head === 0 && stage === 0));
}

async function ensureIsomorphicRepository(git, repoRoot, repoOptions) {
  await fs.promises.mkdir(repoRoot, { recursive: true });

  if (!fs.existsSync(repoOptions.gitdir)) {
    await git.init({
      ...repoOptions,
      defaultBranch: "main"
    });
  }
}

async function stageIsomorphicHistoryChanges(git, repoOptions, ignoredPaths = []) {
  const statusRows = await git.statusMatrix(repoOptions);
  const ignoredPathSet = normalizeHistoryIgnoredPaths(ignoredPaths);
  const stagedFiles = [];

  for (const ignoredPath of ignoredPathSet) {
    try {
      await git.remove({
        ...repoOptions,
        filepath: ignoredPath
      });
    } catch {
      // Already untracked or absent. Future status handling skips ignored paths.
    }
  }

  for (const [filepath, , workdir] of statusRows) {
    if (!filepath || isInternalGitPath(filepath) || isHistoryIgnoredPath(filepath, ignoredPathSet)) {
      continue;
    }

    if (workdir === 0) {
      await git.remove({
        ...repoOptions,
        filepath
      });
    } else {
      await git.add({
        ...repoOptions,
        filepath
      });
    }
  }

  const stagedRows = await git.statusMatrix(repoOptions);

  for (const [filepath, head, , stage] of stagedRows) {
    if (!filepath || isInternalGitPath(filepath)) {
      continue;
    }

    if (isHistoryIgnoredPath(filepath, ignoredPathSet)) {
      if (!(head === stage || (head === 0 && stage === 0))) {
        stagedFiles.push(filepath);
      }
      continue;
    }

    if (!(head === stage || (head === 0 && stage === 0))) {
      stagedFiles.push(filepath);
    }
  }

  return [...new Set(stagedFiles)].sort((left, right) => left.localeCompare(right));
}

async function tryReadIsomorphicBlobOid(git, repoOptions, ref, filepath) {
  try {
    const result = await git.readBlob({
      ...repoOptions,
      filepath,
      oid: ref
    });

    return result.oid || Buffer.from(result.blob || "").toString("base64");
  } catch {
    return null;
  }
}

async function readIsomorphicCommitChangedFiles(git, repoOptions, commitEntry) {
  const parentOid = commitEntry.commit.parent?.[0] || "";
  const currentFiles = await git.listFiles({
    ...repoOptions,
    ref: commitEntry.oid
  });
  const parentFiles = parentOid
    ? await git.listFiles({
        ...repoOptions,
        ref: parentOid
      }).catch(() => [])
    : [];
  const allFiles = [...new Set([...currentFiles, ...parentFiles])]
    .filter((filepath) => filepath && !isInternalGitPath(filepath))
    .sort((left, right) => left.localeCompare(right));
  const changedFiles = [];

  for (const filepath of allFiles) {
    const currentOid = await tryReadIsomorphicBlobOid(git, repoOptions, commitEntry.oid, filepath);
    const parentBlobOid = parentOid
      ? await tryReadIsomorphicBlobOid(git, repoOptions, parentOid, filepath)
      : null;

    if (currentOid !== parentBlobOid) {
      changedFiles.push(filepath);
    }
  }

  return changedFiles;
}

export async function createIsomorphicGitClient({ gitContext }) {
  let modules;
  try {
    modules = await resolveIsomorphicModules();
  } catch (error) {
    return createUnavailableBackendResult("isomorphic", error.message);
  }

  const { git, http } = modules;
  const repoOptions = createRepoOptions(gitContext);

  async function resolveRemoteTransport(remoteName, authOptions = {}) {
    const remoteUrl = await git.getConfig({
      ...repoOptions,
      path: `remote.${remoteName}.url`
    });

    if (!remoteUrl) {
      throw new Error(`Git remote ${remoteName} is not configured.`);
    }

    const transportUrl = normalizeRemoteUrl(remoteUrl);
    return {
      remoteUrl,
      transportUrl,
      ...buildHttpAuthOptions(remoteUrl, authOptions)
    };
  }

  const client = {
    name: "isomorphic",
    label: "isomorphic-git backend",

    async ensureCleanTrackedFiles() {
      const statusRows = await git.statusMatrix({
        ...repoOptions
      });

      if (statusRows.some(isUnstagedMatrixRow)) {
        throw new Error("Update refused because tracked files have unstaged changes. Commit or stash them first.");
      }

      if (statusRows.some(isStagedMatrixRow)) {
        throw new Error("Update refused because tracked files have staged changes. Commit, unstage, or stash them first.");
      }
    },

    async fetchRemote(remoteName, authOptions = {}) {
      const transport = await resolveRemoteTransport(remoteName, authOptions);
      const result = await git.fetch({
        ...repoOptions,
        http,
        remote: remoteName,
        url: transport.transportUrl,
        tags: true,
        ...(transport.onAuth ? { onAuth: transport.onAuth } : {})
      });

      return {
        defaultBranch: normalizeFetchedDefaultBranch(result.defaultBranch)
      };
    },

    async readCurrentBranch() {
      return (await git.currentBranch({
        ...repoOptions,
        test: true
      })) || null;
    },

    async hasLocalBranch(branchName) {
      const branches = await git.listBranches(repoOptions);
      return branches.includes(branchName);
    },

    async hasRemoteBranch(remoteName, branchName) {
      const branches = await git.listBranches({
        ...repoOptions,
        remote: remoteName
      });

      return branches.includes(branchName);
    },

    async readConfig(path) {
      const value = await git.getConfig({
        ...repoOptions,
        path
      });

      return value == null ? null : String(value).trim() || null;
    },

    async writeConfig(path, value) {
      await git.setConfig({
        ...repoOptions,
        path,
        value
      });
    },

    async readHeadCommit() {
      return git.resolveRef({
        ...repoOptions,
        ref: "HEAD"
      });
    },

    async readShortCommit(revision = "HEAD") {
      let oid = revision;

      if (!COMMIT_HASH_PATTERN.test(revision) || revision.length < 40) {
        oid = await git.resolveRef({
          ...repoOptions,
          ref: revision
        });
      } else {
        oid = await git.expandOid({
          ...repoOptions,
          oid: revision
        });
      }

      return shortenOid(oid);
    },

    async resolveTagRevision(tagName) {
      try {
        const tagOid = await git.resolveRef({
          ...repoOptions,
          ref: `refs/tags/${tagName}`
        });
        const { oid } = await git.readCommit({
          ...repoOptions,
          oid: tagOid
        });

        return oid;
      } catch {
        return null;
      }
    },

    async resolveCommitRevision(target) {
      if (!COMMIT_HASH_PATTERN.test(target)) {
        return null;
      }

      try {
        const oid = await git.expandOid({
          ...repoOptions,
          oid: target
        });

        await git.readCommit({
          ...repoOptions,
          oid
        });

        return oid;
      } catch {
        return null;
      }
    },

    async checkoutBranch(remoteName, branchName) {
      await git.checkout({
        ...repoOptions,
        remote: remoteName,
        ref: branchName,
        force: true,
        track: true
      });
    },

    async fastForward(remoteName, branchName) {
      const localRef = `refs/heads/${branchName}`;
      const remoteRef = `refs/remotes/${remoteName}/${branchName}`;
      const localOid = await git.resolveRef({
        ...repoOptions,
        ref: localRef
      });
      const remoteOid = await git.resolveRef({
        ...repoOptions,
        ref: remoteRef
      });

      if (localOid === remoteOid) {
        return;
      }

      const canFastForward = await git.isDescendent({
        ...repoOptions,
        oid: remoteOid,
        ancestor: localOid
      });

      if (!canFastForward) {
        throw new Error(`Could not fast-forward ${branchName} to ${remoteName}/${branchName}.`);
      }

      await git.writeRef({
        ...repoOptions,
        ref: localRef,
        value: remoteOid,
        force: true
      });

      await git.checkout({
        ...repoOptions,
        ref: branchName,
        force: true
      });
    },

    async hardReset(revision) {
      const currentBranch = await git.currentBranch({
        ...repoOptions,
        test: true
      });

      if (currentBranch) {
        await git.writeRef({
          ...repoOptions,
          ref: `refs/heads/${currentBranch}`,
          value: revision,
          force: true
        });

        await git.checkout({
          ...repoOptions,
          ref: currentBranch,
          force: true
        });
        return;
      }

      await git.writeRef({
        ...repoOptions,
        ref: "HEAD",
        value: revision,
        force: true,
        symbolic: false
      });

      await git.checkout({
        ...repoOptions,
        force: true
      });
    },

    async checkoutDetached(revision) {
      await git.writeRef({
        ...repoOptions,
        ref: "HEAD",
        value: revision,
        force: true,
        symbolic: false
      });

      await git.checkout({
        ...repoOptions,
        force: true
      });
    }
  };

  return createAvailableBackendResult("isomorphic", client);
}

export async function createIsomorphicGitCloneClient() {
  let modules;
  try {
    modules = await resolveIsomorphicModules();
  } catch (error) {
    return createUnavailableBackendResult("isomorphic", error.message);
  }

  const { git, http } = modules;
  const client = {
    name: "isomorphic",
    label: "isomorphic-git backend",

    async cloneRepository({ authOptions = {}, remoteUrl, targetDir }) {
      const repoOptions = createTargetRepoOptions(targetDir);
      const transportUrl = normalizeRemoteUrl(remoteUrl);
      const auth = buildHttpAuthOptions(remoteUrl, authOptions);

      await fs.promises.mkdir(targetDir, { recursive: true });
      await git.clone({
        ...repoOptions,
        http,
        remote: "origin",
        url: transportUrl,
        ...(auth.onAuth ? { onAuth: auth.onAuth } : {})
      });

      await git.setConfig({
        ...repoOptions,
        path: "remote.origin.url",
        value: sanitizeRemoteUrl(remoteUrl)
      });
    }
  };

  return createAvailableBackendResult("isomorphic", client);
}

export async function createIsomorphicGitHistoryClient({ repoRoot }) {
  let modules;
  try {
    modules = await resolveIsomorphicModules();
  } catch (error) {
    return createUnavailableBackendResult("isomorphic", error.message);
  }

  const { git } = modules;
  const resolvedRepoRoot = path.resolve(String(repoRoot || ""));
  const repoOptions = createHistoryRepoOptions(resolvedRepoRoot);

  try {
    await ensureIsomorphicRepository(git, resolvedRepoRoot, repoOptions);
  } catch (error) {
    return createUnavailableBackendResult("isomorphic", error.message);
  }

  const client = {
    name: "isomorphic",
    label: "isomorphic-git backend",

    async ensureRepository() {
      await ensureIsomorphicRepository(git, resolvedRepoRoot, repoOptions);
    },

    async commitAll(options = {}) {
      await this.ensureRepository();

      const ignoredPaths = [...normalizeHistoryIgnoredPaths(options.ignoredPaths)];
      const stagedFiles = await stageIsomorphicHistoryChanges(git, repoOptions, ignoredPaths);
      const changedFiles = filterHistoryChangedFiles(stagedFiles, ignoredPaths);
      if (stagedFiles.length === 0) {
        return {
          backend: this.name,
          changedFiles: [],
          committed: false,
          hash: "",
          shortHash: ""
        };
      }

      const hash = await git.commit({
        ...repoOptions,
        author: {
          email: String(options.authorEmail || "space-agent@local"),
          name: String(options.authorName || "Space Agent")
        },
        committer: {
          email: String(options.authorEmail || "space-agent@local"),
          name: String(options.authorName || "Space Agent")
        },
        message: String(options.message || "Update customware history")
      });

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

      const limit = Math.max(1, Math.min(500, Number(options.limit) || 50));
      const offset = Math.max(0, Number(options.offset) || 0);
      let entries;

      try {
        entries = await git.log({
          ...repoOptions,
          depth: limit + offset + 1
        });
      } catch {
        return {
          commits: [],
          currentHash: "",
          hasMore: false,
          limit,
          offset,
          total: 0
        };
      }
      const fileFilter = String(options.fileFilter || "").trim().toLowerCase();

      const commits = await Promise.all(
        entries.slice(offset, offset + limit + 1).map(async (entry) => {
          const files = filterHistoryFileEntries(
            await readIsomorphicCommitChangedFiles(git, repoOptions, entry),
            options.ignoredPaths
          );

          return {
            changedFiles: getHistoryChangedFilePaths(files),
            files,
            hash: entry.oid,
            message: String(entry.commit.message || "").split("\n")[0],
            shortHash: shortenOid(entry.oid),
            timestamp: entry.commit.committer?.timestamp
              ? new Date(entry.commit.committer.timestamp * 1000).toISOString()
              : ""
          };
        })
      );
      const filteredCommits = fileFilter
        ? commits.filter((entry) => entry.changedFiles.some((filePath) => filePath.toLowerCase().includes(fileFilter)))
        : commits;

      return {
        commits: filteredCommits.slice(0, limit),
        currentHash: entries[0]?.oid || "",
        hasMore: filteredCommits.length > limit || entries.length > offset + limit,
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

      const hash = await git.expandOid({
        ...repoOptions,
        oid: String(options.commitHash || "")
      });

      await git.readCommit({
        ...repoOptions,
        oid: hash
      });

      const currentBranch = await git.currentBranch({
        ...repoOptions,
        test: true
      });

      if (currentBranch) {
        await git.writeRef({
          ...repoOptions,
          force: true,
          ref: `refs/heads/${currentBranch}`,
          value: hash
        });

        await git.checkout({
          ...repoOptions,
          force: true,
          ref: currentBranch
        });
      } else {
        await git.writeRef({
          ...repoOptions,
          force: true,
          ref: "HEAD",
          symbolic: false,
          value: hash
        });

        await git.checkout({
          ...repoOptions,
          force: true
        });
      }

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

  return createAvailableBackendResult("isomorphic", client);
}
