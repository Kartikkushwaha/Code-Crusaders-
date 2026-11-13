/**
 * Approval workflow facade. The app runs in one of two modes:
 *
 *   demo     "Take a demo": the original in-browser workflow (lib/workflowDemo.js). Roles are switched
 *            freely and everything is kept in this browser.
 *   company  "Start as company": real accounts; the workflow lives in the database behind /api/workflow
 *            (lib/workflowServer.js) and the server enforces every rule.
 *
 * Panels import from here and never need to know which mode is active.
 */
import * as demo from "./workflowDemo.js";
import * as server from "./workflowServer.js";

let mode = "demo";
export function setWorkflowMode(next) {
  mode = next === "company" ? "company" : "demo";
}
const impl = () => (mode === "company" ? server : demo);

export const ROLES = server.ROLES;
export const STATUS = server.STATUS;

/** Live workflow state of the active mode (both stores are subscribed so hook order never changes). */
export function useWorkflow() {
  const d = demo.useWorkflow();
  const s = server.useWorkflow();
  return mode === "company" ? s : d;
}
/** The demo store, whatever the mode (the demo sign-in shows waiting counts per role). */
export const useDemoWorkflow = demo.useWorkflow;

export const getSubmission = (id) => impl().getSubmission(id);
export const submitToManager = (args) => impl().submitToManager(args);
export const markSeen = (id) => impl().markSeen(id);
export const markPublished = (id, args) => impl().markPublished(id, args);
export const markSignedOff = (id, args) => impl().markSignedOff(id, args);
export const managerDecision = (id, args) => impl().managerDecision(id, args);
export const legalDecision = (id, args) => impl().legalDecision(id, args);
/** Company mode only: load the company's content from the server and keep it fresh. */
export const startWorkflowSync = (ctx) => (mode === "company" ? server.startWorkflowSync(ctx) : undefined);

export { loadName, saveName, timeAgo } from "./workflowServer.js";
