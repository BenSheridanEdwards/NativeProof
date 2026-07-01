import { expect, native } from "../nativeproof.config";

describe("login", () => {
  it("should be able to log in", async () => {
    await native.navigate("/login");
    await native.tap("Log in");

    await expect(native.getByText("Welcome back")).toBeVisible();
  });
});
