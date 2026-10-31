import {
  LambdaClient,
  GetFunctionConcurrencyCommand,
  PutFunctionConcurrencyCommand,
} from "@aws-sdk/client-lambda";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

async function main() {
  const action = process.argv[2];
  if (!["on", "off", "status"].includes(action ?? "") || process.argv.length !== 3)
    throw new Error("Usage: bin/killswitch on|off|status");
  const config = { region: "us-east-1" };
  const identity = await new STSClient(config).send(new GetCallerIdentityCommand({}));
  if (identity.Account !== "020949219706") throw new Error("Expected AWS account 020949219706");
  const lambda = new LambdaClient(config);
  if (action !== "status") {
    await lambda.send(
      new PutFunctionConcurrencyCommand({
        FunctionName: "footballteampicker-api",
        ReservedConcurrentExecutions: action === "on" ? 0 : 25,
      }),
    );
    await new SNSClient(config).send(
      new PublishCommand({
        TopicArn: "arn:aws:sns:us-east-1:020949219706:footballteampicker-alerts",
        Subject: "Depth Chart write switch changed",
        Message:
          action === "on"
            ? "An operator paused API writes."
            : "An operator restored the API reserved-concurrency cap to 25. Review any active budget deny action separately.",
      }),
    );
  }
  const result = await lambda.send(
    new GetFunctionConcurrencyCommand({ FunctionName: "footballteampicker-api" }),
  );
  console.log(
    JSON.stringify({
      function: "footballteampicker-api",
      reservedConcurrency: result.ReservedConcurrentExecutions,
      paused: result.ReservedConcurrentExecutions === 0,
    }),
  );
}
main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
