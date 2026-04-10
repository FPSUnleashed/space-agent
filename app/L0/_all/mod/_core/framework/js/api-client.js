/**
 * @typedef {string | number | boolean | null | undefined | Array<string | number | boolean>} ApiQueryValue
 */

/**
 * @typedef {{
 *   method?: string,
 *   query?: Record<string, ApiQueryValue>,
 *   body?: unknown,
 *   headers?: Record<string, string>,
 *   signal?: AbortSignal
 * }} ApiCallOptions
 */

/**
 * @typedef {{
 *   path: string,
 *   content?: string,
 *   encoding?: string,
 *   bytesWritten?: number
 * }} FileApiEntry
 */

/**
 * @typedef {{
 *   endpoint?: string,
 *   recursive?: boolean,
 *   paths?: string[],
 *   path: string,
 *   content?: string,
 *   encoding?: string,
 *   bytesWritten?: number
 * }} FileApiResult
 */

/**
 * @typedef {{
 *   count: number,
 *   files: FileApiEntry[],
 *   bytesWritten?: number
 * }} FileBatchApiResult
 */

/**
 * @typedef {{
 *   path: string,
 *   isDirectory: boolean,
 *   modifiedAt: string,
 *   size: number
 * }} FileInfoApiResult
 */

/**
 * @typedef {{
 *   access?: "read" | "write",
 *   gitRepositories?: boolean,
 *   path?: string,
 *   recursive?: boolean,
 *   writableOnly?: boolean
 * }} FileListOptions
 */

/**
 * @typedef {{
 *   count: number,
 *   paths: string[]
 * }} PathBatchApiResult
 */

/**
 * @typedef {{ fromPath: string, toPath: string }} FileTransferInput
 */

/**
 * @typedef {{ entries: FileTransferInput[] }} FileTransferBatchOptions
 */

/**
 * @typedef {{
 *   count: number,
 *   entries: FileTransferInput[]
 * }} FileTransferBatchApiResult
 */

/**
 * @typedef {{
 *   action?: string,
 *   oldPath?: string,
 *   path: string,
 *   status?: string
 * }} GitHistoryFile
 */

/**
 * @typedef {{
 *   hash: string,
 *   shortHash: string,
 *   timestamp: string,
 *   message: string,
 *   changedFiles: string[],
 *   files?: GitHistoryFile[]
 * }} GitHistoryCommit
 */

/**
 * @typedef {{
 *   enabled: boolean,
 *   backend: string,
 *   path: string,
 *   commits: GitHistoryCommit[],
 *   currentHash?: string,
 *   hasMore?: boolean,
 *   limit?: number,
 *   offset?: number,
 *   total?: number | null
 * }} GitHistoryListResult
 */

/**
 * @typedef {{
 *   backend: string,
 *   hash: string,
 *   shortHash: string,
 *   path: string
 * }} GitHistoryRollbackResult
 */

/**
 * @typedef {{
 *   backend: string,
 *   file: GitHistoryFile,
 *   hash: string,
 *   patch: string,
 *   path: string,
 *   shortHash: string
 * }} GitHistoryDiffResult
 */

/**
 * @typedef {{
 *   backend: string,
 *   hash: string,
 *   path: string,
 *   revertedHash: string,
 *   shortHash: string
 * }} GitHistoryRevertResult
 */

/**
 * @typedef {string | { path: string, encoding?: string }} FileReadInput
 */

/**
 * @typedef {{ files: FileReadInput[], encoding?: string }} FileReadBatchOptions
 */

/**
 * @typedef {{ path: string, content?: string, encoding?: string }} FileWriteInput
 */

/**
 * @typedef {{ files: FileWriteInput[], encoding?: string }} FileWriteBatchOptions
 */

/**
 * @typedef {string | { path: string }} FileDeleteInput
 */

/**
 * @typedef {{ paths: FileDeleteInput[] }} FileDeleteBatchOptions
 */

/**
 * @typedef {{
 *   fullName: string,
 *   groups: string[],
 *   managedGroups: string[],
 *   username: string
 * }} UserSelfInfoResult
 */

function appendQueryValue(searchParams, key, value) {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => appendQueryValue(searchParams, key, item));
    return;
  }

  searchParams.append(key, String(value));
}

