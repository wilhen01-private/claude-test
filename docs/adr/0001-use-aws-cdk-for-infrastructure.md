# 1. Use AWS CDK (TypeScript) for Infrastructure as Code

Date: 2026-02-23

## Status

Accepted

## Context

The project needs a way to define and deploy AWS infrastructure repeatably across
environments. The main candidates were:

- **AWS CloudFormation** (raw YAML/JSON templates)
- **Terraform** (HCL, provider-agnostic)
- **AWS CDK** (imperative code compiled to CloudFormation)
- **Pulumi** (imperative code targeting multiple cloud providers)

The application code is TypeScript. The team wants infrastructure that can be
reviewed, tested, and refactored with the same tooling used for application code.
CloudFormation templates for non-trivial architectures become verbose and hard to
reason about; sharing constructs between stacks requires copy-paste or custom
macros. Terraform adds a second language and state-management overhead for a
team already invested in the AWS ecosystem.

## Decision

We will use **AWS CDK v2 with TypeScript** to define all infrastructure.

Constructs are typed, composed like regular classes, and tested with `jest` via
`aws-cdk-lib/assertions`. The same `tsconfig`, linting, and CI pipeline used for
application code applies to infrastructure code with no additional tooling. CDK
L2/L3 constructs encode AWS best-practice defaults (e.g. least-privilege IAM
grants, VPC subnet selection) and reduce boilerplate compared to raw
CloudFormation.

## Consequences

- Infrastructure tests run alongside application tests in a single `pnpm test`
  invocation, giving fast feedback on structural regressions.
- All infrastructure changes produce a reviewable CloudFormation change set
  before deployment via `cdk diff`.
- The team is locked into the CDK release cadence and must upgrade the
  `aws-cdk-lib` dependency as AWS deprecates old behaviour.
- Developers unfamiliar with CDK need to learn its construct model and synthesis
  pipeline before contributing infrastructure changes.
- Generated CloudFormation templates are not intended to be hand-edited; the CDK
  source files are the authoritative definition.
