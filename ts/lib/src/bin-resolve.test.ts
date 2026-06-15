import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveBin } from "./bin-resolve.js";

describe("resolveBin", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ca-bin-"));
    await mkdir(join(dir, "node_modules", ".bin"), { recursive: true });
    await writeFile(join(dir, "node_modules", ".bin", "vitest"), "#!/bin/sh\n");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prefers a project-local node_modules/.bin binary", () => {
    expect(resolveBin("vitest", dir)).toBe(join(dir, "node_modules", ".bin", "vitest"));
  });

  it("falls back to the bare name (PATH) when not found locally", () => {
    expect(resolveBin("jscpd", dir)).toBe("jscpd");
  });

  it("checks dirs in order and skips empty ones", () => {
    expect(resolveBin("vitest", "", "/nope", dir)).toBe(
      join(dir, "node_modules", ".bin", "vitest"),
    );
  });
});
