import { LambdaClient, PutFunctionConcurrencyCommand } from "@aws-sdk/client-lambda";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const ALARMS = ["footballteampicker-write-spike", "footballteampicker-dynamodb-write-spike"];
type Event = { Records?: { Sns?: { TopicArn?: string; Message?: string } }[] };

export function createKillSwitch(
  topic: string,
  lambda = new LambdaClient({}),
  sns = new SNSClient({}),
) {
  return async (event: Event) => {
    let trigger: string | undefined;
    for (const record of event.Records ?? []) {
      if (record.Sns?.TopicArn !== topic || !record.Sns.Message) continue;
      try {
        const alarm = JSON.parse(record.Sns.Message) as {
          AlarmName?: string;
          AlarmArn?: string;
          NewStateValue?: string;
        };
        if (
          alarm.NewStateValue === "ALARM" &&
          ALARMS.includes(alarm.AlarmName ?? "") &&
          alarm.AlarmArn === `arn:aws:cloudwatch:us-east-1:020949219706:alarm:${alarm.AlarmName}`
        )
          trigger = alarm.AlarmName;
      } catch {
        /* Reports and notification messages are not kill-switch signals. */
      }
    }
    if (!trigger) return { paused: false };
    await lambda.send(
      new PutFunctionConcurrencyCommand({
        FunctionName: "footballteampicker-api",
        ReservedConcurrentExecutions: 0,
      }),
    );
    await sns.send(
      new PublishCommand({
        TopicArn: topic,
        Subject: "Depth Chart writes paused",
        Message: `The ${trigger} alarm paused API writes by setting reserved concurrency to zero. Cached list/team links, browse, and image export remain available. Review traffic and run bin/killswitch off when ready to restore the cap of 50.`,
      }),
    );
    return { paused: true };
  };
}

let run: ReturnType<typeof createKillSwitch> | undefined;
export async function handler(event: Event) {
  const topic = process.env.ALERTS_TOPIC;
  if (!topic) throw new Error("Missing ALERTS_TOPIC");
  run ??= createKillSwitch(topic);
  return run(event);
}
