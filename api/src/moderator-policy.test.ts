import { describe, expect, it } from "vitest";
import policy from "../../bootstrap/policy-moderator.json";
import agent from "../../bootstrap/policy-moderator-agent.json";

// CI can't run the IAM simulator (bootstrap/check-moderator.sh does, with admin credentials),
// so this pins the moderator policy's shape: any widening has to change this test too (#50).
type Statement = {
  Sid: string;
  Effect: string;
  Action: string | string[];
  Resource: string | string[];
};
const statements = policy.Statement as Statement[];
const list = (v: string | string[]) => (Array.isArray(v) ? v : [v]);
const allowed = statements.filter((s) => s.Effect === "Allow").flatMap((s) => list(s.Action));

describe("moderator role policy (#50)", () => {
  it("allows exactly the moderation actions", () => {
    expect([...new Set(allowed)].sort()).toEqual([
      "cloudfront:CreateInvalidation",
      "dynamodb:BatchGetItem",
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:UpdateItem",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject",
    ]);
    for (const s of statements) for (const r of list(s.Resource)) expect(r).not.toBe("*");
  });
  it("can never read or list the private recovery copies, so it can't restore", () => {
    const denies = statements.filter((s) => s.Effect === "Deny");
    expect(denies.map((s) => [s.Action, s.Resource])).toEqual([
      ["s3:GetObject", "arn:aws:s3:::footballteampicker-media-020949219706/private/*"],
      ["s3:ListBucket", "arn:aws:s3:::footballteampicker-media-020949219706"],
    ]);
    const writes = statements.filter(
      (s) => s.Effect === "Allow" && list(s.Action).includes("s3:PutObject"),
    );
    expect(writes.flatMap((s) => list(s.Resource)).sort()).toEqual([
      "arn:aws:s3:::footballteampicker-media-020949219706/m/browse/*",
      "arn:aws:s3:::footballteampicker-media-020949219706/private/takedown/*",
    ]);
  });
  it("lets the agent user do nothing but assume the role", () => {
    expect(agent.Statement).toEqual([
      expect.objectContaining({
        Effect: "Allow",
        Action: "sts:AssumeRole",
        Resource: "arn:aws:iam::020949219706:role/footballteampicker-moderator",
      }),
    ]);
  });
});
