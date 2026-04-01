import { buildUserIndexSnapshot } from "../../auth/user-index.js";
import { WatchdogHandler } from "../watchdog.js";

export default class UserIndexHandler extends WatchdogHandler {
  createInitialState() {
    return buildUserIndexSnapshot({
      filePaths: [],
      projectRoot: this.projectRoot
    });
  }

  rebuild(context) {
    const pathIndex = context.getIndex("path-index") || {};

    this.state = buildUserIndexSnapshot({
      filePaths: Object.keys(pathIndex),
      projectRoot: this.projectRoot
    });
  }

  async onStart(context) {
    this.rebuild(context);
  }

  async onChanges(context) {
    this.rebuild(context);
  }
}
