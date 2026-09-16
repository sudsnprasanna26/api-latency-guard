import * as core from "@actions/core";

import { getSafeErrorMessage, run } from "./main.js";

void run().catch((error: unknown) => {
  core.setFailed(getSafeErrorMessage(error));
});
