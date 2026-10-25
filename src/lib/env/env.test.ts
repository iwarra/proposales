import { describe, expect, it } from "vitest";
import { optionalEnv, requireEnv, requirePositiveInt } from "./index";

describe("env", () => {
  it("names a missing variable", () => {
    expect(() => requireEnv("X_TOKEN", {}, {})).toThrow("Missing environment variable X_TOKEN.");
    expect(() => requireEnv("X_TOKEN", {}, { X_TOKEN: "  " })).toThrow("Missing environment variable X_TOKEN.");
  });

  it("checks https", () => {
    expect(() => requireEnv("X_URL", { https: true }, { X_URL: "http://a" })).toThrow("X_URL must start with https://");
    expect(requireEnv("X_URL", { https: true }, { X_URL: "https://a" })).toBe("https://a");
  });

  it("checks positive whole numbers", () => {
    for (const bad of ["0", "-1", "1.5", "12abc"]) {
      expect(() => requirePositiveInt("X_ID", { X_ID: bad })).toThrow("X_ID must be a positive whole number.");
    }
    expect(requirePositiveInt("X_ID", { X_ID: "1234" })).toBe(1234);
  });

  it("falls back for optional values", () => {
    expect(optionalEnv("X_MODEL", "default", {})).toBe("default");
    expect(optionalEnv("X_MODEL", "default", { X_MODEL: "set" })).toBe("set");
  });
});
