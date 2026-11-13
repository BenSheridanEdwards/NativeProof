import { test } from "node:test";
import { faultProof } from "./harness.js";

test("missing runtime tsx is detected", () => faultProof("tsx"));
test("missing onboard entry is detected", () => faultProof("onboard"));
