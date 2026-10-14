import { describe, expect, it } from "vitest";
import { ScriptedVoiceHost, SequentialIds } from "../../src/fakes/index.ts";
import { startVoiceCall, VoiceDelegate } from "../../src/voice/delegate.ts";
import { readSpec } from "../../src/spec/lint.ts";
import type { LiveCommand } from "../../src/ports/voice.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const prompt = "Add an item to a todo list";

describe("phase 5 voice front end on fakes", () => {
  it("routes a spoken request through the same router and ships the feature with no human step", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[prompt, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const host = new ScriptedVoiceHost();
    const call = await startVoiceCall({ host, target: w.orchestrator, spec: readSpec((await w.orchestrator.mainTree()).tree), ids: new SequentialIds() });
    expect(call.sessionId).toBe("voice1");
    expect(host.instructions[0]).toContain("Delegate to the client");
    call.sendAudio(new Uint8Array([1, 2]));
    expect(host.audio).toEqual([new Uint8Array([1, 2])]);

    host.say("Add an item to a to-do list.");
    await call.delegate.idle();

    const [request] = call.delegate.requests;
    expect(request?.prompt).toBe("Add an item to a to-do list.");
    const spoken = w.bus.log.find((e) => e.type === "voice.request");
    expect(spoken).toMatchObject({ type: "voice.request", voiceSessionId: call.sessionId, intent: "new_feature", featureId: "todo-add" });
    expect(host.spoken()[0]).toContain("Started a new feature, todo-add");
    const sessionId = request?.result?.sessionId as string;
    expect((await w.orchestrator.run(sessionId)).machine.state).toBe("merged");

    host.say("What does the todo list feature do?");
    await call.delegate.idle();
    expect(call.delegate.requests[1]?.result?.sessionId).toBeNull();
    expect(host.spoken()[1]).toContain("memory/features/todo-add.md");

    host.hangUp();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(w.bus.log.filter((e) => e.type === "voice.turn")).toMatchObject([
      { type: "voice.turn", voiceSessionId: call.sessionId, speaker: "you", text: "Add an item to a to-do list." },
      { type: "voice.turn", voiceSessionId: call.sessionId, speaker: "you", text: "What does the todo list feature do?" },
    ]);
  });

  it("asks again when it heard nothing, and keeps speech after the delegation point for the next request", async () => {
    const sent: LiveCommand[] = [];
    const prompts: string[] = [];
    const target = {
      submitSpoken: async (text: string) => {
        prompts.push(text);
        return { decision: { intent: "question" as const, featureId: null, changeKind: null, via: "rules" as const, confidence: 1, reason: "test" }, sessionId: null, sessionIds: [], answer: { text: `heard ${text}`, sources: [] } };
      },
    };
    const delegate = new VoiceDelegate("v1", target, (c) => sent.push(c), new SequentialIds());
    await delegate.handle({ type: "session.delegation.created", offset_ms: 100, delegation: { id: "d0", target: "client" } });
    expect(sent.at(-1)).toMatchObject({ delegation_id: "d0", content: "I did not catch a request. Please say it again." });

    await delegate.handle({ type: "session.input_transcript.delta", delta: "What is ", start_ms: 1000 });
    await delegate.handle({ type: "session.input_transcript.delta", delta: "chef?", start_ms: 1300 });
    await delegate.handle({ type: "session.input_transcript.delta", delta: "Also ", start_ms: 2500 });
    await delegate.handle({ type: "session.delegation.created", offset_ms: 2000, delegation: { id: "d1", target: "client" } });
    await delegate.handle({ type: "session.delegation.created", offset_ms: 2000, delegation: { id: "d2", target: "responses" } });
    expect(prompts).toEqual(["What is chef?"]);
    expect(sent.at(-1)).toMatchObject({ type: "session.commentary.append", delegation_id: "d1", content: "heard What is chef?" });
    await delegate.handle({ type: "session.input_transcript.delta", delta: "add a dark mode", start_ms: 2700 });
    await delegate.handle({ type: "session.delegation.created", offset_ms: 4000, delegation: { id: "d3", target: "client" } });
    expect(prompts.at(-1)).toBe("Also add a dark mode");
    await delegate.handle({ type: "session.input_transcript.delta", delta: "uh, can you add search", start_ms: 5000 });
    await delegate.handle({ type: "session.delegation.created", delegation: { id: "d4", target: "client", request: "Add search" } });
    expect(prompts.at(-1)).toBe("Add search");
  });
});
