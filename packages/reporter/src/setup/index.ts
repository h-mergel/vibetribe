export { detectGitBash, execText } from "./detect";
export {
  ensureToken,
  install,
  type SetupEnv,
  SetupError,
  settingsPath,
  uninstall,
} from "./install";
export { reporterCopyPath, type SetupState, setupState, stateOfFiles } from "./state";
