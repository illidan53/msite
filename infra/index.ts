import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

const accountId = config.get("accountId") ?? "612153676415";
const ecrRepositoryName = config.get("ecrRepositoryName") ?? "msite-finance";
const ec2InstanceId = config.get("ec2InstanceId") ?? "i-0fa217e019960b606";
const ec2RoleName = config.get("ec2RoleName") ?? "msite-finance-ec2-role";
const githubOwner = config.get("githubOwner") ?? "illidan53";
const githubRepo = config.get("githubRepo") ?? "msite";
const githubBranch = config.get("githubBranch") ?? "main";
const defaultGithubSubject = "repo:illidan53/msite:ref:refs/heads/main";
const githubOidcProviderArn =
  config.get("githubOidcProviderArn") ??
  `arn:aws:iam::${accountId}:oidc-provider/token.actions.githubusercontent.com`;

const repository = new aws.ecr.Repository("financeRepository", {
  name: ecrRepositoryName,
  imageScanningConfiguration: {
    scanOnPush: true,
  },
  imageTagMutability: "MUTABLE",
});

new aws.ecr.LifecyclePolicy("financeRepositoryLifecycle", {
  repository: repository.name,
  policy: JSON.stringify({
    rules: [
      {
        rulePriority: 1,
        description: "Keep the last 30 images",
        selection: {
          tagStatus: "any",
          countType: "imageCountMoreThan",
          countNumber: 30,
        },
        action: {
          type: "expire",
        },
      },
    ],
  }),
});

const currentRegion = aws.getRegionOutput({});
const githubSubject =
  githubOwner === "illidan53" && githubRepo === "msite" && githubBranch === "main"
    ? defaultGithubSubject
    : `repo:${githubOwner}/${githubRepo}:ref:refs/heads/${githubBranch}`;

const githubDeployRole = new aws.iam.Role("githubDeployRole", {
  name: "msite-finance-github-deploy",
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: {
          Federated: githubOidcProviderArn,
        },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": githubSubject,
          },
        },
      },
    ],
  }),
});

new aws.iam.RolePolicy("githubDeployPolicy", {
  role: githubDeployRole.id,
  policy: pulumi.all([repository.arn, currentRegion.name]).apply(([repositoryArn, region]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "DescribeFinanceInstance",
          Effect: "Allow",
          Action: ["ec2:DescribeInstances"],
          Resource: "*",
        },
        {
          Sid: "PushFinanceImages",
          Effect: "Allow",
          Action: [
            "ecr:BatchCheckLayerAvailability",
            "ecr:CompleteLayerUpload",
            "ecr:DescribeImages",
            "ecr:DescribeRepositories",
            "ecr:GetDownloadUrlForLayer",
            "ecr:InitiateLayerUpload",
            "ecr:PutImage",
            "ecr:UploadLayerPart",
          ],
          Resource: repositoryArn,
        },
        {
          Sid: "AuthenticateToEcr",
          Effect: "Allow",
          Action: ["ecr:GetAuthorizationToken"],
          Resource: "*",
        },
        {
          Sid: "RunDeploymentCommand",
          Effect: "Allow",
          Action: ["ssm:SendCommand"],
          Resource: [
            `arn:aws:ec2:${region}:${accountId}:instance/${ec2InstanceId}`,
            `arn:aws:ssm:${region}::document/AWS-RunShellScript`,
          ],
        },
        {
          Sid: "ReadDeploymentCommandResult",
          Effect: "Allow",
          Action: ["ssm:GetCommandInvocation"],
          Resource: "*",
        },
      ],
    }),
  ),
});

new aws.iam.RolePolicy("ec2EcrPullPolicy", {
  role: ec2RoleName,
  policy: repository.arn.apply((repositoryArn) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "AuthenticateToEcr",
          Effect: "Allow",
          Action: ["ecr:GetAuthorizationToken"],
          Resource: "*",
        },
        {
          Sid: "PullFinanceImages",
          Effect: "Allow",
          Action: [
            "ecr:BatchCheckLayerAvailability",
            "ecr:BatchGetImage",
            "ecr:DescribeImages",
            "ecr:DescribeRepositories",
            "ecr:GetDownloadUrlForLayer",
          ],
          Resource: repositoryArn,
        },
      ],
    }),
  ),
});

export const repositoryUrl = repository.repositoryUrl;
export const deployRoleArn = githubDeployRole.arn;