function buildApiUrl(basePath, endpointName, query) {
  const url = new URL(`${basePath.replace(/\/$/, "")}/${endpointName}`, window.location.origin);

  Object.entries(query || {}).forEach(([key, value]) => {
    appendQueryValue(url.searchParams, key, value);
  });

  return url;
}

async function parseApiResponse(response) {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  if (contentType.startsWith("text/") || contentType.includes("xml")) {
    return response.text();
  }

  return response.blob();
}

async function createApiError(endpointName, response) {
  let detail = response.statusText || "Request failed";

  try {
    const payload = await parseApiResponse(response);

    if (payload && typeof payload === "object" && "error" in payload) {
      detail =
        typeof payload.error === "string"
          ? payload.error
          : JSON.stringify(payload.error, null, 2);
    } else if (typeof payload === "string" && payload.trim()) {
      detail = payload;
    }
  } catch (error) {
    detail = response.statusText || "Request failed";
  }

  return new Error(`API ${endpointName} failed with status ${response.status}: ${detail}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createFileReadRequest(pathOrFiles, encoding) {
  if (Array.isArray(pathOrFiles)) {
    return {
      method: "POST",
      body: {
        encoding,
        files: pathOrFiles
      }
    };
  }

  if (isPlainObject(pathOrFiles) && Array.isArray(pathOrFiles.files)) {
    return {
      method: "POST",
      body: {
        encoding: pathOrFiles.encoding ?? encoding,
        files: pathOrFiles.files
      }
    };
  }

  if (isPlainObject(pathOrFiles) && typeof pathOrFiles.path === "string") {
    return {
      method: "POST",
      body: {
        encoding: pathOrFiles.encoding ?? encoding,
        path: pathOrFiles.path
      }
    };
  }

  return {
    method: "GET",
    query: {
      encoding,
      path: pathOrFiles
    }
  };
}

function createFileWriteRequest(pathOrFiles, content, encoding) {
  if (Array.isArray(pathOrFiles)) {
    return {
      method: "POST",
      body: {
        encoding,
        files: pathOrFiles
      }
    };
  }

  if (isPlainObject(pathOrFiles) && Array.isArray(pathOrFiles.files)) {
    return {
      method: "POST",
      body: {
        encoding: pathOrFiles.encoding ?? encoding,
        files: pathOrFiles.files
      }
    };
  }

  if (isPlainObject(pathOrFiles) && typeof pathOrFiles.path === "string") {
    return {
      method: "POST",
      body: {
        content: pathOrFiles.content,
        encoding: pathOrFiles.encoding ?? encoding,
        path: pathOrFiles.path
      }
    };
  }

  return {
    method: "POST",
    body: {
      content,
      encoding,
      path: pathOrFiles
    }
  };
}

function createFileDeleteRequest(pathOrPaths) {
  if (Array.isArray(pathOrPaths)) {
    return {
      method: "POST",
      body: {
        paths: pathOrPaths
      }
    };
  }

  if (isPlainObject(pathOrPaths) && Array.isArray(pathOrPaths.paths)) {
    return {
      method: "POST",
      body: {
        paths: pathOrPaths.paths
      }
    };
  }

  if (isPlainObject(pathOrPaths) && typeof pathOrPaths.path === "string") {
    return {
      method: "POST",
      body: {
        path: pathOrPaths.path
      }
    };
  }

  return {
    method: "POST",
    body: {
      path: pathOrPaths
    }
  };
}

function createFileTransferRequest(pathOrEntries, toPath) {
  if (Array.isArray(pathOrEntries)) {
    return {
      method: "POST",
      body: {
        entries: pathOrEntries
      }
    };
  }

  if (isPlainObject(pathOrEntries) && Array.isArray(pathOrEntries.entries)) {
    return {
      method: "POST",
      body: {
        entries: pathOrEntries.entries
      }
    };
  }

  if (
    isPlainObject(pathOrEntries) &&
    typeof pathOrEntries.fromPath === "string" &&
    typeof pathOrEntries.toPath === "string"
  ) {
    return {
      method: "POST",
      body: {
        fromPath: pathOrEntries.fromPath,
        toPath: pathOrEntries.toPath
      }
    };
  }

  return {
    method: "POST",
    body: {
      fromPath: pathOrEntries,
      toPath
    }
  };
}

function createFileInfoRequest(pathOrOptions) {
  if (isPlainObject(pathOrOptions) && typeof pathOrOptions.path === "string") {
    return {
      method: "POST",
      body: {
        path: pathOrOptions.path
      }
    };
  }

  return {
    method: "GET",
    query: {
      path: pathOrOptions
    }
  };
}

function createFileListRequest(pathOrOptions, recursive = false) {
  const input = isPlainObject(pathOrOptions)
    ? pathOrOptions
    : {
        path: pathOrOptions,
        recursive
      };
  const request = {
    path: input.path,
    recursive: input.recursive ?? recursive
  };

  if (input.access !== undefined) {
    request.access = input.access;
  }

  if (input.gitRepositories !== undefined) {
    request.gitRepositories = Boolean(input.gitRepositories);
  }

  if (input.writableOnly !== undefined) {
    request.writableOnly = Boolean(input.writableOnly);
  }

  return request;
}

function createFolderDownloadQuery(pathOrOptions) {
  if (isPlainObject(pathOrOptions) && typeof pathOrOptions.path === "string") {
    return {
      path: pathOrOptions.path
    };
  }

  return {
    path: pathOrOptions
  };
}

function createGitHistoryListRequest(pathOrOptions, limit) {
  if (isPlainObject(pathOrOptions)) {
    return {
      method: "POST",
      body: {
        fileFilter: pathOrOptions.fileFilter ?? pathOrOptions.filter ?? "",
        limit: pathOrOptions.limit ?? limit,
        offset: pathOrOptions.offset ?? 0,
        path: pathOrOptions.path ?? "~"
      }
    };
  }

  return {
    method: "GET",
    query: {
      fileFilter: "",
      limit,
      offset: 0,
      path: pathOrOptions || "~"
    }
  };
}

function createGitHistoryRollbackRequest(pathOrOptions, commitHash) {
  if (isPlainObject(pathOrOptions)) {
    return {
      method: "POST",
      body: {
        commitHash: pathOrOptions.commitHash || pathOrOptions.commit || pathOrOptions.hash,
        path: pathOrOptions.path || "~"
      }
    };
  }

  return {
    method: "POST",
    body: {
      commitHash,
      path: pathOrOptions || "~"
    }
  };
}

function createGitHistoryDiffRequest(pathOrOptions, commitHash, filePath) {
  if (isPlainObject(pathOrOptions)) {
    return {
      method: "POST",
      body: {
        commitHash: pathOrOptions.commitHash || pathOrOptions.commit || pathOrOptions.hash,
        filePath: pathOrOptions.filePath || pathOrOptions.file || pathOrOptions.pathWithinCommit,
        path: pathOrOptions.path || "~"
      }
    };
  }

  return {
    method: "POST",
    body: {
      commitHash,
      filePath,
      path: pathOrOptions || "~"
    }
  };
}

function createGitHistoryPreviewRequest(pathOrOptions, commitHash, operation = "travel", filePath = "") {
  if (isPlainObject(pathOrOptions)) {
    return {
      method: "POST",
      body: {
        commitHash: pathOrOptions.commitHash || pathOrOptions.commit || pathOrOptions.hash,
        filePath: pathOrOptions.filePath || pathOrOptions.file || pathOrOptions.pathWithinCommit,
        operation: pathOrOptions.operation || operation,
        path: pathOrOptions.path || "~"
      }
    };
  }

  return {
    method: "POST",
    body: {
      commitHash,
      filePath,
      operation,
      path: pathOrOptions || "~"
    }
  };
}

export function createApiClient(options = {}) {
  const basePath = options.basePath || "/api";

  /**
   * Universal server API caller for `/api/<endpoint>` modules.
   *
   * @template T
   * @param {string} endpointName
   * @param {ApiCallOptions} [callOptions]
   * @returns {Promise<T>}
   */
  async function call(endpointName, callOptions = {}) {
    const method = String(callOptions.method || "GET").toUpperCase();
    const url = buildApiUrl(basePath, endpointName, callOptions.query);
    const headers = new Headers(callOptions.headers || {});
    const init = {
      method,
      headers,
      signal: callOptions.signal
    };

    if (!["GET", "HEAD"].includes(method) && callOptions.body !== undefined) {
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const contentType = headers.get("Content-Type") || "";
      init.body =
        contentType.includes("application/json") && typeof callOptions.body !== "string"
          ? JSON.stringify(callOptions.body)
          : callOptions.body;
    }

    let response;

    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new Error(`API ${endpointName} request failed: ${error.message}`);
    }

    if (!response.ok) {
      throw await createApiError(endpointName, response);
    }

    return /** @type {Promise<T>} */ (parseApiResponse(response));
  }

  /**
   * @returns {Promise<{ ok: boolean, name: string, browserAppUrl: string, responsibilities: string[] }>}
   */
  async function health() {
    return call("health");
  }

  /**
   * Read an authenticated app file.
   * `fileRead()` accepts app-rooted paths such as `L2/alice/note.txt` and the
   * `~` or `~/...` shorthand for the current user's `L2/<username>/...` path.
   * It also accepts composed batch input through a `files` array.
   *
   * @param {string | FileReadInput[] | FileReadBatchOptions | FileReadInput} pathOrFiles
   * @param {string} [encoding]
   * @returns {Promise<FileApiResult | FileBatchApiResult>}
   */
  async function fileRead(pathOrFiles, encoding = "utf8") {
    return call("file_read", createFileReadRequest(pathOrFiles, encoding));
  }

  /**
   * Write an authenticated app file.
   * `fileWrite()` accepts app-rooted paths such as `L2/alice/note.txt` and the
   * `~` or `~/...` shorthand for the current user's `L2/<username>/...` path.
   * Paths that end with `/` create directories instead of writing files.
   * It also accepts composed batch input through a `files` array.
   *
   * @param {string | FileWriteInput[] | FileWriteBatchOptions | FileWriteInput} pathOrFiles
   * @param {string} [content]
   * @param {string} [encoding]
   * @returns {Promise<FileApiResult | FileBatchApiResult>}
   */
  async function fileWrite(pathOrFiles, content, encoding = "utf8") {
    return call("file_write", createFileWriteRequest(pathOrFiles, content, encoding));
  }

  /**
   * Delete authenticated app paths.
   * `fileDelete()` accepts app-rooted paths such as `L2/alice/note.txt`,
   * `L2/alice/old-folder/`, and the `~` or `~/...` shorthand for the current
   * user's `L2/<username>/...` path. Directory deletes are recursive.
   *
   * @param {string | FileDeleteInput[] | FileDeleteBatchOptions | FileDeleteInput} pathOrPaths
   * @returns {Promise<FileApiResult | PathBatchApiResult>}
   */
  async function fileDelete(pathOrPaths) {
    return call("file_delete", createFileDeleteRequest(pathOrPaths));
  }

  /**
   * Return metadata for an authenticated app file or folder.
   * `fileInfo()` accepts app-rooted paths such as `L2/alice/note.txt` and the
   * `~` or `~/...` shorthand for the current user's `L2/<username>/...` path.
   *
   * @param {string | { path: string }} pathOrOptions
   * @returns {Promise<FileInfoApiResult>}
   */
  async function fileInfo(pathOrOptions) {
    return call("file_info", createFileInfoRequest(pathOrOptions));
  }

  /**
   * Copy authenticated app files or folders.
   * `fileCopy()` accepts app-rooted paths such as `L2/alice/note.txt`,
   * directory paths that end with `/`, and the `~` or `~/...` shorthand for
   * the current user's `L2/<username>/...` path. The destination path must be
   * explicit and writable, and batch copies accept composed `entries` input.
   *
   * @param {string | FileTransferInput[] | FileTransferBatchOptions | FileTransferInput} pathOrEntries
   * @param {string} [toPath]
   * @returns {Promise<FileTransferInput | FileTransferBatchApiResult>}
   */
  async function fileCopy(pathOrEntries, toPath) {
    return call("file_copy", createFileTransferRequest(pathOrEntries, toPath));
  }

  /**
   * List authenticated app paths.
   * `fileList()` accepts app-rooted paths such as `L2/alice/` and the
   * `~` or `~/...` shorthand for the current user's `L2/<username>/...` path.
   * Pass `{ access: "write" }` to list only writable paths, and
   * `{ gitRepositories: true, access: "write" }` to list writable local-history
   * repository owner roots without exposing their `.git` metadata.
   *
   * @param {string | FileListOptions} path
   * @param {boolean} [recursive]
   * @returns {Promise<FileApiResult>}
   */
  async function fileList(path, recursive = false) {
    return call("file_list", {
      method: "GET",
      query: createFileListRequest(path, recursive)
    });
  }

  /**
   * Build a same-origin attachment URL for downloading an authenticated folder
   * as a ZIP archive without buffering it in the browser.
   *
   * @param {string | { path: string }} pathOrOptions
   * @returns {string}
   */
  function folderDownloadUrl(pathOrOptions) {
    return buildApiUrl(basePath, "folder_download", createFolderDownloadQuery(pathOrOptions)).toString();
  }

  /**
   * Move or rename authenticated app files or folders.
   * `fileMove()` accepts app-rooted paths such as `L2/alice/note.txt`,
   * directory paths that end with `/`, and the `~` or `~/...` shorthand for
   * the current user's `L2/<username>/...` path. The destination path must be
   * explicit and writable, and batch moves accept composed `entries` input.
   *
   * @param {string | FileTransferInput[] | FileTransferBatchOptions | FileTransferInput} pathOrEntries
   * @param {string} [toPath]
   * @returns {Promise<FileTransferInput | FileTransferBatchApiResult>}
   */
  async function fileMove(pathOrEntries, toPath) {
    return call("file_move", createFileTransferRequest(pathOrEntries, toPath));
  }

  /**
   * List local Git history commits for a writable L1 group or L2 user root.
   * The backend enforces read or write access for the target owner folder.
   *
   * @param {string | { path?: string, limit?: number }} pathOrOptions
   * @param {number} [limit]
   * @returns {Promise<GitHistoryListResult>}
   */
  async function gitHistoryList(pathOrOptions = "~", limit = 50) {
    return call("git_history_list", createGitHistoryListRequest(pathOrOptions, limit));
  }

  /**
   * Read the patch for one file in a local-history commit.
   *
   * @param {string | { path?: string, commitHash?: string, commit?: string, hash?: string, filePath?: string, file?: string, pathWithinCommit?: string }} pathOrOptions
   * @param {string} [commitHash]
   * @param {string} [filePath]
   * @returns {Promise<GitHistoryDiffResult>}
   */
  async function gitHistoryDiff(pathOrOptions = "~", commitHash = "", filePath = "") {
    return call("git_history_diff", createGitHistoryDiffRequest(pathOrOptions, commitHash, filePath));
  }

  /**
   * Preview the files and optional patch for a travel or revert history operation.
   *
   * @param {string | { path?: string, commitHash?: string, commit?: string, hash?: string, operation?: string, filePath?: string, file?: string, pathWithinCommit?: string }} pathOrOptions
   * @param {string} [commitHash]
   * @param {string} [operation]
   * @param {string} [filePath]
   * @returns {Promise<GitHistoryPreviewResult>}
   */
  async function gitHistoryPreview(pathOrOptions = "~", commitHash = "", operation = "travel", filePath = "") {
    return call("git_history_preview", createGitHistoryPreviewRequest(pathOrOptions, commitHash, operation, filePath));
  }

  /**
   * Roll back a writable L1 group or L2 user root to an existing local-history commit.
   * The backend performs the reset and suppresses history scheduling for the rollback itself.
   *
   * @param {string | { path?: string, commitHash?: string, commit?: string, hash?: string }} pathOrOptions
   * @param {string} [commitHash]
   * @returns {Promise<GitHistoryRollbackResult>}
   */
  async function gitHistoryRollback(pathOrOptions = "~", commitHash = "") {
    return call("git_history_rollback", createGitHistoryRollbackRequest(pathOrOptions, commitHash));
  }

  /**
   * Revert one local-history commit by creating a new commit with the inverse changes.
   *
   * @param {string | { path?: string, commitHash?: string, commit?: string, hash?: string }} pathOrOptions
   * @param {string} [commitHash]
   * @returns {Promise<GitHistoryRevertResult>}
   */
  async function gitHistoryRevert(pathOrOptions = "~", commitHash = "") {
    return call("git_history_revert", createGitHistoryRollbackRequest(pathOrOptions, commitHash));
  }

  /**
   * Return the authenticated user's derived profile snapshot from the backend.
   *
   * @returns {Promise<UserSelfInfoResult>}
   */
  async function userSelfInfo() {
    return call("user_self_info", {
      method: "GET"
    });
  }

  return {
    call,
    fileCopy,
    fileDelete,
    fileInfo,
    fileList,
    fileMove,
    fileRead,
    fileWrite,
    folderDownloadUrl,
    gitHistoryDiff,
    gitHistoryList,
    gitHistoryPreview,
    gitHistoryRollback,
    gitHistoryRevert,
    health,
    userSelfInfo
  };
}
