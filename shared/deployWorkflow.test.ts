import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

describe("container deployment assets", () => {
  it("defines a production Docker image for the finance workbench", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");

    expect(dockerfile).toContain("FROM node:22-alpine AS build");
    expect(dockerfile).toContain("RUN npm ci");
    expect(dockerfile).toContain("RUN npm run build");
    expect(dockerfile).toContain("FROM node:22-alpine AS runtime");
    expect(dockerfile).toContain("RUN npm ci --omit=dev");
    expect(dockerfile).toContain("COPY --from=build /app/dist ./dist");
    expect(dockerfile).toContain("COPY config ./config");
    expect(dockerfile).toContain("CMD [\"node\", \"dist/server/index.js\"]");
  });

  it("pushes Docker images to ECR and deploys them on EC2 through SSM", async () => {
    const workflowText = await readFile(".github/workflows/deploy.yml", "utf8");
    const workflow = YAML.parse(workflowText) as {
      jobs: Record<string, { permissions?: Record<string, string>; steps: Array<{ name?: string; run?: string; uses?: string }> }>;
      on: Record<string, unknown>;
    };

    expect(workflow.on.push).toMatchObject({ branches: ["main"] });

    const deployJob = workflow.jobs.deploy;
    expect(deployJob.permissions).toMatchObject({
      contents: "read",
      "id-token": "write",
    });

    const stepText = deployJob.steps.map((step) => `${step.name ?? ""}\n${step.uses ?? ""}\n${step.run ?? ""}`).join("\n");
    expect(stepText).toContain("aws-actions/configure-aws-credentials@v4");
    expect(stepText).toContain("aws-actions/amazon-ecr-login@v2");
    expect(stepText).toContain("docker build");
    expect(stepText).toContain("docker push");
    expect(stepText).toContain("aws ssm send-command");
    expect(stepText).toContain('deploy_comment="Deploy msite-finance ${GITHUB_SHA:0:12}"');
    expect(stepText).toContain('--comment "$deploy_comment"');
    expect(stepText).not.toContain('--comment "Deploy ${image_uri}"');
    expect(stepText).toContain("docker pull");
    expect(stepText).toContain("docker run");
    expect(stepText).toContain("systemctl restart msite.service");
    expect(stepText).toContain("MSITE_PUBLIC_BASE_URL=https://finance.nphunter.net npx playwright test tests/e2e/public-smoke.spec.ts");
    expect(stepText).not.toContain("aws s3 cp");
  });

  it("keeps ECR and deployment roles in Pulumi", async () => {
    const pulumiProgram = await readFile("infra/index.ts", "utf8");

    expect(pulumiProgram).toContain("new aws.ecr.Repository");
    expect(pulumiProgram).toContain("msite-finance");
    expect(pulumiProgram).toContain("new aws.iam.Role(\"githubDeployRole\"");
    expect(pulumiProgram).toContain("sts:AssumeRoleWithWebIdentity");
    expect(pulumiProgram).toContain("repo:illidan53/msite:ref:refs/heads/main");
    expect(pulumiProgram).toContain("ecr:GetAuthorizationToken");
    expect(pulumiProgram).toContain("ecr:PutImage");
    expect(pulumiProgram).toContain("ssm:SendCommand");
    expect(pulumiProgram).toContain("new aws.iam.RolePolicy(\"ec2EcrPullPolicy\"");
  });
});
