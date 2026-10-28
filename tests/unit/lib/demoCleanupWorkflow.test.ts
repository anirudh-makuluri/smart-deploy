import { describe, expect, it } from "vitest";
import { CLEANUP_DEMO, CLEANUP_EXPIRY, CLEANUP_VALUES, CleanupTaskError, CleanupWorkflowFixture, cleanupAwsFixture, resolvedCleanupWorkflow, type CleanupWorkflow } from "../../helpers/cleanupWorkflow";

describe("native Standard cleanup workflow", () => {
  it("gives every nested state a unique name and bounds every native task and map", () => {
    const names: string[] = [];
    function inspect(workflow: CleanupWorkflow) {
      for (const [name, state] of Object.entries(workflow.States)) {
        names.push(name);
        if (state.Type === "Task") { expect(state.TimeoutSeconds).toBe(10); expect(state.Resource).toMatch(/^arn:aws:states:::aws-sdk:/); expect(state.Retry).toBeUndefined(); }
        if (state.Type === "Map") { expect(state.MaxConcurrency).toBe(2); inspect(state.ItemProcessor as CleanupWorkflow); }
        if (Array.isArray(state.Branches)) for (const branch of state.Branches) inspect(branch as CleanupWorkflow);
      }
    }
    inspect(resolvedCleanupWorkflow()); expect(new Set(names).size).toBe(names.length);
  });
  it("waits for the absolute expiry, independently cleans fixed resources and observes terminal state", async () => {
    const aws = cleanupAwsFixture(); const fixture = new CleanupWorkflowFixture(async (resource, args) => {
      expect(fixture.now).toBeGreaterThanOrEqual(CLEANUP_EXPIRY); return aws.transport(resource, args);
    });
    expect(await fixture.run()).toEqual({ status: "complete" });
    expect(fixture.waits[0]).toBe(CLEANUP_EXPIRY); expect(fixture.waits.length).toBeGreaterThan(1);
    expect(aws.model.groups).toEqual(["sg-22222222222222222", "sg-33333333333333333"]);
    expect(aws.model.parameters.size).toBe(6); expect(aws.calls.filter(row => row.resource.endsWith(":updateService"))).toHaveLength(3);
    expect(aws.calls.some(row => row.resource.includes("lambda") || row.resource.includes("getParameter") || row.resource.includes("dynamodb"))).toBe(false);
    expect(aws.calls.filter(row => row.resource.endsWith(":deleteStack"))).toHaveLength(1);
  });
  it.each([null, {}, { mode: "cleanup", expiresAt: 0 }, { mode: "cleanup", appId: "foreign" }, { mode: "wrong" }])("rejects input overrides before any AWS call: %j", async input => {
    const aws = cleanupAwsFixture(), fixture = new CleanupWorkflowFixture(aws.transport);
    await expect(fixture.run(undefined, input)).rejects.toThrow("InvalidCleanupExecution"); expect(aws.calls).toHaveLength(0);
  });
  it("rejects a second execution name and drifted expiry clocks", async () => {
    const aws = cleanupAwsFixture(), fixture = new CleanupWorkflowFixture(aws.transport); fixture.name = CLEANUP_DEMO + "-second";
    await expect(fixture.run()).rejects.toThrow("InvalidCleanupExecution");
    fixture.name = CLEANUP_DEMO;
    await expect(fixture.run(resolvedCleanupWorkflow({ ...CLEANUP_VALUES, CleanupEndUtc: new Date(CLEANUP_EXPIRY + 3600000).toISOString() }))).rejects.toThrow("InvalidCleanupExecution");
    expect(aws.calls).toHaveLength(0);
  });
  it.each(["foreignWorker", "foreignEni", "foreignAlb", "paginatedStack", "serviceRole", "stackDenied", "parameterDenied"] as const)("does not claim completion or perform that unsafe mutation on %s", async fault => {
    const aws = cleanupAwsFixture(); aws.model[fault] = true;
    const fixture = new CleanupWorkflowFixture(aws.transport);
    await expect(fixture.run()).rejects.toThrow("CleanupIncomplete");
    if (fault === "foreignWorker") expect(aws.calls.some(row => row.resource.endsWith(":stopInstances"))).toBe(false);
    else expect(aws.calls.some(row => row.resource.endsWith(":stopInstances"))).toBe(true);
    if (["foreignEni", "paginatedStack", "serviceRole", "stackDenied"].includes(fault)) expect(aws.calls.some(row => row.resource.endsWith(":deleteStack"))).toBe(false);
    if (fault === "foreignAlb") expect(aws.calls.some(row => row.resource.endsWith(":deleteLoadBalancer"))).toBe(false);
    if (fault === "parameterDenied") expect(aws.calls.some(row => row.resource.endsWith(":deleteParameter"))).toBe(false);
    expect(fixture.now).toBeLessThanOrEqual(CLEANUP_EXPIRY + 1800000);
  }, 20000);
  it("treats an already stopped unleased worker as observation only", async () => {
    const aws = cleanupAwsFixture(); aws.model.worker = "stopped"; aws.model.foreignWorker = true;
    expect(await new CleanupWorkflowFixture(aws.transport).run()).toEqual({ status: "complete" });
    expect(aws.calls.some(row => row.resource.endsWith(":stopInstances"))).toBe(false);
  });
  it.each([
    ["CloudFormation.ValidationException", "Request arguments are invalid"],
    ["CloudFormation.CloudFormationException", "Request arguments are invalid"],
    ["CloudFormation.CloudFormationException", "Stack with id sdp-demo-foreign does not exist"],
  ])("does not classify unrelated CloudFormation errors as resource absence: %s %s", async (code, detail) => {
    const aws = cleanupAwsFixture(); const fixture = new CleanupWorkflowFixture(async (resource, args) => {
      if (resource.endsWith(":describeStacks")) throw new CleanupTaskError(code, detail);
      return aws.transport(resource, args);
    });
    await expect(fixture.run()).rejects.toThrow("CleanupIncomplete"); expect(aws.model.worker).toBe("stopped");
  }, 20000);
  it.each([[0, "describeInstances"], [1, "describeServices"], [2, "describeTags"], [3, "listTagsForResource"], [4, "describeNetworkInterfaces"]] as const)("rejects late mutation in branch %s after %s", async (index, lateRead) => {
    const aws = cleanupAwsFixture(); const definition = resolvedCleanupWorkflow();
    const initialize = definition.States.Initialize.Output as { config: Record<string, unknown> }; const config = initialize.config;
    config.expiresAt = CLEANUP_EXPIRY;
    const branch = (definition.States.Cleanup.Branches as Array<typeof definition>)[index];
    const fixture = new CleanupWorkflowFixture(async (resource, args) => { const result = await aws.transport(resource, args); if (resource.endsWith(":" + lateRead)) fixture.now = CLEANUP_EXPIRY + 1800000; return result; });
    fixture.now = CLEANUP_EXPIRY;
    expect(await fixture.run(branch, { config })).toBe(false);
    expect(aws.calls.some(row => /:(stopInstances|updateService|deleteLoadBalancer|deleteParameter|modifyNetworkInterfaceAttribute|deleteStack)$/.test(row.resource))).toBe(false);
  });
});
