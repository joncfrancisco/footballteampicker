import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

export function reportNotifier(topic: string, hostname: string, sns = new SNSClient({})) {
  return async (report: { targetType: "list" | "team"; targetId: string; reason: string }) => {
    await sns.send(
      new PublishCommand({
        TopicArn: topic,
        Subject: "Depth Chart content report",
        Message: `Reported ${report.targetType}: https://${hostname}/${report.targetType === "list" ? "l" : "t"}/${report.targetId}\n\nReason: ${report.reason}\n\nRun bin/moderation-queue to review open reports. Reports from the same network are deduplicated.`,
      }),
    );
  };
}
