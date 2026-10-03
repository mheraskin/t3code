import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { orderFiledSidebarThreads, sidebarFilingCandidates } from "./Sidebar.logic";

const environmentId = EnvironmentId.make("environment");
const projectId = ProjectId.make("project");
function thread(id: string, parent: string | null = null) {
  return {
    id: ThreadId.make(id),
    title: id,
    environmentId,
    projectId,
    archivedAt: null,
    filedUnderThreadId: parent === null ? null : ThreadId.make(parent),
  };
}

describe("sidebar filing", () => {
  it("keeps children beneath their parent without hiding orphaned or cross-environment rows", () => {
    const child = thread("child", "parent");
    const orphan = thread("orphan", "missing");
    const otherEnvironment = {
      ...thread("foreign", "parent"),
      environmentId: EnvironmentId.make("other"),
    };
    expect(
      orderFiledSidebarThreads([child, orphan, thread("parent"), otherEnvironment]).map(
        (entry) => entry.id,
      ),
    ).toEqual(["orphan", "parent", "child", "foreign"]);
  });
  it("excludes nested, archived, side, and foreign parents", () => {
    const source = thread("source");
    const candidates = [
      source,
      thread("parent"),
      thread("nested", "parent"),
      { ...thread("archived"), archivedAt: "2026-10-03T00:00:00Z" },
      { ...thread("side"), presentation: { kind: "side" as const, ownerThreadId: source.id } },
      { ...thread("foreign"), projectId: ProjectId.make("other") },
    ];
    expect(sidebarFilingCandidates(source, candidates).map((entry) => entry.id)).toEqual([
      "parent",
    ]);
    expect(sidebarFilingCandidates(thread("parent"), candidates)).toEqual([]);
  });
});
