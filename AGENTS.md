# Agent Instructions

## Finish Flow

After completing any code, config, or documentation change in this repository:

1. Run focused checks while developing.
2. Before finalizing, run:
   - `npm run lint`
   - `npm test`
   - `npm run build`
   - `npm run test:e2e`
3. Commit the verified changes on `main`.
4. Push `main` to `origin`.
5. Confirm the GitHub Actions deployment workflow starts and deploys the ECR image.
6. After deployment, verify the public endpoint:

```bash
MSITE_PUBLIC_BASE_URL=https://finance.nphunter.net npx playwright test tests/e2e/public-smoke.spec.ts
```

If credentials, GitHub Actions, AWS, or a failed check blocks any step, report the exact blocker and leave the working tree state clear.

## Deployment Source Of Truth

Production deploys are handled by `.github/workflows/deploy.yml` on every push to `main`.

The workflow builds a Docker image, pushes it to ECR repository `msite-finance`, runs an SSM command on the tagged finance EC2 instance, and updates `msite.service` to run the pulled container. AWS resources and IAM permissions for this path are declared in `infra/` Pulumi code.
