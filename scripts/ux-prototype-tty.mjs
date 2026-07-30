#!/usr/bin/env node
/** Manual TTY gate: Home → Setup → Overview. No writes. Esc exits. */
import React from "react";
import { render } from "ink";
import { TaskFlowApp } from "../src/global/ink/ux/task-flow-app.js";

const app = render(React.createElement(TaskFlowApp, {
  onExit: () => app.unmount()
}));
