import { beforeEach, describe, expect, it } from "vitest";
import { LambdaClient, PutFunctionConcurrencyCommand } from "@aws-sdk/client-lambda";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { mockClient } from "aws-sdk-client-mock";
import { createKillSwitch } from "./killswitch";

const lambda = mockClient(LambdaClient);
const sns = mockClient(SNSClient);
const topic = "arn:aws:sns:us-east-1:020949219706:footballteampicker-alerts";
beforeEach(() => {
  lambda.reset();
  sns.reset();
  lambda.resolves({});
  sns.resolves({});
});
function event(
  name = "footballteampicker-write-spike",
  state = "ALARM",
  source = topic,
  account = "020949219706",
) {
  return {
    Records: [
      {
        Sns: {
          TopicArn: source,
          Message: JSON.stringify({
            AlarmName: name,
            NewStateValue: state,
            AlarmArn: `arn:aws:cloudwatch:us-east-1:${account}:alarm:${name}`,
          }),
        },
      },
    ],
  };
}
describe("write kill switch", () => {
  it("pauses only the API and publishes the recovery instructions for either write alarm", async () => {
    const run = createKillSwitch(topic);
    for (const name of [
      "footballteampicker-write-spike",
      "footballteampicker-dynamodb-write-spike",
    ]) {
      expect(await run(event(name))).toEqual({ paused: true });
    }
    expect(lambda.commandCalls(PutFunctionConcurrencyCommand)).toHaveLength(2);
    expect(lambda.commandCalls(PutFunctionConcurrencyCommand)[0]!.args[0].input).toEqual({
      FunctionName: "footballteampicker-api",
      ReservedConcurrentExecutions: 0,
    });
    expect(sns.commandCalls(PublishCommand)[0]!.args[0].input.Message).toContain(
      "bin/killswitch off",
    );
  });
  it("ignores reports, OK, unrelated alarms, foreign topics and foreign accounts", async () => {
    const run = createKillSwitch(topic);
    for (const input of [
      event(undefined, "OK"),
      event("footballteampicker-api-errors"),
      event(undefined, undefined, "other"),
      event(undefined, undefined, undefined, "999999999999"),
      { Records: [{ Sns: { TopicArn: topic, Message: "report" } }] },
    ]) {
      expect(await run(input)).toEqual({ paused: false });
    }
    expect(lambda.calls()).toHaveLength(0);
    expect(sns.calls()).toHaveLength(0);
  });
});
